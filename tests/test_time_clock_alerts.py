"""Tests for time clock reminder alerts."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.time_clock_alerts import check_time_clock_reminders


@patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
@patch("src.time_clock_alerts.list_open_entries_over_limit")
@patch("src.time_clock_alerts.notify_gchat")
@patch("src.time_clock_alerts.get_settings")
def test_check_time_clock_reminders_disabled(mock_settings, mock_notify, mock_list, _mock_collect):
    settings = MagicMock()
    settings.time_clock_alerts_enabled = False
    settings.gchat_time_clock_webhook_url = ""
    settings.gchat_webhook_url = ""
    mock_settings.return_value = settings

    result = check_time_clock_reminders()

    assert result["skipped"] == "disabled"
    mock_list.assert_not_called()
    mock_notify.assert_not_called()


@patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
@patch("src.time_clock_alerts.list_open_entries_over_limit")
@patch("src.time_clock_alerts.notify_gchat", return_value=True)
@patch("src.time_clock_alerts.get_settings")
def test_check_time_clock_reminders_sends(mock_settings, mock_notify, mock_list, _mock_collect):
    from datetime import datetime, timezone

    settings = MagicMock()
    settings.time_clock_alerts_enabled = True
    settings.gchat_time_clock_webhook_url = "https://chat.example/hook"
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

    with patch("src.database.alert_recently_sent", return_value=False), patch(
        "src.database.mark_alert_sent"
    ):
        result = check_time_clock_reminders()

    assert result["checked"] == 1
    assert result["sent"] == 1
    mock_notify.assert_called_once()


@patch("src.time_clock_alerts.collect_time_clock_reminder_candidates", return_value=[])
@patch("src.time_clock_alerts.list_open_entries_over_limit")
@patch("src.time_clock_alerts.notify_gchat", return_value=True)
@patch("src.time_clock_alerts.get_settings")
def test_check_time_clock_reminders_falls_back_to_main_webhook(
    mock_settings, mock_notify, mock_list, _mock_collect
):
    from datetime import datetime, timezone

    settings = MagicMock()
    settings.time_clock_alerts_enabled = True
    settings.gchat_time_clock_webhook_url = ""
    settings.gchat_webhook_url = "https://chat.example/main"
    settings.app_url = "https://tool.example.com"
    mock_settings.return_value = settings
    mock_list.return_value = [
        {
            "id": "entry-2",
            "user_email": "agent@example.com",
            "user_name": "Agent One",
            "clock_in": datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
            "open_hours": 12.0,
        }
    ]

    with patch("src.database.alert_recently_sent", return_value=False), patch(
        "src.database.mark_alert_sent"
    ):
        result = check_time_clock_reminders()

    assert result["sent"] == 1
    mock_notify.assert_called_once()
    assert mock_notify.call_args.kwargs["webhook_url"] == "https://chat.example/main"
