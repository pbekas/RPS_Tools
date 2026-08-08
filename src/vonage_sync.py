"""Pull Vonage VBC company call recordings into the QA pipeline."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from src import database as db
from src.call_filters import is_qa_eligible_duration
from src.config import get_settings
from src.pipeline import enqueue_bytes
from src.vonage_vbc import VBCRecording, VonageVBCClient, VonageVBCError

logger = logging.getLogger(__name__)


def find_existing_by_vonage_recording_id(recording_id: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.database_configured:
        return None
    try:
        return db.find_call_by_vonage_recording_id(str(recording_id))
    except Exception:
        for call in db.list_calls(limit=200, require_min_duration=False):
            if str(call.get("vonage_recording_id") or "") == str(recording_id):
                return call
    return None


def _digits(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\D", "", str(value))


def _phones_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 10 and len(b) >= 10:
        return a[-10:] == b[-10:]
    return a.endswith(b) or b.endswith(a)


def recording_matches_voicemail_cdr(rec: VBCRecording) -> bool:
    """True when a nearby inbound CDR has result Voicemail for this caller."""
    if rec.start is None:
        return False
    caller = _digits(rec.caller_id)
    if not caller:
        return False
    try:
        logs = db.list_call_logs(limit=300, days=2, missed_only=True)
    except Exception:
        logger.exception("Failed listing call logs for short-VM match")
        return False
    start = rec.start if rec.start.tzinfo else rec.start.replace(tzinfo=timezone.utc)
    for row in logs:
        result = (row.get("result") or "").strip().lower()
        if "voicemail" not in result and "voice mail" not in result:
            continue
        cdr_start = row.get("start") or row.get("start_at")
        if not isinstance(cdr_start, datetime):
            continue
        if cdr_start.tzinfo is None:
            cdr_start = cdr_start.replace(tzinfo=timezone.utc)
        if abs((cdr_start - start).total_seconds()) > 180:
            continue
        if _phones_match(caller, _digits(row.get("from_number"))):
            return True
    return False


def sync_company_recordings(
    *,
    days_back: int = 7,
    hours_back: int | None = None,
    minutes_back: int | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    max_recordings: int = 100,
    extension: str | None = None,
    skip_existing: bool = True,
    enqueue_for_qa: bool = True,
    process_now: bool = True,
) -> dict[str, Any]:
    """
    List VBC company recordings in a date window, download new ones,
    and queue them for Transcribe + Bedrock QA.
    """
    client = VonageVBCClient()
    now = datetime.now(timezone.utc)
    if start is not None:
        start_gte = start
    elif minutes_back is not None:
        start_gte = now - timedelta(minutes=minutes_back)
    elif hours_back is not None:
        start_gte = now - timedelta(hours=hours_back)
    else:
        start_gte = now - timedelta(days=days_back)
    start_lte = end or now

    summary: dict[str, Any] = {
        "listed": 0,
        "queued": 0,
        "skipped_existing": 0,
        "skipped_short": 0,
        "queued_voicemail_short": 0,
        "errors": [],
        "call_ids": [],
        "window_start": start_gte.isoformat(),
        "window_end": start_lte.isoformat(),
    }

    seen = 0
    for rec in client.iter_company_recordings(
        start_gte=start_gte,
        start_lte=start_lte,
        page_size=50,
        extension=extension,
    ):
        if not rec.recording_id:
            continue
        seen += 1
        summary["listed"] = seen
        if seen > max_recordings:
            break

        if skip_existing and find_existing_by_vonage_recording_id(rec.recording_id):
            summary["skipped_existing"] += 1
            continue

        transcript_only = False
        if not is_qa_eligible_duration(rec.duration_seconds):
            if recording_matches_voicemail_cdr(rec):
                transcript_only = True
            else:
                summary["skipped_short"] += 1
                continue

        if not enqueue_for_qa:
            continue

        try:
            call_id = ingest_recording(
                client,
                rec,
                process_now=process_now,
                transcript_only=transcript_only,
            )
            summary["queued"] += 1
            if transcript_only:
                summary["queued_voicemail_short"] += 1
            summary["call_ids"].append(call_id)
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(
                {"recording_id": rec.recording_id, "error": str(exc)}
            )

    return summary


def ingest_recording(
    client: VonageVBCClient,
    rec: VBCRecording,
    *,
    process_now: bool = True,
    transcript_only: bool = False,
) -> str:
    if not is_qa_eligible_duration(rec.duration_seconds) and not transcript_only:
        raise VonageVBCError(
            f"Recording {rec.recording_id} is {rec.duration_seconds}s "
            "(30s or under) — skipped as IVR-only / no live interaction"
        )

    audio = client.download_recording(rec)
    filename = f"vbc_{rec.recording_id}.mp3"
    if audio[:4] == b"RIFF":
        filename = f"vbc_{rec.recording_id}.wav"

    from src.pipeline import _UPLOAD_ROOT, _queue_job, process_call_sync

    # Create pending call first (no worker yet) so we can stamp duration/ids
    # before Transcribe/Bedrock starts.
    call_id = enqueue_bytes(
        data=audio,
        original_filename=filename,
        source="vonage",
        vonage_call_id=rec.call_id,
        call_date=rec.start or datetime.now(timezone.utc),
        queue_background=False,
    )

    settings = get_settings()
    audio_path = _UPLOAD_ROOT / f"{call_id}_{filename}"
    if settings.database_configured and not str(call_id).startswith("local_"):
        db.update_call(
            call_id,
            {
                "vonage_recording_id": rec.recording_id,
                "vonage_call_id": rec.call_id,
                "vonage_extension": rec.extension,
                "vonage_caller_id": rec.caller_id,
                "vonage_cnam": rec.cnam,
                "vonage_dnis": rec.dnis,
                "vonage_direction": rec.call_direction,
                "duration_seconds": rec.duration_seconds or 0,
                "call_date": rec.start or datetime.now(timezone.utc),
            },
        )

    if process_now and settings.database_configured and not str(call_id).startswith("local_"):
        process_call_sync(
            call_id,
            audio_path,
            transcribe_even_if_short=transcript_only,
        )
    else:
        _queue_job(call_id, audio_path)
    return call_id


def test_connection() -> dict[str, Any]:
    """Fetch one page to validate credentials / API subscription."""
    client = VonageVBCClient()
    token_preview = client.get_access_token()[:12] + "…"
    rows, meta = client.list_company_recordings(page=1, page_size=1)
    return {
        "ok": True,
        "token_preview": token_preview,
        "account_id": client.account_id,
        "sample_count_on_first_page": len(rows),
        "page_size": meta.get("page_size"),
        "sample_recording_id": rows[0].recording_id if rows else None,
    }
