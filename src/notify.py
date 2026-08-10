"""Outbound alerts via Google Chat incoming webhooks."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from src.config import get_settings

logger = logging.getLogger(__name__)


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
    # Critical / medical flags always use the Call Alerts webhook only.
    if not settings.alerts_enabled or not (settings.gchat_webhook_url or "").strip():
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
    sent = notify_gchat(text, webhook_url=settings.gchat_webhook_url)
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

def alert_missed_call(
    *,
    log_id: str,
    direction: str | None,
    result: str | None,
    from_number: str | None,
    to_number: str | None = None,
    agent_name: str | None = None,
    extension: str | None = None,
    start: datetime | None = None,
    is_missed: bool | None = None,
    max_age_minutes: int | None = None,
) -> bool:
    """Post one Google Chat alert per missed inbound CDR (deduped by log id).

    Uses GCHAT_MISSED_CALLS_WEBHOOK_URL only — never the critical Call Alerts webhook.
    """
    settings = get_settings()
    missed_url = (settings.gchat_missed_calls_webhook_url or "").strip()
    if not settings.alerts_enabled or not missed_url:
        return False

    from src.twilio_sms import (
        call_is_recent_enough,
        is_qualifying_missed_inbound,
    )

    if not is_qualifying_missed_inbound(
        direction=direction, result=result, is_missed=is_missed
    ):
        return False

    age_limit = (
        max_age_minutes
        if max_age_minutes is not None
        else max(1, int(settings.missed_alert_max_age_minutes))
    )
    if not call_is_recent_enough(start, max_age_minutes=age_limit):
        return False

    cid = (log_id or "").strip()
    if not cid:
        return False

    key = f"missed_call_{cid}"
    try:
        from src import database as db

        # Long cooldown: re-sync of the same CDR must not re-alert.
        if db.alert_recently_sent(key, cooldown_minutes=7 * 24 * 60):
            return False
    except Exception:
        logger.exception("Missed-call alert dedup failed")

    agent = (agent_name or "").strip() or "Unknown"
    ext = (extension or "").strip()
    if ext and ext not in agent:
        agent = f"{agent} (ext {ext})"
    when = ""
    if isinstance(start, datetime):
        aware = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
        when = aware.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    ops = f"{settings.app_url.rstrip('/')}/ops?days=1"
    result_label = (result or "missed").strip() or "missed"
    result_l = result_label.lower()
    if "voicemail" in result_l or "voice mail" in result_l:
        headline = "Inbound voicemail"
    elif "abandon" in result_l:
        headline = "Abandoned inbound call"
    else:
        headline = "Missed inbound call"
    text = (
        f"*{headline}*\n"
        f"From: {_format_phone(from_number)}\n"
        f"To: {(to_number or '').strip() or '—'}\n"
        f"Agent / ext: {agent}\n"
        f"Result: {result_label}\n"
        f"When: {when or 'unknown'}\n"
        f"Call ops: {ops}"
    )
    sent = notify_gchat(text, webhook_url=missed_url)
    if sent:
        try:
            from src import database as db

            db.mark_alert_sent(key)
        except Exception:
            logger.exception("Failed to stamp missed-call alert_state")
    return sent


def alert_missed_spike(
    *,
    window_minutes: int,
    missed_count: int,
    threshold: int,
    answered_count: int,
) -> bool:
    """Optional volume spike summary to the missed-calls Chat space."""
    settings = get_settings()
    missed_url = (settings.gchat_missed_calls_webhook_url or "").strip()
    if not settings.alerts_enabled or not missed_url:
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
    return notify_gchat(text, webhook_url=missed_url)


def alert_contract_expiry(
    *,
    contract_id: str,
    title: str,
    vendor_name: str | None,
    relevant_end_date: str | None,
    notice_deadline: str | None = None,
    days_left: int | None = None,
    alert_kind: str = "expiry",
) -> bool:
    """Alert when a contract end date or notice deadline is within the window.

    Uses GCHAT_CONTRACTS_WEBHOOK_URL only — never the Call QA webhook.
    """
    settings = get_settings()
    contracts_url = (settings.gchat_contracts_webhook_url or "").strip()
    if not settings.contract_alerts_enabled or not contracts_url:
        return False

    today = datetime.now(timezone.utc).date().isoformat()
    key = f"contract_{alert_kind}:{contract_id}:{today}"
    try:
        from src import database as db

        # Once per calendar day per contract/kind
        if db.alert_recently_sent(key, cooldown_minutes=20 * 60):
            return False
    except Exception:
        logger.exception("Contract alert dedup failed")

    app_url = settings.app_url.rstrip("/")
    if "8501" in app_url:
        app_url = app_url.replace("8501", "3000")
    link = f"{app_url}/contracts/{contract_id}"
    vendor = (vendor_name or "Unknown vendor").strip() or "Unknown vendor"
    kind_label = "Notice deadline" if alert_kind == "notice" else "Contract expiry"
    days_bit = f" ({days_left} days left)" if days_left is not None else ""
    date_bit = relevant_end_date or "unknown date"
    notice_bit = (
        f"\nNotice deadline: {notice_deadline}" if notice_deadline else ""
    )
    text = (
        f"*{kind_label}*{days_bit}\n"
        f"Contract: {title or 'Untitled'}\n"
        f"Vendor: {vendor}\n"
        f"End date: {date_bit}{notice_bit}\n"
        f"Review: {link}"
    )
    sent = notify_gchat(text, webhook_url=contracts_url)
    if sent:
        try:
            from src import database as db

            db.mark_alert_sent(key)
        except Exception:
            logger.exception("Failed to stamp contract alert_state")
    return sent


def check_contract_expiry_alerts(*, within_days: int = 90) -> dict[str, Any]:
    """Scan active contracts and send GChat alerts for upcoming end/notice dates."""
    settings = get_settings()
    if settings.database_backend != "postgres":
        return {"sent": 0, "skipped": 0, "errors": ["postgres required"]}
    if not settings.contract_alerts_enabled or not (
        settings.gchat_contracts_webhook_url or ""
    ).strip():
        return {"sent": 0, "skipped": 0, "errors": ["contract alerts disabled"]}

    from src import database as db

    rows = db.list_contracts_for_expiry_alerts(within_days=within_days)
    sent = 0
    skipped = 0
    errors: list[str] = []
    today = datetime.now(timezone.utc).date()

    for row in rows:
        contract_id = str(row.get("id") or "")
        if not contract_id:
            continue
        end_raw = row.get("relevant_end_date") or row.get("expiration_date") or row.get(
            "term_end_date"
        )
        notice_raw = row.get("notice_deadline")
        try:
            end_date = None
            if end_raw:
                end_date = datetime.fromisoformat(str(end_raw)[:10]).date()
            notice_date = None
            if notice_raw:
                notice_date = datetime.fromisoformat(str(notice_raw)[:10]).date()

            # Prefer notice alert when notice deadline is in window and sooner/equal.
            alert_kind = "expiry"
            focus_date = end_date
            if notice_date is not None and 0 <= (notice_date - today).days <= within_days:
                if end_date is None or notice_date <= end_date:
                    alert_kind = "notice"
                    focus_date = notice_date

            days_left = (focus_date - today).days if focus_date else None
            ok = alert_contract_expiry(
                contract_id=contract_id,
                title=str(row.get("title") or ""),
                vendor_name=row.get("vendor_name"),
                relevant_end_date=str(end_raw)[:10] if end_raw else None,
                notice_deadline=str(notice_raw)[:10] if notice_raw else None,
                days_left=days_left,
                alert_kind=alert_kind,
            )
            if ok:
                sent += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Contract expiry alert failed for %s", contract_id)
            errors.append(f"{contract_id}: {exc}")
    return {"sent": sent, "skipped": skipped, "checked": len(rows), "errors": errors}
