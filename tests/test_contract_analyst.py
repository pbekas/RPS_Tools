"""Unit tests for contract extraction normalization and expiry alert helpers."""

from __future__ import annotations

from src.contract_analyst import normalize_contract_extraction


def test_normalize_contract_extraction_dates_and_cost():
    raw = {
        "title": "Office Lease",
        "vendor_name": "Main Street Holdings",
        "parties": ["Relevium Pain Specialists", "Main Street Holdings"],
        "group_hint": "leases",
        "effective_date": "2025-01-01",
        "has_defined_term": True,
        "term_end_date": "01/01/2028",
        "expiration_date": None,
        "notice_period_days": "90",
        "auto_renews": False,
        "cost_amount": "4500.50",
        "cost_currency": "usd",
        "cost_frequency": "Monthly",
        "next_payment_date": "2026-09-01",
        "cost_notes": "Base rent",
        "summary": "Three year office lease.",
        "confidence": 0.91,
    }
    out = normalize_contract_extraction(raw)
    assert out["title"] == "Office Lease"
    assert out["vendor_name"] == "Main Street Holdings"
    assert out["group_hint"] == "leases"
    assert out["effective_date"] == "2025-01-01"
    assert out["term_end_date"] == "2028-01-01"
    assert out["notice_period_days"] == 90
    assert out["cost_amount"] == 4500.5
    assert out["cost_currency"] == "USD"
    assert out["cost_frequency"] == "monthly"
    assert out["confidence"] == 0.91


def test_normalize_contract_extraction_unknowns():
    out = normalize_contract_extraction(
        {
            "title": "",
            "vendor_name": "",
            "group_hint": "something-else",
            "cost_frequency": "quarterly",
            "confidence": 2,
            "effective_date": "n/a",
        }
    )
    assert out["group_hint"] == "other"
    assert out["cost_frequency"] == "unknown"
    assert out["confidence"] == 1.0
    assert out["effective_date"] is None
