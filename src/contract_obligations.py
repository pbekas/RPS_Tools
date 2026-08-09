"""Normalize and derive contract calendar obligations."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

OBLIGATION_KINDS = frozenset(
    {
        "notice_window",
        "auto_renew",
        "expiration",
        "rent_escalation",
        "insurance_coi",
        "personal_guarantee",
        "payment",
        "other",
    }
)

FAMILY_ROLES = frozenset(
    {
        "standalone",
        "original",
        "amendment",
        "assignment",
        "sublease",
        "addendum",
        "renewal",
        "other",
    }
)

_KIND_TITLES = {
    "notice_window": "Notice deadline",
    "auto_renew": "Auto-renewal decision",
    "expiration": "Expiration / term end",
    "rent_escalation": "Rent escalation",
    "insurance_coi": "Insurance / COI",
    "personal_guarantee": "Personal guarantee",
    "payment": "Payment",
    "other": "Obligation",
}


def normalize_document_role(value: Any) -> str:
    role = str(value or "standalone").strip().lower().replace(" ", "_")
    aliases = {
        "master": "original",
        "primary": "original",
        "base": "original",
        "amend": "amendment",
        "amended": "amendment",
        "restatement": "amendment",
        "assign": "assignment",
        "sub-lease": "sublease",
        "sub_lease": "sublease",
        "add-on": "addendum",
        "rider": "addendum",
        "renew": "renewal",
        "extension": "renewal",
    }
    role = aliases.get(role, role)
    return role if role in FAMILY_ROLES else "standalone"


def normalize_extracted_obligations(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "other").strip().lower().replace(" ", "_")
        aliases = {
            "notice": "notice_window",
            "notice_deadline": "notice_window",
            "renewal": "auto_renew",
            "auto_renewal": "auto_renew",
            "expiry": "expiration",
            "expire": "expiration",
            "term_end": "expiration",
            "escalation": "rent_escalation",
            "rent_increase": "rent_escalation",
            "coi": "insurance_coi",
            "insurance": "insurance_coi",
            "certificate_of_insurance": "insurance_coi",
            "guarantee": "personal_guarantee",
            "guaranty": "personal_guarantee",
            "personal_guaranty": "personal_guarantee",
            "rent": "payment",
        }
        kind = aliases.get(kind, kind)
        if kind not in OBLIGATION_KINDS:
            kind = "other"
        if kind == "payment":
            continue
        title = str(item.get("title") or "").strip() or _KIND_TITLES[kind]
        notes = str(item.get("notes") or item.get("detail") or "").strip()
        due = _parse_date(item.get("due_date") or item.get("date"))
        if not due and not notes and title == _KIND_TITLES[kind]:
            continue
        out.append(
            {
                "kind": kind,
                "title": title[:240],
                "due_date": due,
                "notes": notes[:2000],
                "source": "extracted",
            }
        )
    return out[:40]


def build_derived_obligations(
    *,
    expiration_date: str | None = None,
    term_end_date: str | None = None,
    notice_period_days: int | None = None,
    auto_renews: bool = False,
    next_payment_date: str | None = None,  # cost field only; not a calendar item
) -> list[dict[str, Any]]:
    _ = next_payment_date
    end = _earliest_date(expiration_date, term_end_date)
    derived: list[dict[str, Any]] = []
    if end:
        derived.append(
            {
                "kind": "expiration",
                "title": "Expiration / term end",
                "due_date": end,
                "notes": "",
                "source": "derived",
            }
        )
        if notice_period_days is not None and notice_period_days >= 0:
            notice_due = _add_days(end, -int(notice_period_days))
            derived.append(
                {
                    "kind": "notice_window",
                    "title": f"{int(notice_period_days)}-day notice deadline",
                    "due_date": notice_due,
                    "notes": "",
                    "source": "derived",
                }
            )
            if auto_renews:
                derived.append(
                    {
                        "kind": "auto_renew",
                        "title": "Auto-renewal decision",
                        "due_date": notice_due,
                        "notes": "Give notice before this date to avoid auto-renewal.",
                        "source": "derived",
                    }
                )
        elif auto_renews:
            derived.append(
                {
                    "kind": "auto_renew",
                    "title": "Auto-renewal decision",
                    "due_date": end,
                    "notes": "",
                    "source": "derived",
                }
            )
    return derived


def _parse_date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "n/a", "na", "unknown"}:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _earliest_date(*values: Any) -> str | None:
    parsed = [d for d in (_parse_date(v) for v in values) if d]
    return min(parsed) if parsed else None


def _add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()
