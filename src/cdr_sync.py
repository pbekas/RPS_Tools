"""Sync Vonage VBC Reports call-logs (CDRs) into Firestore `call_logs`."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from src import database as db
from src.config import get_settings
from src.vonage_reports import VBCCallLog, VonageReportsClient

logger = logging.getLogger(__name__)

# Match QA recordings within this window of CDR start time.
_MATCH_WINDOW_SECONDS = 120


def sync_call_logs(
    *,
    days_back: int = 7,
    hours_back: int | None = None,
    minutes_back: int | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    max_logs: int = 500,
    match_calls: bool = True,
) -> dict[str, Any]:
    """
    Pull VBC Reports call-logs for a time window and upsert into Firestore.
    Optionally link each CDR to a QA `calls` doc when a recording exists.
    """
    settings = get_settings()
    if not settings.database_configured:
        raise RuntimeError("Selected database is not configured — cannot sync call logs")

    client = VonageReportsClient()
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
        "upserted": 0,
        "matched": 0,
        "missed": 0,
        "unrecorded": 0,
        "missed_sms_sent": 0,
        "errors": [],
        "window_start": start_gte.isoformat(),
        "window_end": start_lte.isoformat(),
    }

    candidates: list[dict[str, Any]] = []
    if match_calls:
        # Pad the lookback so edge CDRs can still match nearby recordings.
        pad = timedelta(minutes=5)
        candidates = _load_match_candidates(
            start_gte - pad,
            start_lte + pad,
        )

    seen = 0
    for log in client.iter_call_logs(
        start_gte=start_gte,
        start_lte=start_lte,
        page_size=50,
        max_pages=max(1, (max_logs // 50) + 2),
    ):
        if not log.log_id:
            continue
        seen += 1
        summary["listed"] = seen
        if seen > max_logs:
            break

        if log.is_missed:
            summary["missed"] += 1
        if log.is_unrecorded:
            summary["unrecorded"] += 1

        matched_call_id: str | None = None
        if match_calls:
            matched_call_id = _match_call(log, candidates)
            if matched_call_id:
                summary["matched"] += 1

        try:
            db.upsert_call_log(_call_log_payload(log, matched_call_id))
            summary["upserted"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append({"log_id": log.log_id, "error": str(exc)})
            logger.exception("Failed to upsert call log %s", log.log_id)
            continue

        # Best-effort patient SMS — never fails the CDR sync cycle.
        try:
            from src.twilio_sms import maybe_notify_missed_inbound_call

            if maybe_notify_missed_inbound_call(log):
                summary["missed_sms_sent"] += 1
        except Exception:
            logger.exception("Missed-call SMS hook failed for %s", log.log_id)

    _maybe_alert_missed_spike(summary)
    return summary


def _maybe_alert_missed_spike(summary: dict[str, Any]) -> None:
    """Notify when recent missed volume crosses threshold."""
    try:
        from src.config import get_settings
        from src.notify import alert_missed_spike

        settings = get_settings()
        window = max(5, int(settings.missed_alert_window_minutes))
        threshold = max(1, int(settings.missed_alert_threshold))
        recent = db.list_call_logs(limit=500, days=1)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=window)
        missed = 0
        answered = 0
        for row in recent:
            start = row.get("start")
            if not isinstance(start, datetime):
                continue
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if start < cutoff:
                continue
            result = (row.get("result") or "").strip().lower()
            if row.get("is_missed") or (
                result and result not in {"answered", "connected"}
            ):
                missed += 1
            else:
                answered += 1
        summary["missed_window"] = missed
        summary["answered_window"] = answered
        alert_missed_spike(
            window_minutes=window,
            missed_count=missed,
            threshold=threshold,
            answered_count=answered,
        )
    except Exception:
        logger.exception("Missed-spike alert check failed")


def test_reports_connection() -> dict[str, Any]:
    """List a tiny window of call logs to verify Reports API access."""
    client = VonageReportsClient()
    now = datetime.now(timezone.utc)
    rows, meta = client.list_call_logs(
        start_gte=now - timedelta(hours=1),
        start_lte=now,
        page=1,
        page_size=1,
    )
    return {
        "ok": True,
        "account_id": client.vbc.account_id,
        "sample_count": len(rows),
        "sample_id": rows[0].log_id if rows else None,
        "page_meta_keys": sorted(meta.keys()) if isinstance(meta, dict) else [],
    }


def _call_log_payload(
    log: VBCCallLog,
    matched_call_id: str | None,
) -> dict[str, Any]:
    # Timing stubs stay null until VBC/ACD exposes ring/queue wait.
    # Do not invent ASA from QA time_to_answer_seconds.
    return {
        "id": log.log_id,
        "direction": log.direction,
        "from_number": log.from_number,
        "to_number": log.to_number,
        "result": log.result,
        "recorded": log.recorded,
        "length_seconds": log.length_seconds,
        "start": log.start,
        "end": log.end,
        "source_user": log.source_user,
        "source_user_full_name": log.source_user_full_name,
        "source_extension": log.source_extension,
        "destination_user": log.destination_user,
        "destination_user_full_name": log.destination_user_full_name,
        "destination_extension": log.destination_extension,
        "custom_tag": log.custom_tag,
        "in_network": log.in_network,
        "international": log.international,
        "is_missed": log.is_missed,
        "is_unrecorded": log.is_unrecorded,
        "matched_call_id": matched_call_id,
        "ring_seconds": log.ring_seconds,
        "wait_seconds": log.wait_seconds,
        "queue_seconds": log.queue_seconds,
        "answered_at": log.answered_at,
        "raw": log.raw,
    }


def _load_match_candidates(
    start_gte: datetime,
    start_lte: datetime,
) -> list[dict[str, Any]]:
    """Recent QA calls that might match CDRs in this window."""
    rows = db.list_calls(limit=400, require_min_duration=False)
    out: list[dict[str, Any]] = []
    for call in rows:
        call_dt = _as_dt(call.get("call_date") or call.get("created_at"))
        if call_dt is None:
            continue
        if call_dt < start_gte or call_dt > start_lte:
            continue
        out.append(call)
    return out


def _match_call(
    log: VBCCallLog,
    candidates: list[dict[str, Any]],
) -> str | None:
    if not candidates:
        return None

    # Prefer exact vonage_call_id == CDR id when present.
    for call in candidates:
        vonage_call_id = str(call.get("vonage_call_id") or "").strip()
        if vonage_call_id and vonage_call_id == log.log_id:
            return str(call["id"])

    if log.start is None:
        return None

    log_from = _digits(log.from_number)
    log_to = _digits(log.to_number)
    best_id: str | None = None
    best_delta = _MATCH_WINDOW_SECONDS + 1

    for call in candidates:
        call_dt = _as_dt(call.get("call_date"))
        if call_dt is None:
            continue
        delta = abs((call_dt - log.start).total_seconds())
        if delta > _MATCH_WINDOW_SECONDS:
            continue

        caller = _digits(call.get("vonage_caller_id"))
        dnis = _digits(call.get("vonage_dnis"))
        numbers_ok = False
        if log_from and caller and _phones_match(log_from, caller):
            numbers_ok = True
        elif log_to and dnis and _phones_match(log_to, dnis):
            numbers_ok = True
        elif log_from and dnis and _phones_match(log_from, dnis):
            numbers_ok = True
        elif log_to and caller and _phones_match(log_to, caller):
            numbers_ok = True
        elif not log_from and not log_to:
            # No CDR numbers — time proximity alone is weak; skip.
            numbers_ok = False
        elif not caller and not dnis:
            # Recording has no numbers; allow time-only if unique-ish.
            numbers_ok = delta <= 30

        if not numbers_ok:
            continue
        if delta < best_delta:
            best_delta = delta
            best_id = str(call["id"])

    return best_id


def _digits(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\D", "", str(value))


def _phones_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    # Compare last 10 digits (NANP) when both are long enough.
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
