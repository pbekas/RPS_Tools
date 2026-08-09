"""Contract term extraction via Amazon Bedrock (structured JSON)."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from src.bedrock_analyst import _extract_json, bedrock_text

BASE_SYSTEM = """You are a contracts analyst for Relevium Pain Specialists.
You extract structured commercial terms from contract document text.

Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "title": "string — short agreement name",
  "vendor_name": "string — counterparty / vendor / landlord / employer entity name",
  "parties": ["string — named parties"],
  "group_hint": "leases | employee | vendors | other",
  "effective_date": "YYYY-MM-DD or null",
  "has_defined_term": true/false,
  "term_end_date": "YYYY-MM-DD or null",
  "expiration_date": "YYYY-MM-DD or null",
  "notice_period_days": integer or null,
  "auto_renews": true/false,
  "cost_amount": number or null — estimated recurring or one-time amount due,
  "cost_currency": "USD or other ISO currency code",
  "cost_frequency": "monthly | annual | one_time | unknown",
  "next_payment_date": "YYYY-MM-DD or null",
  "cost_notes": "string — how cost was determined / schedule notes",
  "summary": "string — 3-6 sentence neutral summary of the agreement",
  "confidence": number 0-1 — overall extraction confidence
}

Rules:
- Prefer explicit dates in the document. Do not invent dates.
- If only month/year is stated, use the first day of that month.
- If term length is stated (e.g. 36 months from effective date) and effective_date is known, compute term_end_date.
- notice_period_days should be converted from weeks/months when stated (30 days, 60 days, 90 days, etc.).
- For leases, group_hint=leases. Employment/offer letters => employee. Supplier/SaaS/service => vendors. Else other.
- cost_amount should be the best estimate of amount due per cost_frequency (e.g. monthly rent, annual SaaS fee).
- If multiple fees exist, put the primary recurring obligation in cost_amount and explain others in cost_notes.
- confidence should be lower when key dates or counterparty are missing/ambiguous.
"""


def extract_contract_fields(
    document_text: str,
    *,
    original_filename: str | None = None,
) -> dict[str, Any]:
    text = (document_text or "").strip()
    if not text:
        raise ValueError("Document text is empty — cannot extract contract fields")

    # Keep prompt bounded for very large contracts.
    clipped = text if len(text) <= 120_000 else text[:120_000] + "\n\n[TRUNCATED]"

    user_prompt = (
        "Extract key commercial terms from this contract document.\n"
        f"Original filename: {original_filename or 'n/a'}\n\n"
        "DOCUMENT TEXT:\n"
        f"{clipped}\n\n"
        "Return JSON only."
    )
    raw = bedrock_text(
        system=BASE_SYSTEM,
        user=user_prompt,
        temperature=0.1,
        max_tokens=2048,
    )
    parsed = _extract_json(raw)
    return normalize_contract_extraction(parsed)


def normalize_contract_extraction(raw: dict[str, Any]) -> dict[str, Any]:
    freq = str(raw.get("cost_frequency") or "unknown").strip().lower()
    if freq not in {"monthly", "annual", "one_time", "unknown"}:
        freq = "unknown"
    hint = str(raw.get("group_hint") or "other").strip().lower()
    if hint not in {"leases", "employee", "vendors", "other"}:
        hint = "other"

    confidence = raw.get("confidence")
    try:
        confidence_f = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence_f = None
    if confidence_f is not None:
        confidence_f = max(0.0, min(1.0, confidence_f))

    amount = raw.get("cost_amount")
    try:
        amount_f = float(amount) if amount is not None and amount != "" else None
    except (TypeError, ValueError):
        amount_f = None

    notice = raw.get("notice_period_days")
    try:
        notice_i = int(notice) if notice is not None and notice != "" else None
    except (TypeError, ValueError):
        notice_i = None

    parties = raw.get("parties")
    if not isinstance(parties, list):
        parties = []

    return {
        "title": str(raw.get("title") or "").strip(),
        "vendor_name": str(raw.get("vendor_name") or "").strip(),
        "parties": [str(p).strip() for p in parties if str(p).strip()],
        "group_hint": hint,
        "effective_date": _normalize_date(raw.get("effective_date")),
        "has_defined_term": bool(raw.get("has_defined_term")),
        "term_end_date": _normalize_date(raw.get("term_end_date")),
        "expiration_date": _normalize_date(raw.get("expiration_date")),
        "notice_period_days": notice_i,
        "auto_renews": bool(raw.get("auto_renews")),
        "cost_amount": amount_f,
        "cost_currency": str(raw.get("cost_currency") or "USD").strip().upper() or "USD",
        "cost_frequency": freq,
        "next_payment_date": _normalize_date(raw.get("next_payment_date")),
        "cost_notes": str(raw.get("cost_notes") or "").strip(),
        "summary": str(raw.get("summary") or "").strip(),
        "confidence": confidence_f,
        "raw": raw,
    }


def _normalize_date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "n/a", "na", "unknown"}:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", text):
        return text[:10]
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None
