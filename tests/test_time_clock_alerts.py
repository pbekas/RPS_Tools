"""Tests for time clock reminder emails."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


def _fake_db(*, recently_sent: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        alert_recently_sent=MagicMock(return_value=recently_sent),
        mark_alert_sent=MagicMock(),
    )

from src.time_clock_alerts import (
    check_time_clock_reminders,
    compose_candidate_reminder,
    compose_open_punch_reminder,
)


class CheckTimeClockRemindersTest(unittest.TestCase):
    @patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
    @patch("src.time_clock_alerts.list_open_entries_over_limit")
    @patch("src.time_clock_alerts.send_email")
    @patch("src.time_clock_alerts.get_settings")
    def test_disabled(self, mock_settings, mock_send, mock_list, _mock_collect):
        settings = MagicMock()
        settings.time_clock_email_enabled = False
        mock_settings.return_value = settings

        result = check_time_clock_reminders()

        self.assertEqual(result["skipped"], "disabled")
        mock_list.assert_not_called()
        mock_send.assert_not_called()

    @patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
    @patch("src.time_clock_alerts.list_open_entries_over_limit")
    @patch("src.time_clock_alerts.send_email", return_value=True)
    @patch("src.time_clock_alerts.get_settings")
    def test_emails_employee(self, mock_settings, mock_send, mock_list, _mock_collect):
        settings = MagicMock()
        settings.time_clock_email_enabled = True
        settings.app_url = "https://tool.example.com"
        mock_settings.return_value = settings
        mock_list.return_value = [
            {
                "id": "entry-1",
                "user_email": "agent@example.com",
                "user_name": "Agent One",
                "clock_in": datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
                "open_hours": 11.5,
            }
        ]

        fake_db = _fake_db(recently_sent=False)
        with patch.dict("sys.modules", {"src.database": fake_db}):
            result = check_time_clock_reminders()

        self.assertEqual(result["checked"], 1)
        self.assertEqual(result["sent"], 1)
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.kwargs["to"], "agent@example.com")
        self.assertIn("clocked in", mock_send.call_args.kwargs["subject"].lower())
        fake_db.mark_alert_sent.assert_called_once()

    @patch("src.time_clock_alerts.collect_time_clock_reminder_candidates")
    @patch("src.time_clock_alerts.list_open_entries_over_limit", return_value=[])
    @patch("src.time_clock_alerts.send_email", return_value=True)
    @patch("src.time_clock_alerts.get_settings")
    def test_sends_clock_in(self, mock_settings, mock_send, _mock_list, mock_collect):
        settings = MagicMock()
        settings.time_clock_email_enabled = True
        settings.app_url = "https://tool.example.com"
        mock_settings.return_value = settings
        mock_collect.return_value = [
            {
                "kind": "clock_in",
                "user_email": "agent@example.com",
                "user_name": "Agent One",
                "local_date": "2026-01-05",
                "timezone": "America/Chicago",
            }
        ]

        with patch.dict("sys.modules", {"src.database": _fake_db(recently_sent=False)}):
            result = check_time_clock_reminders()

        self.assertEqual(result["sent"], 1)
        self.assertEqual(mock_send.call_args.kwargs["to"], "agent@example.com")
        self.assertIn("clock in", mock_send.call_args.kwargs["subject"].lower())

    @patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
    @patch("src.time_clock_alerts.list_open_entries_over_limit")
    @patch("src.time_clock_alerts.send_email")
    @patch("src.time_clock_alerts.get_settings")
    def test_skips_recent(self, mock_settings, mock_send, mock_list, _mock_collect):
        settings = MagicMock()
        settings.time_clock_email_enabled = True
        settings.app_url = "https://tool.example.com"
        mock_settings.return_value = settings
        mock_list.return_value = [
            {
                "id": "entry-1",
                "user_email": "agent@example.com",
                "user_name": "Agent One",
                "clock_in": datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
                "open_hours": 11.5,
            }
        ]

        fake_db = _fake_db(recently_sent=True)
        with patch.dict("sys.modules", {"src.database": fake_db}):
            result = check_time_clock_reminders()

        self.assertEqual(result["sent"], 0)
        mock_send.assert_not_called()
        fake_db.mark_alert_sent.assert_not_called()


class ComposeReminderTest(unittest.TestCase):
    def test_open_punch_includes_hours(self) -> None:
        message = compose_open_punch_reminder(
            {
                "id": "entry-1",
                "user_email": "agent@example.com",
                "user_name": "Agent One",
                "clock_in": datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
                "open_hours": 11.5,
            },
            app_url="https://tool.example.com",
        )
        self.assertIsNotNone(message)
        assert message is not None
        self.assertEqual(message["to"], "agent@example.com")
        self.assertIn("11.5", message["text"])
        self.assertIn("https://tool.example.com/time-clock", message["text"])

    def test_timesheet_link(self) -> None:
        message = compose_candidate_reminder(
            {
                "kind": "timesheet",
                "user_email": "agent@example.com",
                "user_name": "Agent One",
                "local_date": "2026-01-09",
                "week_start": "2026-01-05",
            },
            app_url="https://tool.example.com",
        )
        self.assertIsNotNone(message)
        assert message is not None
        self.assertEqual(
            message["key"], "time_clock_timesheet:agent@example.com:2026-01-05"
        )
        self.assertIn("/time-clock/history", message["text"])
