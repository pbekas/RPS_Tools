"""Sync Vonage VBC Reports call-logs (CDRs) into Firestore `call_logs`."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from src import database as db
from src.config import get_settings
from src.missed_call_group import (
    DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS,
    build_answered_elsewhere_index,
    effective_is_missed,
    find_answered_elsewhere_sibling,
    is_answered_result,
    is_inbound,
)
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

    window_seconds = DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS

    summary: dict[str, Any] = {
        "listed": 0,
        "upserted": 0,
        "matched": 0,
        "missed": 0,
        "missed_suppressed_group_ring": 0,
        "unrecorded": 0,
        "missed_sms_sent": 0,
        "missed_alerts_sent": 0,
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

    # Materialize the pull so blast-group siblings in the same page can
    # suppress each other regardless of API order.
    pulled: list[VBCCallLog] = []
    for log in client.iter_call_logs(
        start_gte=start_gte,
        start_lte=start_lte,
        page_size=50,
        max_pages=max(1, (max_logs // 50) + 2),
    ):
        if not log.log_id:
            continue
        pulled.append(log)
        if len(pulled) >= max_logs:
            break

    summary["listed"] = len(pulled)

    # Recent stored CDRs cover answered legs that landed in an earlier poll.
    recent_peers = _load_recent_peers_for_group_ring(window_seconds=window_seconds)
    answered_elsewhere = build_answered_elsewhere_index(
        [*pulled, *recent_peers],
        window_seconds=window_seconds,
    )

    for log in pulled:
        sibling_id = answered_elsewhere.get(log.log_id)
        is_missed = effective_is_missed(
            result=log.result,
            is_missed=log.is_missed,
            answered_elsewhere=bool(sibling_id),
            answered_elsewhere_log_id=sibling_id,
        )
        if sibling_id and log.is_missed:
            summary["missed_suppressed_group_ring"] += 1
        if is_missed:
            summary["missed"] += 1
        if log.is_unrecorded:
            summary["unrecorded"] += 1

        matched_call_id: str | None = None
        if match_calls:
            matched_call_id = _match_call(log, candidates)
            if matched_call_id:
                summary["matched"] += 1
                _stamp_call_extension_from_cdr(matched_call_id, log)

        try:
            db.upsert_call_log(
                _call_log_payload(
                    log,
                    matched_call_id,
                    is_missed=is_missed,
                    answered_elsewhere_log_id=sibling_id,
                )
            )
            summary["upserted"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append({"log_id": log.log_id, "error": str(exc)})
            logger.exception("Failed to upsert call log %s", log.log_id)
            continue

        # An answered leg may arrive after sibling misses were already stored.
        if is_inbound(log.direction) and is_answered_result(log.result):
            try:
                suppressed = _backfill_suppress_group_ring_misses(
                    log,
                    window_seconds=window_seconds,
                )
                summary["missed_suppressed_group_ring"] += suppressed
            except Exception:
                logger.exception(
                    "Group-ring miss backfill failed for answered %s", log.log_id
                )

        # Best-effort patient SMS — never fails the CDR sync cycle.
        try:
            from src.twilio_sms import maybe_notify_missed_inbound_call

            if maybe_notify_missed_inbound_call(log, is_missed_override=is_missed):
                summary["missed_sms_sent"] += 1
        except Exception:
            logger.exception("Missed-call SMS hook failed for %s", log.log_id)

        # Best-effort Google Chat alert for every missed inbound CDR.
        try:
            from src.notify import alert_missed_call

            agent_name = (
                log.destination_user_full_name
                or log.destination_user
                or log.source_user_full_name
                or log.source_user
            )
            extension = log.destination_extension or log.source_extension
            if alert_missed_call(
                log_id=log.log_id,
                direction=log.direction,
                result=log.result,
                from_number=log.from_number,
                to_number=log.to_number,
                agent_name=agent_name,
                extension=extension,
                start=log.start,
                is_missed=is_missed,
            ):
                summary["missed_alerts_sent"] += 1
        except Exception:
            logger.exception("Missed-call Chat alert failed for %s", log.log_id)

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
            if effective_is_missed(
                result=row.get("result"),
                is_missed=row.get("is_missed"),
                answered_elsewhere=bool(row.get("answered_elsewhere")),
                answered_elsewhere_log_id=row.get("answered_elsewhere_log_id"),
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
    *,
    is_missed: bool | None = None,
    answered_elsewhere_log_id: str | None = None,
) -> dict[str, Any]:
    # Timing stubs stay null until VBC/ACD exposes ring/queue wait.
    # Do not invent ASA from QA time_to_answer_seconds.
    missed = (
        bool(is_missed)
        if is_missed is not None
        else effective_is_missed(
            result=log.result,
            is_missed=log.is_missed,
            answered_elsewhere=bool(answered_elsewhere_log_id),
            answered_elsewhere_log_id=answered_elsewhere_log_id,
        )
    )
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
        "is_missed": missed,
        "is_unrecorded": log.is_unrecorded,
        "matched_call_id": matched_call_id,
        "ring_seconds": log.ring_seconds,
        "wait_seconds": log.wait_seconds,
        "queue_seconds": log.queue_seconds,
        "answered_at": log.answered_at,
        # Stored via raw merge on upsert — used for Ops labels / audit.
        "answered_elsewhere": bool(answered_elsewhere_log_id),
        "answered_elsewhere_log_id": answered_elsewhere_log_id,
        "raw": log.raw,
    }


def _load_recent_peers_for_group_ring(
    *,
    window_seconds: int,
) -> list[dict[str, Any]]:
    """Recent CDRs so an answered leg from a prior poll can suppress new misses."""
    del window_seconds  # reserved for tighter SQL filters later
    # A day of lookback is cheap and covers delayed Reports pages.
    try:
        return db.list_call_logs(limit=1000, days=1)
    except Exception:
        logger.exception("Failed loading recent CDRs for group-ring suppress")
        return []


def _backfill_suppress_group_ring_misses(
    answered: VBCCallLog,
    *,
    window_seconds: int,
) -> int:
    """Flip already-stored Missed siblings when the answered leg arrives later."""
    if answered.start is None:
        return 0
    recent = db.list_call_logs(limit=500, days=1)
    suppressed = 0
    for row in recent:
        if row.get("answered_elsewhere") and row.get("is_missed") is False:
            continue
        sibling = find_answered_elsewhere_sibling(
            row, [answered], window_seconds=window_seconds
        )
        if not sibling:
            continue
        db.upsert_call_log(
            {
                "id": row["id"],
                "is_missed": False,
                "answered_elsewhere": True,
                "answered_elsewhere_log_id": answered.log_id,
            }
        )
        suppressed += 1
        logger.info(
            "Suppressed group-ring miss %s (answered elsewhere as %s)",
            row.get("id"),
            answered.log_id,
        )
    return suppressed


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
    log_exts = {_digits(log.destination_extension), _digits(log.source_extension)}
    log_exts.discard("")
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
        call_ext = _digits(call.get("vonage_extension"))
        numbers_ok = False
        if call_ext and call_ext in log_exts:
            numbers_ok = True
        elif log_from and caller and _phones_match(log_from, caller):
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


def _stamp_call_extension_from_cdr(call_id: str, log: VBCCallLog) -> None:
    """If the QA call is missing an extension, copy it from the matched CDR."""
    ext = _digits(log.destination_extension) or _digits(log.source_extension)
    if not ext:
        return
    try:
        call = db.get_call(call_id)
        if not call:
            return
        from src.agent_identity import stamp_and_remap_call_extension

        stamp_and_remap_call_extension(call, ext)
    except Exception:
        logger.exception("Failed stamping extension %s on call %s", ext, call_id)


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
