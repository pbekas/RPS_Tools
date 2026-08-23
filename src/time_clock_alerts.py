"""Time clock reminder alerts for open punch entries."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from src.config import get_settings
from src.notify import notify_gchat

logger = logging.getLogger(__name__)


def list_open_entries_over_limit() -> list[dict[str, Any]]:
    """Return open time entries that exceed configured max open hours."""
    from src.postgres_db import get_connection

    with get_connection() as conn:
        settings_row = conn.execute(
            """
            SELECT max_open_hours::float8 AS max_open_hours,
                   reminder_enabled,
                   timezone
            FROM time_clock_settings
            WHERE id = 'default'
            """
        ).fetchone()
        if not settings_row or not settings_row.get("reminder_enabled"):
            return []

        max_hours = float(settings_row.get("max_open_hours") or 10)
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


def check_time_clock_reminders() -> dict[str, Any]:
    """Alert managers when team members stay clocked in past the configured limit."""
    settings = get_settings()
    webhook = (settings.gchat_time_clock_webhook_url or "").strip()
    if not settings.time_clock_alerts_enabled or not webhook:
        return {"checked": 0, "sent": 0, "skipped": "disabled"}

    from src import database as db

    entries = list_open_entries_over_limit()
    sent = 0
    app_url = settings.app_url.rstrip("/")
    if "8501" in app_url:
        app_url = app_url.replace("8501", "3000")

    for entry in entries:
        entry_id = str(entry.get("id") or "")
        user_email = str(entry.get("user_email") or "")
        if not entry_id or not user_email:
            continue
        today = datetime.now(timezone.utc).date().isoformat()
        key = f"time_clock_open:{entry_id}:{today}"
        try:
            if db.alert_recently_sent(key, cooldown_minutes=6 * 60):
                continue
        except Exception:
            logger.exception("Time clock alert dedup failed for %s", key)

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
        if notify_gchat(text, webhook_url=webhook):
            try:
                db.mark_alert_sent(key)
            except Exception:
                logger.exception("Failed to stamp time clock alert_state")
            sent += 1

    return {"checked": len(entries), "sent": sent}
