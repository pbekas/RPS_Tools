"""Unit tests for per-missed-call Google Chat alerts (no network)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from src.notify import alert_missed_call


class MissedCallAlertTests(unittest.TestCase):
    def _settings(self, **overrides: object) -> MagicMock:
        s = MagicMock()
        s.alerts_enabled = True
        s.gchat_webhook_url = "https://example.test/critical"
        s.gchat_missed_calls_webhook_url = "https://example.test/missed"
        s.app_url = "https://tool.example.com"
        s.missed_alert_max_age_minutes = 120
        for k, v in overrides.items():
            setattr(s, k, v)
        return s

    @patch("src.notify.notify_gchat", return_value=True)
    @patch("src.notify.get_settings")
    def test_sends_for_voicemail(
        self, get_settings: MagicMock, notify_gchat: MagicMock
    ) -> None:
        get_settings.return_value = self._settings()
        start = datetime.now(timezone.utc) - timedelta(minutes=5)
        with patch("src.database.alert_recently_sent", return_value=False), patch(
            "src.database.mark_alert_sent"
        ):
            ok = alert_missed_call(
                log_id="cdr-vm",
                direction="Inbound",
                result="Voicemail",
                from_number="7025559999",
                agent_name="Check In Out Henderson",
                extension="4100",
                start=start,
                is_missed=True,
            )
        self.assertTrue(ok)
        body = notify_gchat.call_args.args[0]
        self.assertIn("Inbound voicemail", body)
        self.assertIn("Voicemail", body)

    @patch("src.notify.notify_gchat", return_value=True)
    @patch("src.notify.get_settings")
    def test_sends_for_recent_missed_inbound(
        self, get_settings: MagicMock, notify_gchat: MagicMock
    ) -> None:
        get_settings.return_value = self._settings()
        start = datetime.now(timezone.utc) - timedelta(minutes=10)
        with patch("src.database.alert_recently_sent", return_value=False), patch(
            "src.database.mark_alert_sent"
        ) as mark:
            ok = alert_missed_call(
                log_id="cdr-1",
                direction="Inbound",
                result="Missed",
                from_number="7025551212",
                to_number="2100",
                agent_name="Dayana Flores",
                extension="2100",
                start=start,
                is_missed=True,
            )
        self.assertTrue(ok)
        notify_gchat.assert_called_once()
        body = notify_gchat.call_args.args[0]
        self.assertIn("Missed inbound call", body)
        self.assertIn("Dayana Flores", body)
        self.assertEqual(
            notify_gchat.call_args.kwargs.get("webhook_url"),
            "https://example.test/missed",
        )
        mark.assert_called_once_with("missed_call_cdr-1")

    @patch("src.notify.notify_gchat")
    @patch("src.notify.get_settings")
    def test_skips_without_missed_webhook(
        self, get_settings: MagicMock, notify_gchat: MagicMock
    ) -> None:
        get_settings.return_value = self._settings(gchat_missed_calls_webhook_url="")
        ok = alert_missed_call(
            log_id="cdr-4",
            direction="Inbound",
            result="Missed",
            from_number="7025551212",
            start=datetime.now(timezone.utc),
            is_missed=True,
        )
        self.assertFalse(ok)
        notify_gchat.assert_not_called()

    @patch("src.notify.notify_gchat")
    @patch("src.notify.get_settings")
    def test_skips_answered(
        self, get_settings: MagicMock, notify_gchat: MagicMock
    ) -> None:
        get_settings.return_value = self._settings()
        ok = alert_missed_call(
            log_id="cdr-2",
            direction="Inbound",
            result="Answered",
            from_number="7025551212",
            start=datetime.now(timezone.utc),
            is_missed=False,
        )
        self.assertFalse(ok)
        notify_gchat.assert_not_called()

    @patch("src.notify.notify_gchat")
    @patch("src.notify.get_settings")
    def test_skips_old_cdr(
        self, get_settings: MagicMock, notify_gchat: MagicMock
    ) -> None:
        get_settings.return_value = self._settings(missed_alert_max_age_minutes=30)
        start = datetime.now(timezone.utc) - timedelta(hours=3)
        ok = alert_missed_call(
            log_id="cdr-3",
            direction="Inbound",
            result="Missed",
            from_number="7025551212",
            start=start,
            is_missed=True,
        )
        self.assertFalse(ok)
        notify_gchat.assert_not_called()


if __name__ == "__main__":
    unittest.main()
