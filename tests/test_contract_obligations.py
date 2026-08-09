from src.contract_obligations import (
    build_derived_obligations,
    normalize_document_role,
    normalize_extracted_obligations,
)


def test_normalize_document_role_aliases():
    assert normalize_document_role("sub-lease") == "sublease"
    assert normalize_document_role("extension") == "renewal"
    assert normalize_document_role("nonsense") == "standalone"


def test_normalize_extracted_skips_empty():
    assert normalize_extracted_obligations("nope") == []
    assert normalize_extracted_obligations([{"kind": "other"}]) == []


def test_build_derived_notice_and_autorenew():
    rows = build_derived_obligations(
        expiration_date="2028-01-01",
        term_end_date="2027-12-01",
        notice_period_days=90,
        auto_renews=True,
        next_payment_date="2026-09-01",
    )
    by_kind = {row["kind"]: row for row in rows}
    assert by_kind["expiration"]["due_date"] == "2027-12-01"
    assert by_kind["notice_window"]["due_date"] == "2027-09-02"
    assert by_kind["auto_renew"]["due_date"] == "2027-09-02"
    assert by_kind["payment"]["due_date"] == "2026-09-01"


def test_build_derived_without_end_keeps_payment():
    rows = build_derived_obligations(next_payment_date="2026-10-01")
    assert len(rows) == 1
    assert rows[0]["kind"] == "payment"