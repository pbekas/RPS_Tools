"""Pull Vonage VBC company call recordings into the QA pipeline."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from src import database as db
from src.call_filters import is_qa_eligible_duration
from src.call_match import alignment_score, digits, is_capture_candidate, phones_match, recording_id_from_raw
from src.config import get_settings
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

        existing = (
            find_existing_by_vonage_recording_id(rec.recording_id)
            if skip_existing
            else None
        )
        if skip_existing and existing:
            summary["skipped_existing"] += 1
            _attach_extension_to_existing(existing, rec)
            _stamp_cdr_by_vonage_call_id(str(existing.get("id") or ""), rec.call_id)
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
    """True when a CDR should have QA audio but has no linked call."""
    return is_capture_candidate(log)


def match_recording_for_cdr(
    log: Mapping[str, Any],
    recordings: list[VBCRecording],
) -> VBCRecording | None:
    """Prefer call id or recording id, then time + direction-aware numbers."""
    log_id = str(log.get("id") or log.get("log_id") or "").strip()
    raw = log.get("raw") if isinstance(log.get("raw"), Mapping) else None
    raw_recording_id = recording_id_from_raw(raw)
    if log_id or raw_recording_id:
        for rec in recordings:
            if log_id and rec.call_id and str(rec.call_id) == log_id:
                return rec
            if raw_recording_id and str(rec.recording_id) == raw_recording_id:
                return rec

    start = _as_dt(log.get("start"))
    if start is None:
        return None

    log_from = digits(log.get("from_number"))
    log_to = digits(log.get("to_number"))
    log_exts = {
        digits(log.get("destination_extension")),
        digits(log.get("source_extension")),
    }
    log_exts.discard("")
    direction = str(log.get("direction") or "") or None
    best: VBCRecording | None = None
    best_score = 0
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

        rec_exts = {digits(x) for x in (rec.extensions or []) if digits(x)}
        if rec.extension:
            rec_exts.add(digits(rec.extension))
        score = alignment_score(
            direction=direction or rec.call_direction,
            log_from=log_from,
            log_to=log_to,
            caller=digits(rec.caller_id),
            dnis=digits(rec.dnis),
            log_exts=log_exts,
            other_exts=rec_exts,
        )
        if score <= 0 and not log_from and not log_to and not log_exts:
            score = 1 if delta <= 30 else 0
        if score <= 0:
            continue
        if score > best_score or (score == best_score and delta < best_delta):
            best_score = score
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
        from src.cdr_sync import rematch_unlinked_call_logs

        summary["rematch"] = rematch_unlinked_call_logs(
            days_back=lookback_days,
            limit=2000,
        )
    except Exception:
        logger.exception("CDR rematch before completeness failed")
        summary["rematch"] = {"error": "rematch failed"}
    try:
        logs = db.list_call_logs(
            limit=2000,
            days=lookback_days,
            capture_gaps_only=True,
        )
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
        existing = find_existing_by_vonage_recording_id(rec.recording_id)
        if existing:
            summary["skipped_existing"] += 1
            _attach_extension_to_existing(
                existing, rec, preferred_extension=_preferred_extension_for_cdr(log, rec)
            )
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
            call_id = ingest_recording(
                client,
                rec,
                process_now=process_now,
                preferred_extension=_preferred_extension_for_cdr(log, rec),
            )
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


def _preferred_extension_for_cdr(
    log: Mapping[str, Any], rec: VBCRecording
) -> str | None:
    rec_exts = {_digits(x) for x in (rec.extensions or []) if _digits(x)}
    if rec.extension:
        rec_exts.add(_digits(rec.extension))
    dest = _digits(log.get("destination_extension"))
    src = _digits(log.get("source_extension"))
    if dest and (not rec_exts or dest in rec_exts):
        return dest
    if src and (not rec_exts or src in rec_exts):
        return src
    return rec.extension


def _attach_extension_to_existing(
    existing: Mapping[str, Any],
    rec: VBCRecording,
    *,
    preferred_extension: str | None = None,
) -> None:
    ext = preferred_extension or rec.extension
    if not ext:
        return
    try:
        from src.agent_identity import stamp_and_remap_call_extension

        stamp_and_remap_call_extension(dict(existing), ext)
    except Exception:
        logger.exception(
            "Failed attaching extension %s to call %s",
            ext,
            existing.get("id"),
        )


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
    return digits(value)


def _phones_match(a: str, b: str) -> bool:
    return phones_match(a, b)


def _stamp_cdr_by_vonage_call_id(call_id: str, vonage_call_id: str | None) -> None:
    """Link the CDR whose id is the recording's call id, without clearing other fields."""
    log_id = str(vonage_call_id or "").strip()
    qa_id = str(call_id or "").strip()
    if not log_id or not qa_id or qa_id.startswith("local_"):
        return
    if not get_settings().database_configured:
        return
    try:
        existing = db.get_call_log(log_id)
    except Exception:
        logger.exception("Failed reading CDR %s while linking recording", log_id)
        return
    if not existing:
        return
    if str(existing.get("matched_call_id") or "").strip() == qa_id:
        return
    try:
        db.upsert_call_log({"id": log_id, "matched_call_id": qa_id})
    except Exception:
        logger.exception("Failed linking CDR %s to call %s", log_id, qa_id)


