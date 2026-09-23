"""Sync Vonage VBC Reports call-logs (CDRs) into Firestore `call_logs`."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from src import database as db
from src.call_match import alignment_score, digits, recording_id_from_raw
from src.config import get_settings
from src.missed_call_group import (
    DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS,
    build_answered_elsewhere_index,
    effective_is_missed,
    find_answered_elsewhere_sibling,
    is_answered_result,
    is_inbound,
    missed_notification_ready,
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

        # Hold SMS and Chat until the answered-elsewhere window has closed.
        # A same-number answer often arrives seconds later; paging on the
        # first Missed CDR is a false positive.
        notify_miss = is_missed and missed_notification_ready(
            log.start, window_seconds=window_seconds
        )

        # Best-effort patient SMS — never fails the CDR sync cycle.
        try:
            from src.twilio_sms import maybe_notify_missed_inbound_call

            if notify_miss and maybe_notify_missed_inbound_call(
                log, is_missed_override=is_missed
            ):
                summary["missed_sms_sent"] += 1
        except Exception:
            logger.exception("Missed-call SMS hook failed for %s", log.log_id)

        # Best-effort Google Chat alert for every confirmed missed inbound CDR.
        try:
            from src.notify import alert_missed_call

            agent_name = (
                log.destination_user_full_name
                or log.destination_user
                or log.source_user_full_name
                or log.source_user
            )
            extension = log.destination_extension or log.source_extension
            if notify_miss and alert_missed_call(
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


def rematch_unlinked_call_logs(
    *,
    days_back: int = 2,
    limit: int = 1000,
) -> dict[str, Any]:
    """Link stored CDRs to QA calls already in the database. Does not download audio."""
    summary: dict[str, Any] = {"candidates": 0, "matched": 0, "errors": []}
    if not get_settings().database_configured:
        return summary
    try:
        logs = db.list_call_logs(
            limit=limit,
            days=max(1, days_back),
            capture_gaps_only=True,
        )
    except TypeError:
        from src.call_match import is_capture_candidate

        logs = [
            row
            for row in db.list_call_logs(limit=limit, days=max(1, days_back))
            if is_capture_candidate(row)
        ]
    except Exception:
        logger.exception("Failed listing unlinked CDRs for rematch")
        summary["errors"].append({"error": "failed listing call logs"})
        return summary

    summary["candidates"] = len(logs)
    starts = [dt for dt in (_as_dt(row.get("start")) for row in logs) if dt]
    if not starts:
        return summary
    pad = timedelta(minutes=5)
    candidates = _load_match_candidates(min(starts) - pad, max(starts) + pad)
    for row in logs:
        log_id = str(row.get("id") or "").strip()
        if not log_id:
            continue
        try:
            call_id = _match_call(_vbc_log_from_row(row), candidates)
            if not call_id:
                continue
            db.upsert_call_log({"id": log_id, "matched_call_id": call_id})
            summary["matched"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append({"log_id": log_id, "error": str(exc)})
            logger.exception("Rematch failed for CDR %s", log_id)
    return summary


def _vbc_log_from_row(row: Mapping[str, Any]) -> VBCCallLog:
    raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
    return VBCCallLog(
        log_id=str(row.get("id") or "").strip(),
        direction=row.get("direction"),
        from_number=row.get("from_number"),
        to_number=row.get("to_number"),
        result=row.get("result"),
        recorded=row.get("recorded"),
        length_seconds=int(row.get("length_seconds") or 0),
        start=_as_dt(row.get("start")),
        end=_as_dt(row.get("end")),
        source_user=row.get("source_user"),
        source_user_full_name=row.get("source_user_full_name"),
        source_extension=row.get("source_extension"),
        destination_user=row.get("destination_user"),
        destination_user_full_name=row.get("destination_user_full_name"),
        destination_extension=row.get("destination_extension"),
        custom_tag=row.get("custom_tag"),
        in_network=row.get("in_network"),
        international=row.get("international"),
        ring_seconds=row.get("ring_seconds"),
        wait_seconds=row.get("wait_seconds"),
        queue_seconds=row.get("queue_seconds"),
        answered_at=_as_dt(row.get("answered_at")),
        raw=raw,
    )


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
    """QA calls in the CDR window, not just the latest global rows."""
    try:
        rows = db.list_calls(
            limit=2000,
            require_min_duration=False,
            since=start_gte,
            until=start_lte,
        )
    except TypeError:
        rows = db.list_calls(limit=2000, require_min_duration=False)
    out: list[dict[str, Any]] = []
    for call in rows:
        call_dt = _as_dt(call.get("call_date") or call.get("created_at"))
        if call_dt is None:
            continue
        if call_dt < start_gte or call_dt > start_lte:
            continue
        out.append(call)
    return out


def _match_call_by_stored_ids(log: VBCCallLog) -> str | None:
    """O(1) link when the QA call already stores this CDR or recording id."""
    if not get_settings().database_configured:
        return None
    try:
        hit = db.find_call_by_vonage_call_id(log.log_id)
        if hit and hit.get("id"):
            return str(hit["id"])
    except Exception:
        logger.debug("vonage_call_id lookup failed for %s", log.log_id, exc_info=True)
    rec_id = recording_id_from_raw(log.raw)
    if not rec_id:
        return None
    try:
        hit = db.find_call_by_vonage_recording_id(rec_id)
        if hit and hit.get("id"):
            return str(hit["id"])
    except Exception:
        logger.debug("recording id lookup failed for %s", rec_id, exc_info=True)
    return None


def _match_call(
    log: VBCCallLog,
    candidates: list[dict[str, Any]],
) -> str | None:
    stored = _match_call_by_stored_ids(log)
    if stored:
        return stored

    for call in candidates:
        vonage_call_id = str(call.get("vonage_call_id") or "").strip()
        if vonage_call_id and vonage_call_id == log.log_id:
            return str(call["id"])
    raw_recording_id = recording_id_from_raw(log.raw)
    if raw_recording_id:
        for call in candidates:
            if str(call.get("vonage_recording_id") or "").strip() == raw_recording_id:
                return str(call["id"])

    if log.start is None or not candidates:
        return None

    log_from = digits(log.from_number)
    log_to = digits(log.to_number)
    log_exts = {digits(log.destination_extension), digits(log.source_extension)}
    log_exts.discard("")
    best_id: str | None = None
    best_score = 0
    best_delta = _MATCH_WINDOW_SECONDS + 1

    for call in candidates:
        call_dt = _as_dt(call.get("call_date"))
        if call_dt is None:
            continue
        delta = abs((call_dt - log.start).total_seconds())
        if delta > _MATCH_WINDOW_SECONDS:
            continue

        call_ext = digits(call.get("vonage_extension"))
        other_exts = {call_ext} if call_ext else set()
        score = alignment_score(
            direction=log.direction or str(call.get("vonage_direction") or ""),
            log_from=log_from,
            log_to=log_to,
            caller=digits(call.get("vonage_caller_id")),
            dnis=digits(call.get("vonage_dnis")),
            log_exts=log_exts,
            other_exts=other_exts,
        )
        if score <= 0 and not other_exts and not digits(call.get("vonage_caller_id")) and not digits(
            call.get("vonage_dnis")
        ):
            score = 1 if delta <= 30 else 0
        if score <= 0:
            continue
        if score > best_score or (score == best_score and delta < best_delta):
            best_score = score
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
