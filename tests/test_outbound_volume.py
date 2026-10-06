"""Outbound volume spike detection."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from src.outbound_volume import extensions_over_baseline, spike_threshold


class SpikeThresholdTest(unittest.TestCase):
    def test_quiet_extension_uses_the_noise_floor(self) -> None:
        # A dialer on an idle extension (average ~0) alerts once it clears the floor.
        self.assertEqual(spike_threshold(0, ratio=2, min_calls=15), 15)
        self.assertEqual(spike_threshold(2, ratio=2, min_calls=15), 15)

    def test_busy_extension_uses_double_the_average(self) -> None:
        self.assertEqual(spike_threshold(9.4, ratio=2, min_calls=15), 19)
        self.assertEqual(spike_threshold(40, ratio=2, min_calls=15), 80)
        self.assertEqual(spike_threshold(100, ratio=2, min_calls=15), 200)

    def test_rows_flag_only_extensions_past_the_threshold(self) -> None:
        rows = [
            {"ext": "4912", "agent_name": "Naveed Ali", "today_count": 296, "baseline_avg": 0.2},
            {"ext": "5101", "agent_name": "Luis Hernandez", "today_count": 15, "baseline_avg": 9.4},
            {"ext": "1100", "agent_name": "Check In", "today_count": 80, "baseline_avg": 40},
        ]
        flagged = extensions_over_baseline(rows, ratio=2, min_calls=15)
        self.assertEqual([row["ext"] for row in flagged], ["4912", "1100"])
        self.assertEqual(flagged[0]["threshold"], 15)
        self.assertEqual(flagged[1]["threshold"], 80)


class OutboundAlertSendTest(unittest.TestCase):
    @patch("src.notify.notify_gchat", return_value=True)
    @patch("src.notify.get_settings")
    def test_posts_to_call_alerts_and_stamps_dedup(
        self, get_settings: MagicMock, notify: MagicMock
    ) -> None:
        from src.notify import alert_outbound_volume_spike

        settings = MagicMock()
        settings.alerts_enabled = True
        settings.gchat_webhook_url = "https://example.test/call-alerts"
        settings.app_url = "https://tool.example.com"
        get_settings.return_value = settings
        with patch("src.database.mark_alert_sent") as mark:
            ok = alert_outbound_volume_spike(
                extension="4912",
                agent_name="Naveed Ali",
                today_count=296,
                baseline_avg=0.2,
                baseline_days=14,
                ratio=2,
                dedup_key="outbound_volume:4912:2026-10-02",
            )
        self.assertTrue(ok)
        notify.assert_called_once()
        self.assertEqual(notify.call_args.kwargs["webhook_url"], "https://example.test/call-alerts")
        text = notify.call_args.args[0]
        self.assertIn("4912", text)
        self.assertIn("296", text)
        self.assertIn("200% of that average", text)
        mark.assert_called_once_with("outbound_volume:4912:2026-10-02")