def link_ingested_recording(call_id: str, rec: VBCRecording) -> None:
    """Point matching CDRs at a QA call that was just ingested."""
    _stamp_cdr_by_vonage_call_id(call_id, rec.call_id)
    if rec.start is None or not get_settings().database_configured:
        return
    qa_id = str(call_id or "").strip()
    if not qa_id or qa_id.startswith("local_"):
        return
    try:
        logs = db.list_call_logs(limit=400, days=2)
    except Exception:
        logger.exception("Failed listing CDRs to link recording %s", rec.recording_id)
        return
    for log in logs:
        log_id = str(log.get("id") or "").strip()
        if not log_id or log_id == str(rec.call_id or ""):
            continue
        if str(log.get("matched_call_id") or "").strip():
            continue
        start = _as_dt(log.get("start"))
        if start is None:
            continue
        rec_start = rec.start if rec.start.tzinfo else rec.start.replace(tzinfo=timezone.utc)
        if abs((start - rec_start).total_seconds()) > _CDR_MATCH_WINDOW_SECONDS:
            continue
        raw = log.get("raw") if isinstance(log.get("raw"), Mapping) else None
        raw_id = recording_id_from_raw(raw)
        if raw_id and raw_id == rec.recording_id:
            try:
                db.upsert_call_log({"id": log_id, "matched_call_id": qa_id})
            except Exception:
                logger.exception("Failed linking CDR %s by recording id", log_id)
            continue
        if is_capture_candidate(log) and match_recording_for_cdr(log, [rec]) is not None:
            try:
                db.upsert_call_log({"id": log_id, "matched_call_id": qa_id})
            except Exception:
                logger.exception("Failed linking CDR %s by time match", log_id)


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
    preferred_extension: str | None = None,
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
        ext = preferred_extension or rec.extension
        fields: dict[str, Any] = {
            "vonage_recording_id": rec.recording_id,
            "vonage_call_id": rec.call_id,
            "vonage_extension": ext,
            "vonage_caller_id": rec.caller_id,
            "vonage_cnam": rec.cnam,
            "vonage_dnis": rec.dnis,
            "vonage_direction": rec.call_direction,
            "duration_seconds": rec.duration_seconds or 0,
            "call_date": rec.start or datetime.now(timezone.utc),
        }
        try:
            from src.agent_identity import resolve_or_create_agent

            email, name = resolve_or_create_agent("Unknown", vonage_extension=ext)
            if email:
                fields["agent_email"] = email
                fields["agent_name"] = name
        except Exception:
            logger.exception("Failed mapping extension %s on ingest %s", ext, call_id)
        db.update_call(call_id, fields)
        try:
            link_ingested_recording(call_id, rec)
        except Exception:
            logger.exception("Failed linking CDRs for ingested call %s", call_id)

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
