"""Near-real-time Vonage VBC recording poller.

VBC Call Recording is pull-based (no “recording ready” push webhook).
This poller checks for new company recordings on an interval and queues QA.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from src.cdr_sync import sync_call_logs
from src.vonage_sync import ingest_missing_recorded_cdrs, sync_company_recordings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_thread: threading.Thread | None = None
_stop = threading.Event()
_state: dict[str, Any] = {
    "running": False,
    "interval_seconds": 300,
    "lookback_minutes": 30,
    "safety_lookback_hours": 6,
    "max_per_cycle": 50,
    "max_call_logs_per_cycle": 400,
    "backfill_days": 2,
    "backfill_interval_hours": 24,
    "backfill_max": 200,
    "last_started_at": None,
    "last_finished_at": None,
    "last_summary": None,
    "last_cdr_summary": None,
    "last_completeness_summary": None,
    "last_backfill_at": None,
    "last_backfill_summary": None,
    "last_error": None,
    "cycles": 0,
}


def poller_status() -> dict[str, Any]:
    with _lock:
        return dict(_state)


def run_sync_cycle(
    *,
    lookback_minutes: int | None = None,
    max_per_cycle: int | None = None,
    process_now: bool = False,
    run_backfill: bool | None = None,
) -> dict[str, Any]:
    """One incremental sync pass. process_now=False queues QA in background."""
    with _lock:
        minutes = lookback_minutes or int(_state["lookback_minutes"])
        max_recs = max_per_cycle or int(_state["max_per_cycle"])
        safety_hours = max(0, int(_state["safety_lookback_hours"]))
        max_logs = int(_state["max_call_logs_per_cycle"])
        backfill_days = max(0, int(_state["backfill_days"]))
        backfill_interval_hours = max(1, int(_state["backfill_interval_hours"]))
        backfill_max = max(1, int(_state["backfill_max"]))
        last_backfill_at = _state.get("last_backfill_at")
        _state["last_started_at"] = datetime.now(timezone.utc).isoformat()
        _state["last_error"] = None

    due_backfill = _backfill_is_due(
        last_backfill_at,
        interval_hours=backfill_interval_hours,
        enabled=backfill_days > 0,
        forced=run_backfill,
    )

    try:
        summary = sync_company_recordings(
            minutes_back=minutes,
            max_recordings=max_recs,
            process_now=process_now,
        )
        safety_summary: dict[str, Any] | None = None
        if safety_hours * 60 > minutes:
            safety_summary = sync_company_recordings(
                hours_back=safety_hours,
                max_recordings=max_recs,
                process_now=process_now,
            )
            logger.info(
                "VBC safety pass (%sh): listed=%s queued=%s skipped_existing=%s",
                safety_hours,
                safety_summary.get("listed"),
                safety_summary.get("queued"),
                safety_summary.get("skipped_existing"),
            )

        cdr_minutes = max(minutes, safety_hours * 60 if safety_hours else 0)
        cdr_summary: dict[str, Any] | None = None
        try:
            cdr_summary = sync_call_logs(
                minutes_back=cdr_minutes or minutes,
                max_logs=max_logs,
                match_calls=True,
            )
            logger.info(
                "VBC CDR cycle: listed=%s upserted=%s matched=%s missed=%s unrecorded=%s errors=%s",
                cdr_summary.get("listed"),
                cdr_summary.get("upserted"),
                cdr_summary.get("matched"),
                cdr_summary.get("missed"),
                cdr_summary.get("unrecorded"),
                len(cdr_summary.get("errors") or []),
            )
        except Exception as cdr_exc:  # noqa: BLE001
            # Recordings succeeded — keep going; surface CDR error separately.
            logger.exception("VBC CDR sync failed (recordings OK)")
            cdr_summary = {"error": str(cdr_exc)}

        completeness_hours = max(safety_hours, max(1, (minutes + 59) // 60))
        completeness_summary: dict[str, Any] | None = None
        try:
            completeness_summary = ingest_missing_recorded_cdrs(
                hours_back=completeness_hours,
                max_recordings=max_recs,
                process_now=process_now,
            )
            logger.info(
                "VBC completeness: candidates=%s queued=%s no_recording=%s existing=%s errors=%s",
                completeness_summary.get("candidates"),
                completeness_summary.get("queued"),
                completeness_summary.get("skipped_no_recording"),
                completeness_summary.get("skipped_existing"),
                len(completeness_summary.get("errors") or []),
            )
        except Exception as complete_exc:  # noqa: BLE001
            logger.exception("VBC completeness ingest failed")
            completeness_summary = {"error": str(complete_exc)}

        backfill_summary: dict[str, Any] | None = None
        if due_backfill:
            try:
                backfill_summary = _run_backfill(
                    days=backfill_days,
                    max_recordings=backfill_max,
                    max_logs=max(max_logs, backfill_max),
                    process_now=process_now,
                )
                with _lock:
                    _state["last_backfill_at"] = datetime.now(timezone.utc).isoformat()
                    _state["last_backfill_summary"] = backfill_summary
                logger.info(
                    "VBC %s-day backfill: recordings queued=%s completeness queued=%s",
                    backfill_days,
                    (backfill_summary.get("recordings") or {}).get("queued"),
                    (backfill_summary.get("completeness") or {}).get("queued"),
                )
            except Exception as backfill_exc:  # noqa: BLE001
                logger.exception("VBC daily backfill failed")
                backfill_summary = {"error": str(backfill_exc)}

        with _lock:
            _state["last_summary"] = summary
            _state["last_cdr_summary"] = cdr_summary
            _state["last_completeness_summary"] = completeness_summary
            _state["last_finished_at"] = datetime.now(timezone.utc).isoformat()
            _state["cycles"] = int(_state["cycles"]) + 1
        logger.info(
            "VBC poll cycle: listed=%s queued=%s skipped_existing=%s skipped_short=%s errors=%s",
            summary.get("listed"),
            summary.get("queued"),
            summary.get("skipped_existing"),
            summary.get("skipped_short"),
            len(summary.get("errors") or []),
        )

        # Opportunistic contracts maintenance (same 5-minute cycle)
        result: dict[str, Any] = {
            **summary,
            "safety": safety_summary,
            "call_logs": cdr_summary,
            "completeness": completeness_summary,
            "backfill": backfill_summary,
        }
        try:
            from src.contracts_pipeline import process_pending_contracts
            from src.notify import check_contract_expiry_alerts
            from src.config import get_settings

            settings = get_settings()
            result["contracts"] = process_pending_contracts(limit=5)
            result["contract_expiry"] = check_contract_expiry_alerts(
                within_days=int(settings.contract_alert_days or 90)
            )
        except Exception as contracts_exc:  # noqa: BLE001
            logger.exception("Contracts maintenance during poll cycle failed")
            result["contracts_error"] = str(contracts_exc)

        try:
            from src.time_clock_alerts import check_time_clock_reminders

            result["time_clock_reminders"] = check_time_clock_reminders()
        except Exception as clock_exc:  # noqa: BLE001
            logger.exception("Time clock reminders during poll cycle failed")
            result["time_clock_reminders_error"] = str(clock_exc)

        return result
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state["last_error"] = str(exc)
            _state["last_finished_at"] = datetime.now(timezone.utc).isoformat()
        logger.exception("VBC poll cycle failed")
        raise


def _backfill_is_due(
    last_backfill_at: str | None,
    *,
    interval_hours: int,
    enabled: bool,
    forced: bool | None,
) -> bool:
    if forced is False or not enabled:
        return False
    if forced is True:
        return True
    if not last_backfill_at:
        return True
    try:
        previous = datetime.fromisoformat(str(last_backfill_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    if previous.tzinfo is None:
        previous = previous.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - previous).total_seconds()
    return elapsed >= interval_hours * 3600


def _run_backfill(
    *,
    days: int,
    max_recordings: int,
    max_logs: int,
    process_now: bool,
) -> dict[str, Any]:
    recordings = sync_company_recordings(
        days_back=days,
        max_recordings=max_recordings,
        process_now=process_now,
    )
    call_logs: dict[str, Any] | None = None
    try:
        call_logs = sync_call_logs(
            days_back=days,
            max_logs=max_logs,
            match_calls=True,
        )
    except Exception as cdr_exc:  # noqa: BLE001
        logger.exception("VBC backfill CDR sync failed")
        call_logs = {"error": str(cdr_exc)}
    completeness = ingest_missing_recorded_cdrs(
        days_back=days,
        max_recordings=max_recordings,
        process_now=process_now,
    )
    return {
        "days": days,
        "recordings": recordings,
        "call_logs": call_logs,
        "completeness": completeness,
    }


def _loop() -> None:
    with _lock:
        _state["running"] = True
    logger.info(
        "VBC recording poller started (interval=%ss lookback=%sm safety=%sh)",
        _state["interval_seconds"],
        _state["lookback_minutes"],
        _state["safety_lookback_hours"],
    )
    while not _stop.is_set():
        try:
            run_sync_cycle(process_now=False)
        except Exception:
            pass
        _stop.wait(timeout=float(_state["interval_seconds"]))
    with _lock:
        _state["running"] = False
    logger.info("VBC recording poller stopped")


def start_poller(
    *,
    interval_seconds: int | None = None,
    lookback_minutes: int | None = None,
    max_per_cycle: int | None = None,
) -> dict[str, Any]:
    global _thread
    with _lock:
        if interval_seconds is not None:
            _state["interval_seconds"] = max(15, int(interval_seconds))
        if lookback_minutes is not None:
            _state["lookback_minutes"] = max(5, int(lookback_minutes))
        if max_per_cycle is not None:
            _state["max_per_cycle"] = max(1, int(max_per_cycle))
        if _thread and _thread.is_alive():
            return poller_status()
        _stop.clear()
        _thread = threading.Thread(target=_loop, name="vbc-poller", daemon=True)
        _thread.start()
    return poller_status()


def stop_poller() -> dict[str, Any]:
    _stop.set()
    thread = _thread
    if thread and thread.is_alive():
        thread.join(timeout=5)
    return poller_status()


def autostart_from_env() -> dict[str, Any] | None:
    """Start poller when VBC_POLLER_ENABLED=1 (used by webhook service)."""
    enabled = os.getenv("VBC_POLLER_ENABLED", "").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        return None
    interval = int(os.getenv("VBC_POLLER_INTERVAL_SECONDS", "300"))
    lookback = int(os.getenv("VBC_POLLER_LOOKBACK_MINUTES", "30"))
    max_cycle = int(os.getenv("VBC_POLLER_MAX_PER_CYCLE", "50"))
    max_logs = int(os.getenv("VBC_POLLER_MAX_CALL_LOGS", "400"))
    safety_hours = int(os.getenv("VBC_POLLER_SAFETY_LOOKBACK_HOURS", "6"))
    backfill_days = int(os.getenv("VBC_POLLER_BACKFILL_DAYS", "2"))
    backfill_interval = int(os.getenv("VBC_POLLER_BACKFILL_INTERVAL_HOURS", "24"))
    backfill_max = int(os.getenv("VBC_POLLER_BACKFILL_MAX", "200"))
    with _lock:
        _state["max_call_logs_per_cycle"] = max(1, max_logs)
        _state["safety_lookback_hours"] = max(0, safety_hours)
        _state["backfill_days"] = max(0, backfill_days)
        _state["backfill_interval_hours"] = max(1, backfill_interval)
        _state["backfill_max"] = max(1, backfill_max)
    return start_poller(
        interval_seconds=interval,
        lookback_minutes=lookback,
        max_per_cycle=max_cycle,
    )
