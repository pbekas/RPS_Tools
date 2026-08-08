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
from src.vonage_sync import sync_company_recordings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_thread: threading.Thread | None = None
_stop = threading.Event()
_state: dict[str, Any] = {
    "running": False,
    "interval_seconds": 300,
    "lookback_minutes": 30,
    "max_per_cycle": 25,
    "max_call_logs_per_cycle": 200,
    "last_started_at": None,
    "last_finished_at": None,
    "last_summary": None,
    "last_cdr_summary": None,
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
) -> dict[str, Any]:
    """One incremental sync pass. process_now=False queues QA in background."""
    with _lock:
        minutes = lookback_minutes or int(_state["lookback_minutes"])
        max_recs = max_per_cycle or int(_state["max_per_cycle"])
        _state["last_started_at"] = datetime.now(timezone.utc).isoformat()
        _state["last_error"] = None

    try:
        summary = sync_company_recordings(
            minutes_back=minutes,
            max_recordings=max_recs,
            process_now=process_now,
        )
        cdr_summary: dict[str, Any] | None = None
        try:
            with _lock:
                max_logs = int(_state["max_call_logs_per_cycle"])
            cdr_summary = sync_call_logs(
                minutes_back=minutes,
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

        with _lock:
            _state["last_summary"] = summary
            _state["last_cdr_summary"] = cdr_summary
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
        return {**summary, "call_logs": cdr_summary}
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state["last_error"] = str(exc)
            _state["last_finished_at"] = datetime.now(timezone.utc).isoformat()
        logger.exception("VBC poll cycle failed")
        raise


def _loop() -> None:
    with _lock:
        _state["running"] = True
    logger.info(
        "VBC recording poller started (interval=%ss lookback=%sm)",
        _state["interval_seconds"],
        _state["lookback_minutes"],
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
    max_cycle = int(os.getenv("VBC_POLLER_MAX_PER_CYCLE", "25"))
    max_logs = int(os.getenv("VBC_POLLER_MAX_CALL_LOGS", "200"))
    with _lock:
        _state["max_call_logs_per_cycle"] = max(1, max_logs)
    return start_poller(
        interval_seconds=interval,
        lookback_minutes=lookback,
        max_per_cycle=max_cycle,
    )
