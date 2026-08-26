"""Time clock reminder emails for open punches and missed punches."""

from __future__ import annotations

import html
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.config import get_settings
from src.mailer import send_email

logger = logging.getLogger(__name__)

_OPEN_PUNCH_COOLDOWN_MINUTES = 6 * 60
_DAILY_COOLDOWN_MINUTES = 20 * 60


def _time_value(value: Any) -> time:
    if isinstance(value, time):
        return value
    text = str(value or "00:00")
    parts = text.split(":")
    hour = int(parts[0]) if parts else 0
    minute = int(parts[1]) if len(parts) > 1 else 0
    return time(hour=hour, minute=minute)


def _effective_timezone(user_timezone: str | None, practice_timezone: str) -> str:
    tz = (user_timezone or "").strip()
    return tz or practice_timezone


def _local_now(tz_name: str) -> datetime:
    return datetime.now(ZoneInfo(tz_name))


def _minutes_since_midnight(now_local: datetime) -> int:
    return now_local.hour * 60 + now_local.minute


def _time_to_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _weekday_index(now_local: datetime) -> int:
    # Match JS localHourAndWeekday: Sunday=0 .. Saturday=6
    return (now_local.weekday() + 1) % 7


def _local_date_iso(now_local: datetime) -> str:
    return now_local.date().isoformat()


def _week_start_monday(now_local: datetime) -> date:
    return now_local.date() - timedelta(days=now_local.weekday())


def _app_url() -> str:
    settings = get_settings()
    app_url = settings.app_url.rstrip("/")
    if "8501" in app_url:
        app_url = app_url.replace("8501", "3000")
    return app_url


def get_time_clock_settings() -> dict[str, Any] | None:
    from src.postgres_db import get_connection

    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT max_open_hours::float8 AS max_open_hours,
                   reminder_enabled,
                   timezone,
                   remind_clock_in_enabled,
                   remind_clock_in_after,
                   remind_clock_out_enabled,
                   remind_clock_out_after,
                   remind_timesheet_enabled,
                   remind_timesheet_weekday,
                   remind_timesheet_after
            FROM time_clock_settings
            WHERE id = 'default'
            """
        ).fetchone()
    return dict(row) if row else None


def list_time_clock_users() -> list[dict[str, Any]]:
    from src.postgres_db import get_connection

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT u.email, u.name, u.timezone
            FROM users u
            WHERE u.active = true
              AND (
                u.role IN ('Admin', 'Supervisor')
                OR EXISTS (
                  SELECT 1 FROM unnest(COALESCE(u.modules, ARRAY[]::text[])) AS m(mod)
                  WHERE m.mod = 'time_clock'
                )
              )
            ORDER BY u.name ASC, u.email ASC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_open_entries_over_limit() -> list[dict[str, Any]]:
    """Return open time entries that exceed configured max open hours."""
    settings = get_time_clock_settings()
    if not settings or not settings.get("reminder_enabled"):
        return []

    max_hours = float(settings.get("max_open_hours") or 10)
    from src.postgres_db import get_connection

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT e.id,
                   e.user_email,
                   u.name AS user_name,
                   e.clock_in,
                   EXTRACT(EPOCH FROM (now() - e.clock_in)) / 3600.0 AS open_hours
            FROM time_entries e
            JOIN users u ON u.email = e.user_email
            WHERE e.clock_out IS NULL
              AND e.clock_in <= now() - (%s * interval '1 hour')
            ORDER BY e.clock_in ASC
            """,
            (max_hours,),
        ).fetchall()
    return [dict(row) for row in rows]


def _user_has_time_off_today(conn, user_email: str, local_date: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM time_off_entries
        WHERE user_email = %s
          AND entry_date = %s::date
          AND status = 'approved'
        LIMIT 1
        """,
        (user_email, local_date),
    ).fetchone()
    return bool(row)


def _user_has_punch_today(conn, user_email: str, tz_name: str, local_date: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM time_entries
        WHERE user_email = %s
          AND clock_in >= (%s::date AT TIME ZONE %s)
          AND clock_in < ((%s::date + interval '1 day') AT TIME ZONE %s)
        LIMIT 1
        """,
        (user_email, local_date, tz_name, local_date, tz_name),
    ).fetchone()
    return bool(row)


