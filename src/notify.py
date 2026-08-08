"""Outbound alerts via Google Chat incoming webhooks."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from src.config import get_settings

logger = logging.getLogger(__name__)

_PT = ZoneInfo("America/Los_Angeles")


def notify_gchat(
    text: str,
    *,
    card: dict[str, Any] | None = None,
    webhook_url: str | None = None,
) -> bool:
    """Post to a Google Chat incoming webhook. Returns True if sent."""
    settings = get_settings()
    url = (webhook_url if webhook_url is not None else settings.gchat_webhook_url or "").strip()
    if not url:
        logger.debug("Google Chat webhook not set — skip alert")
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

def _format_datetime_pt(value: datetime | None) -> str:
    if value is None:
        return "Unknown"
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(_PT)
    return local.strftime("%a %b %d, %Y %I:%M %p %Z")


def _first_nonempty(*values: Any) -> str | None:
    for value in values:
        text = str(value or "").strip()
        if text and text.lower() not in {"unknown", "none", "null", "n/a"}:
            return text
    return None


def _caller_name_from_missed_log(
    log: Any,
    *,
    matched_call: dict[str, Any] | None = None,
) -> str | None:
    """Best-effort caller/patient name from CDR raw fields + matched QA call."""
    raw = getattr(log, "raw", None)
    if not isinstance(raw, dict):
        if isinstance(log, dict):
            raw = log.get("raw") if isinstance(log.get("raw"), dict) else log
        else:
            raw = {}
    raw = raw or {}

    name = _first_nonempty(
        raw.get("cnam"),
        raw.get("caller_name"),
        raw.get("from_name"),
        raw.get("from_cnam"),
        raw.get("caller_id_name"),
        raw.get("caller_id"),
        raw.get("cn"),
        getattr(log, "source_user_full_name", None),
        (log.get("source_user_full_name") if isinstance(log, dict) else None),
    )
    if matched_call:
        name = _first_nonempty(
            name,
            matched_call.get("patient_name"),
            matched_call.get("vonage_cnam"),
        )
    # Avoid treating a phone number as a "name"
    if name and name.replace("+", "").replace("-", "").replace(" ", "").isdigit():
        return None
    return name


def format_missed_call_gchat_text(
    *,
    from_number: str | None,
    to_number: str | None = None,
    caller_name: str | None = None,
    caller_id: str | None = None,
    start: datetime | None = None,
    result: str | None = None,
    destination_user: str | None = None,
    destination_extension: str | None = None,
    length_seconds: int | None = None,
    log_id: str | None = None,
    matched_call_id: str | None = None,
    sms_sent: bool | None = None,
) -> str:
    """Build the Google Chat body for a single missed inbound call."""
    phone = _format_phone(from_number)
    cid = _first_nonempty(caller_id, from_number) or "Unknown"
    name = _first_nonempty(caller_name) or "Unknown"
    when = _format_datetime_pt(start)
    lines = [
        "*Missed call*",
        f"Name: {name}",
        f"Phone: {phone}",
        f"Caller ID: {cid}",
        f"Date / time: {when}",
    ]
    if result:
        lines.append(f"Result: {result}")
    if to_number:
        lines.append(f"Called: {_format_phone(to_number)}")
    dest_bits = [b for b in (destination_user, destination_extension) if b]
    if dest_bits:
        lines.append(f"Destination: {' / '.join(dest_bits)}")
    if length_seconds is not None and length_seconds > 0:
        lines.append(f"Duration: {length_seconds}s")
    if sms_sent is True:
        lines.append("Patient SMS: sent")
    elif sms_sent is False:
        lines.append("Patient SMS: not sent")
    if matched_call_id:
        lines.append(f"Review: {_review_url(matched_call_id)}")
    elif log_id:
        lines.append(f"CDR: {log_id}")
    return "\n".join(lines)


def alert_missed_inbound_call(
    log: Any,
    *,
    matched_call_id: str | None = None,
    matched_call: dict[str, Any] | None = None,
    sms_sent: bool | None = None,
) -> bool:
    """
    Post one Google Chat alert for a missed inbound CDR.

    Dedups per CDR id so re-syncs do not spam the Space. Independent of Twilio SMS.
    """
    settings = get_settings()
    if not settings.alerts_master_enabled:
        return False
    webhook = (
        settings.gchat_missed_calls_webhook_url or settings.gchat_webhook_url or ""
    ).strip()
    if not webhook:
        return False

    if isinstance(log, dict):
        direction = log.get("direction")
        result = log.get("result")
        from_number = log.get("from_number")
        to_number = log.get("to_number")
        start = log.get("start")
        is_missed = log.get("is_missed")
        log_id = str(log.get("log_id") or log.get("id") or "").strip()
        destination_user = log.get("destination_user_full_name") or log.get(
            "destination_user"
        )
        destination_extension = log.get("destination_extension")
        length_seconds = log.get("length_seconds")
    else:
        direction = getattr(log, "direction", None)
        result = getattr(log, "result", None)
        from_number = getattr(log, "from_number", None)
        to_number = getattr(log, "to_number", None)
        start = getattr(log, "start", None)
        is_missed = getattr(log, "is_missed", None)
        log_id = str(getattr(log, "log_id", None) or getattr(log, "id", None) or "").strip()
        destination_user = getattr(log, "destination_user_full_name", None) or getattr(
            log, "destination_user", None
        )
        destination_extension = getattr(log, "destination_extension", None)
        length_seconds = getattr(log, "length_seconds", None)

    from src.twilio_sms import (
        call_is_recent_enough,
        is_qualifying_missed_inbound,
    )

    if not is_qualifying_missed_inbound(
        direction=direction, result=result, is_missed=is_missed
    ):
        return False

    max_age = settings.twilio_missed_sms_max_age_minutes
    if isinstance(start, datetime) and not call_is_recent_enough(
        start, max_age_minutes=max_age
    ):
        return False
    if start is not None and not isinstance(start, datetime):
        start = None

    if not log_id:
        log_id = f"unknown_{(from_number or 'na')}_{int(datetime.now(timezone.utc).timestamp())}"

    try:
        from src import database as db

        key = f"missed_call_gchat_{log_id}"
        if db.alert_recently_sent(key, cooldown_minutes=max(max_age, 120)):
            return False
    except Exception:
        logger.exception("Missed-call GChat dedup failed")
        key = None

    if matched_call is None and matched_call_id:
        try:
            from src import database as db

            matched_call = db.get_call(matched_call_id)
        except Exception:
            matched_call = None

    caller_name = _caller_name_from_missed_log(log, matched_call=matched_call)
    text = format_missed_call_gchat_text(
        from_number=from_number,
        to_number=to_number,
        caller_name=caller_name,
        caller_id=from_number,
        start=start if isinstance(start, datetime) else None,
        result=result,
        destination_user=destination_user,
        destination_extension=destination_extension,
        length_seconds=int(length_seconds) if length_seconds is not None else None,
        log_id=log_id,
        matched_call_id=matched_call_id,
        sms_sent=sms_sent,
    )
    sent = notify_gchat(text, webhook_url=webhook)
    if sent and key:
        try:
            from src import database as db

            db.mark_alert_sent(key)
        except Exception:
            logger.exception("Failed to stamp missed-call GChat alert_state")
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
