"""Outbound alerts via Google Chat incoming webhooks."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from src.config import get_settings

logger = logging.getLogger(__name__)


def notify_gchat(text: str, *, card: dict[str, Any] | None = None) -> bool:
    """Post to GCHAT_WEBHOOK_URL. Returns True if sent."""
    settings = get_settings()
    url = (settings.gchat_webhook_url or "").strip()
    if not url:
        logger.debug("GCHAT_WEBHOOK_URL not set — skip alert")
        return False
    payload: dict[str, Any]
    if card:
        payload = card
    else:
        payload = {"text": text}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, json=payload)
        if resp.status_code >= 400:
            logger.warning(
                "Google Chat alert failed (%s): %s", resp.status_code, resp.text[:300]
            )
            return False
        return True
    except Exception:
        logger.exception("Google Chat alert error")
        return False


def _review_url(call_id: str) -> str:
    settings = get_settings()
    app_url = settings.app_url.rstrip("/")
    if "8501" in app_url:
        app_url = app_url.replace("8501", "3000")
    return f"{app_url}/calls/{call_id}"


def _format_phone(phone: str | None) -> str:
    raw = (phone or "").strip()
    if not raw:
        return "Unknown"
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"
    return raw


def alert_critical_flags(
    *,
    call_id: str,
    agent_name: str | None,
    agent_email: str | None,
    patient_name: str | None,
    phone: str | None = None,
    doctor_name: str | None = None,
    flags: list[dict[str, Any]],
) -> bool:
    settings = get_settings()
    if not settings.alerts_enabled:
        return False
    triggered = [f for f in flags if f.get("triggered") is not False]
    if not triggered:
        return False

    # Dedup: skip if already alerted for this call
    try:
        from src import database as db

        existing = db.get_call(call_id)
        if existing and existing.get("critical_alert_sent_at"):
            return False
    except Exception:
        pass

    labels = ", ".join(
        str(f.get("label") or f.get("flag_id") or "flag") for f in triggered
    )
    review = _review_url(call_id)
    agent = agent_name or "Unknown"
    if agent_email:
        agent = f"{agent} ({agent_email})"

    doctor = (doctor_name or "").strip()
    text = (
        f"*Critical call flag(s):* {labels}\n"
        f"Caller: {patient_name or 'Unknown'}\n"
        f"Phone: {_format_phone(phone)}\n"
        f"Doctor: {doctor or 'Not mentioned'}\n"
        f"Agent: {agent}\n"
        f"Review: {review}"
    )
    sent = notify_gchat(text)
    if sent:
        try:
            from src import database as db

            db.update_call(
                call_id,
                {"critical_alert_sent_at": datetime.now(timezone.utc)},
            )
        except Exception:
            logger.exception("Failed to stamp critical_alert_sent_at")
    return sent

def alert_missed_spike(
    *,
    window_minutes: int,
    missed_count: int,
    threshold: int,
    answered_count: int,
) -> bool:
    settings = get_settings()
    if not settings.alerts_enabled:
        return False
    if missed_count < threshold:
        return False

    # Dedup window key
    try:
        from src import database as db

        key = f"missed_spike_{window_minutes}m"
        if db.alert_recently_sent(key, cooldown_minutes=window_minutes):
            return False
        db.mark_alert_sent(key)
    except Exception:
        logger.exception("Missed-spike dedup failed")

    total = missed_count + answered_count
    rate = (missed_count / total * 100) if total else 0
    ops = f"{settings.app_url.rstrip('/')}/ops"
    text = (
        f"*Missed-call spike*\n"
        f"Last {window_minutes} minutes: *{missed_count}* missed/non-answered "
        f"(threshold {threshold})\n"
        f"Answered in window: {answered_count} · miss share ~{rate:.0f}%\n"
        f"Call ops: {ops}"
    )
    return notify_gchat(text)
