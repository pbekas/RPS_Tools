"""Time clock reminder alerts for open punches and missed punches."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.config import get_settings
from src.notify import notify_gchat

logger = logging.getLogger(__name__)


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
        WHERE user_email = %s AND entry_date = %s::date
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


def _app_url() -> str:
    settings = get_settings()
    app_url = settings.app_url.rstrip("/")
    if "8501" in app_url:
        app_url = app_url.replace("8501", "3000")
    return app_url


def _maybe_send_alert(key: str, text: str, webhook: str) -> bool:
    from src import database as db

    try:
        if db.alert_recently_sent(key, cooldown_minutes=6 * 60):
            return False
    except Exception:
        logger.exception("Time clock alert dedup failed for %s", key)
        return False

    if not notify_gchat(text, webhook_url=webhook):
        return False

    try:
        db.mark_alert_sent(key)
    except Exception:
        logger.exception("Failed to stamp time clock alert_state")
    return True


def check_time_clock_reminders() -> dict[str, Any]:
    """Alert managers when team members need a time clock nudge."""
    settings = get_settings()
    webhook = (
        (settings.gchat_time_clock_webhook_url or "").strip()
        or (settings.gchat_webhook_url or "").strip()
    )
    if not settings.time_clock_alerts_enabled or not webhook:
        return {"checked": 0, "sent": 0, "skipped": "disabled"}

    app_url = _app_url()
    sent = 0
    checked = 0

    for entry in list_open_entries_over_limit():
        checked += 1
        entry_id = str(entry.get("id") or "")
        user_email = str(entry.get("user_email") or "")
        if not entry_id or not user_email:
            continue
        today = datetime.now(timezone.utc).date().isoformat()
        key = f"time_clock_open:{entry_id}:{today}"
        user_name = (entry.get("user_name") or user_email).strip()
        open_hours = float(entry.get("open_hours") or 0)
        clock_in = entry.get("clock_in")
        clock_in_text = ""
        if isinstance(clock_in, datetime):
            clock_in_text = clock_in.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        text = (
            f"*Time clock reminder*\n"
            f"{user_name} ({user_email}) has been clocked in for ~{open_hours:.1f} hours.\n"
            f"Clock in: {clock_in_text or 'unknown'}\n"
            f"Team view: {app_url}/time-clock/team"
        )
        if _maybe_send_alert(key, text, webhook):
            sent += 1

    for candidate in collect_time_clock_reminder_candidates():
        checked += 1
        kind = str(candidate.get("kind") or "")
        user_email = str(candidate.get("user_email") or "")
        user_name = str(candidate.get("user_name") or user_email)
        local_date = str(candidate.get("local_date") or "")
        if not kind or not user_email or not local_date:
            continue

        if kind == "clock_in":
            key = f"time_clock_clock_in:{user_email}:{local_date}"
            text = (
                f"*Time clock reminder*\n"
                f"{user_name} ({user_email}) has not clocked in today.\n"
                f"Clock in: {app_url}/time-clock"
            )
        elif kind == "clock_out":
            key = f"time_clock_clock_out:{user_email}:{local_date}"
            text = (
                f"*Time clock reminder*\n"
                f"{user_name} ({user_email}) is still clocked in at end of day.\n"
                f"Clock out: {app_url}/time-clock"
            )
        elif kind == "timesheet":
            week_start = str(candidate.get("week_start") or "")
            key = f"time_clock_timesheet:{user_email}:{week_start}"
            text = (
                f"*Timesheet reminder*\n"
                f"{user_name} ({user_email}) has not submitted the week of {week_start}.\n"
                f"My hours: {app_url}/time-clock/history"
            )
        else:
            continue

        if _maybe_send_alert(key, text, webhook):
            sent += 1

    return {"checked": checked, "sent": sent}
