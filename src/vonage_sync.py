"""Pull Vonage VBC company call recordings into the QA pipeline."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from src import database as db
from src.call_filters import is_qa_eligible_duration
from src.config import get_settings
from src.missed_call_group import is_answered_result
from src.pipeline import enqueue_bytes
from src.vonage_vbc import VBCRecording, VonageVBCClient, VonageVBCError

logger = logging.getLogger(__name__)

# Match a recording to a CDR when call_id is missing (time + numbers/extension).
_CDR_MATCH_WINDOW_SECONDS = 120


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
        "capped": False,
        "errors": [],
        "call_ids": [],
        "window_start": start_gte.isoformat(),
        "window_end": start_lte.isoformat(),
    }

    ingest_attempts = 0
    for rec in client.iter_company_recordings(
        start_gte=start_gte,
        start_lte=start_lte,
        page_size=50,
        extension=extension,
    ):
        if not rec.recording_id:
            continue
        summary["listed"] += 1

        if skip_existing and find_existing_by_vonage_recording_id(rec.recording_id):
            summary["skipped_existing"] += 1
            continue

        if not is_qa_eligible_duration(rec.duration_seconds):
            summary["skipped_short"] += 1
            continue

        if ingest_attempts >= max_recordings:
            summary["capped"] = True
            break

        ingest_attempts += 1
        if not enqueue_for_qa:
            continue

        try:
            call_id = ingest_recording(client, rec, process_now=process_now)
            summary["queued"] += 1
            summary["call_ids"].append(call_id)
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(
                {"recording_id": rec.recording_id, "error": str(exc)}
            )

    return summary


def is_recorded_answered_unmatched(log: Mapping[str, Any]) -> bool:
    """True when a CDR claims a recording but has no linked QA call."""
    if str(log.get("matched_call_id") or "").strip():
        return False
    if log.get("recorded") is not True:
        return False
    if log.get("is_unrecorded"):
        return False
    if log.get("is_missed") is True:
        return False
    if not is_answered_result(log.get("result")):
        return False
    return is_qa_eligible_duration(log.get("length_seconds"))


def match_recording_for_cdr(
    log: Mapping[str, Any],
    recordings: list[VBCRecording],
) -> VBCRecording | None:
    """Prefer vonage call_id == CDR id, then time + numbers/extension."""
    log_id = str(log.get("id") or log.get("log_id") or "").strip()
    if log_id:
        for rec in recordings:
            if rec.call_id and str(rec.call_id) == log_id:
                return rec

    start = _as_dt(log.get("start"))
    if start is None:
        return None

    log_from = _digits(log.get("from_number"))
    log_to = _digits(log.get("to_number"))
    log_ext = _digits(
        log.get("destination_extension") or log.get("source_extension")
    )
    best: VBCRecording | None = None
    best_delta = _CDR_MATCH_WINDOW_SECONDS + 1

    for rec in recordings:
        if rec.start is None:
            continue
        rec_start = rec.start if rec.start.tzinfo else rec.start.replace(
            tzinfo=timezone.utc
        )
        delta = abs((rec_start - start).total_seconds())
        if delta > _CDR_MATCH_WINDOW_SECONDS:
            continue

        rec_ext = _digits(rec.extension)
        caller = _digits(rec.caller_id)
        dnis = _digits(rec.dnis)
        numbers_ok = False
        if log_ext and rec_ext and log_ext == rec_ext:
            numbers_ok = True
        elif log_from and caller and _phones_match(log_from, caller):
            numbers_ok = True
        elif log_to and dnis and _phones_match(log_to, dnis):
            numbers_ok = True
        elif log_from and dnis and _phones_match(log_from, dnis):
            numbers_ok = True
        elif log_to and caller and _phones_match(log_to, caller):
            numbers_ok = True
        elif not log_from and not log_to and not log_ext:
            numbers_ok = delta <= 30

        if not numbers_ok:
            continue
        if delta < best_delta:
            best_delta = delta
            best = rec

    return best


def ingest_missing_recorded_cdrs(
    *,
    hours_back: int = 6,
    days_back: int | None = None,
    max_recordings: int = 50,
    process_now: bool = False,
) -> dict[str, Any]:
    """Ingest recordings for answered CDRs marked recorded with no QA call.

    This is the completeness loop: CDRs are the source of truth for what
    should have been captured; the recording list is only the media source.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    if days_back is not None:
        start_gte = now - timedelta(days=days_back)
    else:
        start_gte = now - timedelta(hours=max(1, hours_back))
    start_lte = now
    pad = timedelta(minutes=15)

    summary: dict[str, Any] = {
        "candidates": 0,
        "queued": 0,
        "skipped_existing": 0,
        "skipped_no_recording": 0,
        "skipped_short": 0,
        "capped": False,
        "errors": [],
        "call_ids": [],
        "window_start": start_gte.isoformat(),
        "window_end": start_lte.isoformat(),
    }
    if not settings.database_configured:
        summary["errors"].append({"error": "database is not configured"})
        return summary

    lookback_days = max(1, int((start_lte - start_gte).total_seconds() // 86400) + 1)
    try:
        logs = db.list_call_logs(limit=2000, days=lookback_days, recorded=True)
    except Exception:
        logger.exception("Failed listing CDRs for completeness ingest")
        summary["errors"].append({"error": "failed listing call logs"})
        return summary

    candidates: list[dict[str, Any]] = []
    for log in logs:
        start = _as_dt(log.get("start"))
        if start is not None and (start < start_gte or start > start_lte):
            continue
        if is_recorded_answered_unmatched(log):
            candidates.append(log)
    summary["candidates"] = len(candidates)
    if not candidates:
        return summary

    client = VonageVBCClient()
    recordings = list(
        client.iter_company_recordings(
            start_gte=start_gte - pad,
            start_lte=start_lte + pad,
            page_size=50,
        )
    )

    ingest_attempts = 0
    for log in candidates:
        rec = match_recording_for_cdr(log, recordings)
        if rec is None:
            summary["skipped_no_recording"] += 1
            continue
        if find_existing_by_vonage_recording_id(rec.recording_id):
            summary["skipped_existing"] += 1
            _stamp_matched_call(log, rec.recording_id)
            continue
        if not is_qa_eligible_duration(rec.duration_seconds):
            summary["skipped_short"] += 1
            continue
        if ingest_attempts >= max_recordings:
            summary["capped"] = True
            break
        ingest_attempts += 1
        try:
            call_id = ingest_recording(client, rec, process_now=process_now)
            summary["queued"] += 1
            summary["call_ids"].append(call_id)
            log_id = str(log.get("id") or "").strip()
            if log_id:
                db.upsert_call_log({"id": log_id, "matched_call_id": call_id})
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(
                {
                    "log_id": log.get("id"),
                    "recording_id": rec.recording_id,
                    "error": str(exc),
                }
            )
            logger.exception(
                "Completeness ingest failed for CDR %s recording %s",
                log.get("id"),
                rec.recording_id,
            )

    return summary


def _stamp_matched_call(log: Mapping[str, Any], recording_id: str) -> None:
    """If the recording is already a QA call, link the CDR without re-ingest."""
    log_id = str(log.get("id") or "").strip()
    if not log_id:
        return
    existing = find_existing_by_vonage_recording_id(recording_id)
    if not existing or not existing.get("id"):
        return
    try:
        db.upsert_call_log({"id": log_id, "matched_call_id": str(existing["id"])})
    except Exception:
        logger.exception("Failed stamping matched_call_id on CDR %s", log_id)


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


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def ingest_recording(
    client: VonageVBCClient,
    rec: VBCRecording,
    *,
    process_now: bool = True,
) -> str:
    if not is_qa_eligible_duration(rec.duration_seconds):
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
        process_call_sync(call_id, audio_path)
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