def _user_has_open_entry(conn, user_email: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM time_entries
        WHERE user_email = %s AND clock_out IS NULL
        LIMIT 1
        """,
        (user_email,),
    ).fetchone()
    return bool(row)


def _timesheet_needs_submission(
    conn, user_email: str, week_start: date, has_week_activity: bool
) -> bool:
    if not has_week_activity:
        return False
    row = conn.execute(
        """
        SELECT status
        FROM time_timesheets
        WHERE user_email = %s AND week_start = %s::date
        """,
        (user_email, week_start.isoformat()),
    ).fetchone()
    if not row:
        return True
    return str(row.get("status") or "open") in {"open", "rejected"}


def _week_has_activity(conn, user_email: str, tz_name: str, week_start: date) -> bool:
    week_end = week_start + timedelta(days=6)
    punch = conn.execute(
        """
        SELECT 1
        FROM time_entries
        WHERE user_email = %s
          AND clock_in >= (%s::date AT TIME ZONE %s)
          AND clock_in < ((%s::date + interval '1 day') AT TIME ZONE %s)
        LIMIT 1
        """,
        (
            user_email,
            week_start.isoformat(),
            tz_name,
            week_end.isoformat(),
            tz_name,
        ),
    ).fetchone()
    if punch:
        return True
    time_off = conn.execute(
        """
        SELECT 1
        FROM time_off_entries
        WHERE user_email = %s
          AND status = 'approved'
          AND entry_date >= %s::date
          AND entry_date <= %s::date
        LIMIT 1
        """,
        (user_email, week_start.isoformat(), week_end.isoformat()),
    ).fetchone()
    return bool(time_off)


def collect_time_clock_reminder_candidates() -> list[dict[str, Any]]:
    settings = get_time_clock_settings()
    if not settings or not settings.get("reminder_enabled"):
        return []

    practice_tz = str(settings.get("timezone") or "America/Chicago")
    clock_in_enabled = bool(settings.get("remind_clock_in_enabled", True))
    clock_in_after = _time_value(settings.get("remind_clock_in_after"))
    clock_out_enabled = bool(settings.get("remind_clock_out_enabled", True))
    clock_out_after = _time_value(settings.get("remind_clock_out_after"))
    timesheet_enabled = bool(settings.get("remind_timesheet_enabled", True))
    timesheet_weekday = int(settings.get("remind_timesheet_weekday") or 5)
    timesheet_after = _time_value(settings.get("remind_timesheet_after"))

    candidates: list[dict[str, Any]] = []
    from src.postgres_db import get_connection

    with get_connection() as conn:
        for user in list_time_clock_users():
            user_email = str(user.get("email") or "")
            user_name = str(user.get("name") or user_email)
            if not user_email:
                continue
            tz_name = _effective_timezone(user.get("timezone"), practice_tz)
            now_local = _local_now(tz_name)
            local_date = _local_date_iso(now_local)
            minutes_now = _minutes_since_midnight(now_local)
            weekday = _weekday_index(now_local)
            on_time_off = _user_has_time_off_today(conn, user_email, local_date)

            if (
                clock_in_enabled
                and not on_time_off
                and 1 <= weekday <= 5
                and minutes_now >= _time_to_minutes(clock_in_after)
                and not _user_has_punch_today(conn, user_email, tz_name, local_date)
            ):
                candidates.append(
                    {
                        "kind": "clock_in",
                        "user_email": user_email,
                        "user_name": user_name,
                        "local_date": local_date,
                        "timezone": tz_name,
                    }
                )

            if (
                clock_out_enabled
                and not on_time_off
                and minutes_now >= _time_to_minutes(clock_out_after)
                and _user_has_open_entry(conn, user_email)
            ):
                candidates.append(
                    {
                        "kind": "clock_out",
                        "user_email": user_email,
                        "user_name": user_name,
                        "local_date": local_date,
                        "timezone": tz_name,
                    }
                )

            week_start = _week_start_monday(now_local)
            has_activity = _week_has_activity(conn, user_email, tz_name, week_start)
            if (
                timesheet_enabled
                and weekday == timesheet_weekday
                and minutes_now >= _time_to_minutes(timesheet_after)
                and _timesheet_needs_submission(conn, user_email, week_start, has_activity)
            ):
                candidates.append(
                    {
                        "kind": "timesheet",
                        "user_email": user_email,
                        "user_name": user_name,
                        "local_date": local_date,
                        "week_start": week_start.isoformat(),
                        "timezone": tz_name,
                    }
                )

    return candidates


def _html_email(*, heading: str, body: str, cta_label: str, cta_url: str) -> str:
    safe_heading = html.escape(heading)
    safe_body = html.escape(body)
    safe_label = html.escape(cta_label)
    safe_url = html.escape(cta_url, quote=True)
    return (
        "<!DOCTYPE html><html><body style=\"font-family:system-ui,sans-serif;"
        "line-height:1.5;color:#1a1a1a\">"
        f"<p><strong>{safe_heading}</strong></p>"
        f"<p>{safe_body}</p>"
        f"<p><a href=\"{safe_url}\">{safe_label}</a></p>"
        "<p style=\"color:#666;font-size:12px\">"
        "This is an automated reminder from Relevium Time Clock."
        "</p></body></html>"
    )


def compose_open_punch_reminder(entry: dict[str, Any], *, app_url: str) -> dict[str, Any] | None:
    entry_id = str(entry.get("id") or "")
    user_email = str(entry.get("user_email") or "")
    if not entry_id or not user_email:
        return None
    today = datetime.now(timezone.utc).date().isoformat()
    user_name = (entry.get("user_name") or user_email).strip()
    open_hours = float(entry.get("open_hours") or 0)
    clock_in = entry.get("clock_in")
    clock_in_text = "unknown"
    if isinstance(clock_in, datetime):
        clock_in_text = clock_in.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    url = f"{app_url}/time-clock"
    heading = "Still clocked in"
    body = (
        f"Hi {user_name}, you have been clocked in for about {open_hours:.1f} hours "
        f"(since {clock_in_text}). Clock out if you have finished your shift."
    )
    return {
        "key": f"time_clock_open:{entry_id}:{today}",
        "to": user_email,
        "subject": "Time clock reminder: still clocked in",
        "text": f"{heading}\n\n{body}\n\nClock out: {url}",
        "html": _html_email(
            heading=heading,
            body=body,
            cta_label="Open time clock",
            cta_url=url,
        ),
        "cooldown_minutes": _OPEN_PUNCH_COOLDOWN_MINUTES,
    }


def compose_candidate_reminder(
    candidate: dict[str, Any], *, app_url: str
) -> dict[str, Any] | None:
    kind = str(candidate.get("kind") or "")
    user_email = str(candidate.get("user_email") or "")
    user_name = str(candidate.get("user_name") or user_email)
    local_date = str(candidate.get("local_date") or "")
    if not kind or not user_email or not local_date:
        return None

    if kind == "clock_in":
        url = f"{app_url}/time-clock"
        heading = "Forgot to clock in?"
        body = (
            f"Hi {user_name}, there is no punch for today ({local_date}). "
            "Open the time clock if you are working."
        )
        return {
            "key": f"time_clock_clock_in:{user_email}:{local_date}",
            "to": user_email,
            "subject": "Time clock reminder: clock in",
            "text": f"{heading}\n\n{body}\n\nClock in: {url}",
            "html": _html_email(
                heading=heading,
                body=body,
                cta_label="Clock in",
                cta_url=url,
            ),
            "cooldown_minutes": _DAILY_COOLDOWN_MINUTES,
        }

    if kind == "clock_out":
        url = f"{app_url}/time-clock"
        heading = "Forgot to clock out?"
        body = (
            f"Hi {user_name}, you are still clocked in at the end of the day "
            f"({local_date}). Clock out if you have finished your shift."
        )
        return {
            "key": f"time_clock_clock_out:{user_email}:{local_date}",
            "to": user_email,
            "subject": "Time clock reminder: clock out",
            "text": f"{heading}\n\n{body}\n\nClock out: {url}",
            "html": _html_email(
                heading=heading,
                body=body,
                cta_label="Clock out",
                cta_url=url,
            ),
            "cooldown_minutes": _DAILY_COOLDOWN_MINUTES,
        }

    if kind == "timesheet":
        week_start = str(candidate.get("week_start") or "")
        if not week_start:
            return None
        url = f"{app_url}/time-clock/history"
        heading = "Timesheet not submitted"
        body = (
            f"Hi {user_name}, your timesheet for the week of {week_start} is still open. "
            "Open My hours to review and submit it."
        )
        return {
            "key": f"time_clock_timesheet:{user_email}:{week_start}",
            "to": user_email,
            "subject": "Time clock reminder: submit your timesheet",
            "text": f"{heading}\n\n{body}\n\nMy hours: {url}",
            "html": _html_email(
                heading=heading,
                body=body,
                cta_label="Open My hours",
                cta_url=url,
            ),
            "cooldown_minutes": _DAILY_COOLDOWN_MINUTES,
        }

    return None


def _maybe_send_reminder(message: dict[str, Any]) -> bool:
    from src import database as db

    key = str(message.get("key") or "")
    cooldown = int(message.get("cooldown_minutes") or _DAILY_COOLDOWN_MINUTES)
    if not key:
        return False
    try:
        if db.alert_recently_sent(key, cooldown_minutes=cooldown):
            return False
    except Exception:
        logger.exception("Time clock email dedup failed for %s", key)
        return False

    if not send_email(
        to=str(message["to"]),
        subject=str(message["subject"]),
        text=str(message["text"]),
        html=str(message.get("html") or "") or None,
    ):
        return False

    try:
        db.mark_alert_sent(key)
    except Exception:
        logger.exception("Failed to stamp time clock alert_state")
    return True


def check_time_clock_reminders() -> dict[str, Any]:
    """Email team members when they need a time clock nudge."""
    settings = get_settings()
    if not settings.time_clock_email_enabled:
        return {"checked": 0, "sent": 0, "skipped": "disabled"}

    app_url = _app_url()
    sent = 0
    checked = 0

    for entry in list_open_entries_over_limit():
        checked += 1
        message = compose_open_punch_reminder(entry, app_url=app_url)
        if message and _maybe_send_reminder(message):
            sent += 1

    for candidate in collect_time_clock_reminder_candidates():
        checked += 1
        message = compose_candidate_reminder(candidate, app_url=app_url)
        if message and _maybe_send_reminder(message):
            sent += 1

    return {"checked": checked, "sent": sent}
