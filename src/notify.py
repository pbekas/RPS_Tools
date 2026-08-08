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


def is_voicemail_result(result: str | None) -> bool:
    text = (result or "").strip().lower()
    return "voicemail" in text or "voice mail" in text


def transcript_to_plain_text(
    transcript: Any,
    *,
    max_chars: int = 1400,
) -> str:
    """Flatten stored transcript turns into Chat-friendly plain text."""
    if transcript is None:
        return ""
    if isinstance(transcript, str):
        return transcript.strip()[:max_chars]

    turns: list[dict[str, Any]] = []
    if isinstance(transcript, list):
        turns = [t for t in transcript if isinstance(t, dict)]
    if not turns:
        return ""

    # Drop IVR/system prompts when other speech is present.
    preferred = [
        t
        for t in turns
        if str(t.get("speaker") or "").strip().lower() not in {"system", "ivr"}
    ]
    use = preferred if preferred else turns

    lines: list[str] = []
    for turn in use:
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        speaker = str(turn.get("speaker") or "").strip()
        if speaker and speaker.lower() not in {"system", "ivr"}:
            lines.append(f"{speaker}: {text}")
        else:
            lines.append(text)
    flat = "\n".join(lines).strip()
    if len(flat) <= max_chars:
        return flat
    return flat[: max_chars - 1].rstrip() + "…"


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
    voicemail_transcript: str | None = None,
    voicemail_status: str = "none",
) -> str:
    """Build the Google Chat body for a single missed inbound call.

    voicemail_status:
      - none: not a voicemail CDR → "No VM Detected"
      - transcript: include voicemail_transcript
      - unavailable: VM CDR but no transcript could be obtained
    """
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

    status = (voicemail_status or "none").strip().lower()
    if status == "transcript" and (voicemail_transcript or "").strip():
        lines.append("Voicemail transcript:")
        lines.append((voicemail_transcript or "").strip())
    elif status == "unavailable":
        lines.append("Voicemail: detected, but no transcript available")
    else:
        lines.append("Voicemail: No VM Detected")

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

    Voicemail CDRs wait briefly (up to 10 minutes) for a transcript before sending;
    after that we alert without transcript so staff can call back sooner.
    Non-voicemail misses get "No VM Detected".
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
        start = log.get("start") or log.get("start_at")
        is_missed = log.get("is_missed")
        log_id = str(log.get("log_id") or log.get("id") or "").strip()
        destination_user = log.get("destination_user_full_name") or log.get(
            "destination_user"
        )
        destination_extension = log.get("destination_extension")
        length_seconds = log.get("length_seconds")
        if not matched_call_id:
            matched_call_id = log.get("matched_call_id")
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

    if matched_call is None:
        matched_call = _find_call_for_missed_log(
            from_number=from_number,
            start=start if isinstance(start, datetime) else None,
        )
        if matched_call and not matched_call_id:
            matched_call_id = str(matched_call.get("id") or "") or None

    voicemail = is_voicemail_result(result)
    transcript_text = ""
    if matched_call:
        transcript_text = transcript_to_plain_text(matched_call.get("transcript"))

    # Prefer a quick call-back alert over waiting long for VM audio/transcript.
    _VM_TRANSCRIPT_WAIT_MINUTES = 10
    if voicemail:
        if transcript_text:
            voicemail_status = "transcript"
        elif isinstance(start, datetime) and call_is_recent_enough(
            start, max_age_minutes=_VM_TRANSCRIPT_WAIT_MINUTES
        ):
            # Recording/transcript often arrives after the CDR — retry next cycle.
            return False
        else:
            voicemail_status = "unavailable"
            transcript_text = ""
    else:
        voicemail_status = "none"
        transcript_text = ""

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
        voicemail_transcript=transcript_text or None,
        voicemail_status=voicemail_status,
    )
    sent = notify_gchat(text, webhook_url=webhook)
    if sent and key:
        try:
            from src import database as db

            db.mark_alert_sent(key)
        except Exception:
            logger.exception("Failed to stamp missed-call GChat alert_state")
    return sent


def _find_call_for_missed_log(
    *,
    from_number: str | None,
    start: datetime | None,
) -> dict[str, Any] | None:
    """Best-effort QA call match by caller + time when CDR matched_call_id is empty."""
    if start is None:
        return None
    try:
        from src import database as db
        from src.cdr_sync import _digits, _phones_match
    except Exception:
        return None

    needle = _digits(from_number)
    if not needle:
        return None
    try:
        calls = db.list_calls(limit=200, require_min_duration=False)
    except Exception:
        logger.exception("Failed listing calls for missed-call VM match")
        return None

    best: dict[str, Any] | None = None
    best_score = -1.0
    for call in calls:
        caller = _digits(call.get("vonage_caller_id"))
        if not caller or not _phones_match(needle, caller):
            continue
        call_dt = call.get("call_date") or call.get("created_at")
        if not isinstance(call_dt, datetime):
            continue
        if call_dt.tzinfo is None:
            call_dt = call_dt.replace(tzinfo=timezone.utc)
        start_aware = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
        delta = abs((call_dt - start_aware).total_seconds())
        if delta > 180:
            continue
        has_tx = 1.0 if transcript_to_plain_text(call.get("transcript")) else 0.0
        score = has_tx * 1000.0 - delta
        if score > best_score:
            best_score = score
            best = call
    return best


def maybe_alert_missed_call_for_processed_call(call: dict[str, Any]) -> bool:
    """After a recording is transcribed, retry missed-call GChat for a matching VM CDR."""
    transcript = transcript_to_plain_text(call.get("transcript"))
    if not transcript:
        return False
    try:
        from src import database as db
        from src.cdr_sync import _digits, _phones_match
    except Exception:
        return False

    caller = _digits(call.get("vonage_caller_id"))
    call_dt = call.get("call_date") or call.get("created_at")
    if not caller or not isinstance(call_dt, datetime):
        return False
    if call_dt.tzinfo is None:
        call_dt = call_dt.replace(tzinfo=timezone.utc)

    try:
        logs = db.list_call_logs(limit=300, days=2, missed_only=True)
    except Exception:
        logger.exception("Failed listing call logs for post-transcript VM alert")
        return False

    for row in logs:
        if not is_voicemail_result(row.get("result")):
            continue
        start = row.get("start") or row.get("start_at")
        if not isinstance(start, datetime):
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if abs((start - call_dt).total_seconds()) > 180:
            continue
        if not _phones_match(caller, _digits(row.get("from_number"))):
            continue
        return alert_missed_inbound_call(
            row,
            matched_call_id=str(call.get("id") or "") or None,
            matched_call=call,
        )
    return False


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
