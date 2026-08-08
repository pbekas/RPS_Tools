"""Outbound Twilio SMS when a patient inbound call is missed."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_MESSAGE = (
    "Thanks for calling Relevium Pain Specialists! We're currently unavailable, "
    "but if you're looking to schedule an appointment or have questions about your visit, "
    "reply here and our team will follow up right away."
)

_CUSTOMEDICO_DID_DIGITS = "4806264810"
# VBC often stores the dialed DID as the pharmacy extension on CDRs.
_CUSTOMEDICO_EXTENSIONS = frozenset({"45000"})
_CUSTOMEDICO_FROM_NUMBER = "+17028197515"
_CUSTOMEDICO_MESSAGE = (
    "Thanks for calling Customedico! We're currently unavailable, "
    "but if you have a pharmacy or prescription question, "
    "reply here and our team will follow up right away."
)

# Non-answered results we intentionally treat as patient follow-up SMS.
# Busy is included (caller did not get through); see product notes in README.
_ANSWERED_RESULTS = frozenset({"answered", "connected"})


def phone_digits(value: str | None) -> str:
    return re.sub(r"\D", "", (value or "").strip())


def is_customedico_dialed_number(*candidates: str | None) -> bool:
    """True when the inbound dialed number / DNIS / ext is Customedico."""
    target = _CUSTOMEDICO_DID_DIGITS
    for raw in candidates:
        digits = phone_digits(raw)
        if not digits:
            continue
        if digits in _CUSTOMEDICO_EXTENSIONS:
            return True
        if digits == target or digits.endswith(target) or digits == f"1{target}":
            return True
    return False


def resolve_missed_sms_from_number(
    *,
    to_number: str | None = None,
    dnis: str | None = None,
    destination_extension: str | None = None,
    default_from: str | None = None,
    customedico_from: str | None = None,
) -> str:
    """Pick Twilio From number: Customedico DID uses pharmacy SMS line."""
    if is_customedico_dialed_number(to_number, dnis, destination_extension):
        custom = (customedico_from or "").strip()
        return custom or _CUSTOMEDICO_FROM_NUMBER
    return (default_from or "").strip()


def resolve_missed_sms_template(
    *,
    to_number: str | None = None,
    dnis: str | None = None,
    destination_extension: str | None = None,
    default_template: str | None = None,
    customedico_template: str | None = None,
) -> str:
    """Pick Relevium vs Customedico SMS copy based on the dialed line."""
    if is_customedico_dialed_number(to_number, dnis, destination_extension):
        custom = (customedico_template or "").strip()
        return custom or _CUSTOMEDICO_MESSAGE
    default = (default_template or "").strip()
    return default or _DEFAULT_MESSAGE


def normalize_e164(phone: str | None) -> str | None:
    """Normalize a phone string to E.164 when possible (NANP-friendly)."""
    raw = (phone or "").strip()
    if not raw:
        return None
    if raw.startswith("+"):
        digits = re.sub(r"\D", "", raw[1:])
        if 10 <= len(digits) <= 15:
            return f"+{digits}"
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if 10 <= len(digits) <= 15:
        return f"+{digits}"
    return None


def is_smsable_number(e164: str | None) -> bool:
    """Reject short/internal extensions and malformed E.164 values."""
    if not e164 or not e164.startswith("+"):
        return False
    digits = e164[1:]
    if not digits.isdigit():
        return False
    # Extensions / internal dial plans are typically < 10 digits.
    if len(digits) < 10 or len(digits) > 15:
        return False
    # All-zero / obviously invalid.
    if set(digits) == {"0"}:
        return False
    return True


def is_qualifying_missed_inbound(
    *,
    direction: str | None,
    result: str | None,
    is_missed: bool | None = None,
) -> bool:
    """True for inbound CDRs that were not answered/connected."""
    if (direction or "").strip().lower() != "inbound":
        return False
    text = (result or "").strip().lower()
    if text in _ANSWERED_RESULTS:
        return False
    if is_missed is True:
        return True
    if not text:
        return False
    return True


def call_is_recent_enough(
    start: datetime | None,
    *,
    max_age_minutes: int,
    now: datetime | None = None,
) -> bool:
    """Skip backfill / long lookback windows so we don't SMS historical CDRs."""
    if start is None:
        return False
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    age = current - start
    return age <= timedelta(minutes=max(1, max_age_minutes))


def should_send_missed_call_sms(
    *,
    direction: str | None,
    result: str | None,
    from_number: str | None,
    start: datetime | None = None,
    is_missed: bool | None = None,
    enabled: bool = True,
    credentials_ready: bool = True,
    max_age_minutes: int = 120,
    now: datetime | None = None,
) -> tuple[bool, str]:
    """
    Pure gate for missed-call SMS.

    Returns (should_send, reason). reason is useful for logs/tests.
    """
    if not enabled:
        return False, "disabled"
    if not credentials_ready:
        return False, "credentials_missing"
    if not is_qualifying_missed_inbound(
        direction=direction, result=result, is_missed=is_missed
    ):
        return False, "not_qualifying_inbound_missed"
    if not call_is_recent_enough(start, max_age_minutes=max_age_minutes, now=now):
        return False, "too_old_or_missing_start"
    e164 = normalize_e164(from_number)
    if not is_smsable_number(e164):
        return False, "invalid_from_number"
    return True, "ok"


