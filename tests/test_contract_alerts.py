"""Tests for contract expiry Google Chat alerting."""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.notify import alert_contract_expiry, check_contract_expiry_alerts


def test_alert_contract_expiry_respects_feature_flag():
    settings = MagicMock()
    settings.contract_alerts_enabled = False
    settings.gchat_contracts_webhook_url = "https://chat.example/contracts"
    settings.app_url = "http://localhost:3000"
    with patch("src.notify.get_settings", return_value=settings):
        assert (
            alert_contract_expiry(
                contract_id="c1",
                title="Lease",
                vendor_name="Vendor",
                relevant_end_date="2026-12-01",
            )
            is False
        )


def test_alert_contract_expiry_skips_call_qa_webhook():
    settings = MagicMock()
    settings.contract_alerts_enabled = True
    settings.gchat_webhook_url = "https://chat.example/calls"
    settings.gchat_contracts_webhook_url = ""
    settings.app_url = "http://localhost:3000"
    with (
        patch("src.notify.get_settings", return_value=settings),
        patch("src.notify.notify_gchat") as post,
    ):
        assert (
            alert_contract_expiry(
                contract_id="c1",
                title="Lease",
                vendor_name="Vendor",
                relevant_end_date="2026-12-01",
            )
            is False
        )
        post.assert_not_called()


def test_check_contract_expiry_alerts_sends_notice_preferred():
    settings = MagicMock()
    settings.database_backend = "postgres"
    settings.contract_alerts_enabled = True
    settings.gchat_contracts_webhook_url = "https://chat.example/contracts"
    settings.contract_alert_days = 90
    settings.app_url = "http://localhost:3000"

    end = date.today() + timedelta(days=60)
    notice = date.today() + timedelta(days=30)
    rows = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "title": "Vendor MSA",
            "vendor_name": "Acme",
            "relevant_end_date": end.isoformat(),
            "notice_deadline": notice.isoformat(),
            "expiration_date": end.isoformat(),
            "term_end_date": None,
        }
    ]

    fake_db = SimpleNamespace(
        list_contracts_for_expiry_alerts=MagicMock(return_value=rows)
    )

    with (
        patch("src.notify.get_settings", return_value=settings),
        patch("src.notify.alert_contract_expiry", return_value=True) as alert,
        patch.dict("sys.modules", {"src.database": fake_db}),
    ):
        result = check_contract_expiry_alerts(within_days=90)

    assert result["sent"] == 1
    assert alert.call_count == 1
    assert alert.call_args.kwargs["alert_kind"] == "notice"