def render_missed_sms_body(
    template: str | None = None,
    *,
    main_line: str | None = None,
) -> str:
    text = (template or "").strip() or _DEFAULT_MESSAGE
    line = (main_line or "").strip()
    try:
        return text.format(main_line=line or "our main line")
    except (KeyError, ValueError, IndexError):
        return text


def alert_key_for_number(e164: str) -> str:
    return f"missed_sms_{e164}"


def send_sms(
    to_e164: str,
    body: str,
    *,
    from_number: str | None = None,
    status_callback: str | None = None,
) -> bool:
    """Send one SMS via Twilio REST API. Returns True on HTTP success."""
    import httpx

    from src.config import get_settings

    settings = get_settings()
    sid = settings.twilio_account_sid
    token = settings.twilio_auth_token
    sender = (from_number or "").strip() or settings.twilio_from_number
    if not (sid and token and sender):
        logger.warning("Twilio credentials incomplete — skip SMS to %s", to_e164)
        return False

    data: dict[str, str] = {
        "To": to_e164,
        "From": sender,
        "Body": body,
    }
    callback = (status_callback or settings.twilio_status_callback_url or "").strip()
    if callback:
        data["StatusCallback"] = callback

    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(url, data=data, auth=(sid, token))
        if resp.status_code >= 400:
            logger.warning(
                "Twilio SMS failed (%s) to %s: %s",
                resp.status_code,
                to_e164,
                resp.text[:400],
            )
            return False
        logger.info(
            "Twilio SMS queued to %s from %s (sid=%s)",
            to_e164,
            sender,
            resp.json().get("sid"),
        )
        return True
    except Exception:
        logger.exception("Twilio SMS error to %s", to_e164)
        return False


def _log_fields(log: Any) -> dict[str, Any]:
    if isinstance(log, dict):
        raw = log.get("raw") if isinstance(log.get("raw"), dict) else {}
        return {
            **log,
            "dnis": log.get("dnis")
            or raw.get("dnis")
            or raw.get("to")
            or raw.get("to_number"),
            "destination_extension": log.get("destination_extension")
            or raw.get("destination_extension"),
        }
    raw = getattr(log, "raw", None)
    raw = raw if isinstance(raw, dict) else {}
    return {
        "direction": getattr(log, "direction", None),
        "result": getattr(log, "result", None),
        "from_number": getattr(log, "from_number", None),
        "to_number": getattr(log, "to_number", None),
        "destination_extension": getattr(log, "destination_extension", None)
        or raw.get("destination_extension"),
        "start": getattr(log, "start", None),
        "is_missed": bool(getattr(log, "is_missed", False)),
        "log_id": getattr(log, "log_id", None) or getattr(log, "id", None),
        "dnis": raw.get("dnis") or raw.get("to") or raw.get("to_number"),
    }


def maybe_notify_missed_inbound_call(log: Any) -> bool:
    """
    After a CDR upsert, optionally SMS the caller for a missed inbound.

    Never raises — failures are logged and swallowed so CDR sync continues.
    Dedups via alert_state keyed by normalized phone + cooldown window.
    Customedico DID (480) 626-4810 gets pharmacy-branded copy.
    """
    try:
        from src.config import get_settings

        settings = get_settings()
        fields = _log_fields(log)
        ok, reason = should_send_missed_call_sms(
            direction=fields.get("direction"),
            result=fields.get("result"),
            from_number=fields.get("from_number"),
            start=fields.get("start") if isinstance(fields.get("start"), datetime) else None,
            is_missed=fields.get("is_missed"),
            enabled=settings.twilio_missed_sms_enabled,
            credentials_ready=settings.twilio_configured,
            max_age_minutes=settings.twilio_missed_sms_max_age_minutes,
        )
        if not ok:
            logger.debug(
                "Missed-call SMS skipped (%s) log_id=%s",
                reason,
                fields.get("log_id"),
            )
            return False

        e164 = normalize_e164(fields.get("from_number"))
        assert e164  # gated by should_send
        key = alert_key_for_number(e164)

        from src import database as db

        cooldown = settings.twilio_missed_sms_cooldown_minutes
        if db.alert_recently_sent(key, cooldown_minutes=cooldown):
            logger.info(
                "Missed-call SMS cooldown active for %s (log_id=%s)",
                e164,
                fields.get("log_id"),
            )
            return False

        template = resolve_missed_sms_template(
            to_number=fields.get("to_number"),
            dnis=fields.get("dnis"),
            destination_extension=fields.get("destination_extension"),
            default_template=settings.twilio_missed_sms_message,
            customedico_template=settings.twilio_missed_sms_message_customedico,
        )
        body = render_missed_sms_body(
            template,
            main_line=settings.twilio_missed_sms_main_line,
        )
        from_number = resolve_missed_sms_from_number(
            to_number=fields.get("to_number"),
            dnis=fields.get("dnis"),
            destination_extension=fields.get("destination_extension"),
            default_from=settings.twilio_from_number,
            customedico_from=settings.twilio_from_number_customedico,
        )
        sent = send_sms(e164, body, from_number=from_number)
        if sent:
            db.mark_alert_sent(key)
            logger.info(
                "Missed-call SMS sent to %s from %s (customedico=%s log_id=%s)",
                e164,
                from_number,
                is_customedico_dialed_number(
                    fields.get("to_number"),
                    fields.get("dnis"),
                    fields.get("destination_extension"),
                ),
                fields.get("log_id"),
            )
        return sent
    except Exception:
        logger.exception("Missed-call SMS notify failed")
        return False
