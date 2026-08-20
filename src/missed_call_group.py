"""Suppress false missed CDRs from Vonage Call Group blast / simultaneous ring.

When a call rings multiple extensions and one answers, VBC still writes Missed
rows for the other legs. Those are not patient misses.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

# Same caller + overlapping ring window ≈ sibling group-ring legs.
DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS = 90

_ANSWERED_RESULTS = frozenset({"answered", "connected"})


def phone_key(value: Any) -> str:
    """Normalize to comparable digits (last 10 for NANP when long enough)."""
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) >= 10:
        return digits[-10:]
    return digits


def is_inbound(direction: Any) -> bool:
    return (str(direction or "")).strip().lower() == "inbound"


def is_answered_result(result: Any) -> bool:
    return (str(result or "")).strip().lower() in _ANSWERED_RESULTS


def is_missed_like_result(result: Any) -> bool:
    text = (str(result or "")).strip().lower()
    if not text:
        return False
    return text not in _ANSWERED_RESULTS


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _cdr_fields(row: Any) -> dict[str, Any]:
    """Accept VBCCallLog, Mapping, or object with attributes."""
    if isinstance(row, Mapping):
        return {
            "log_id": str(row.get("id") or row.get("log_id") or "").strip(),
            "direction": row.get("direction"),
            "from_number": row.get("from_number") or row.get("from"),
            "to_number": row.get("to_number") or row.get("to"),
            "result": row.get("result"),
            "start": row.get("start"),
            "is_missed": row.get("is_missed"),
        }
    return {
        "log_id": str(getattr(row, "log_id", None) or getattr(row, "id", "") or "").strip(),
        "direction": getattr(row, "direction", None),
        "from_number": getattr(row, "from_number", None),
        "to_number": getattr(row, "to_number", None),
        "result": getattr(row, "result", None),
        "start": getattr(row, "start", None),
        "is_missed": getattr(row, "is_missed", None),
    }


def find_answered_elsewhere_sibling(
    candidate: Any,
    peers: Sequence[Any],
    *,
    window_seconds: int = DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS,
) -> str | None:
    """
    If candidate looks like a missed inbound and a peer inbound from the same
    caller was answered within ``window_seconds``, return that peer's log id.
    """
    c = _cdr_fields(candidate)
    if not is_inbound(c["direction"]):
        return None
    if not is_missed_like_result(c["result"]) and c.get("is_missed") is not True:
        return None
    if is_answered_result(c["result"]):
        return None

    from_key = phone_key(c["from_number"])
    if not from_key or len(from_key) < 10:
        # Internal / extension-only callers — don't correlate.
        return None

    start = _as_dt(c["start"])
    if start is None:
        return None

    window = max(1, int(window_seconds))
    best_id: str | None = None
    best_delta = window + 1

    for peer in peers:
        p = _cdr_fields(peer)
        if not p["log_id"] or p["log_id"] == c["log_id"]:
            continue
        if not is_inbound(p["direction"]):
            continue
        if not is_answered_result(p["result"]):
            continue
        if phone_key(p["from_number"]) != from_key:
            continue
        peer_start = _as_dt(p["start"])
        if peer_start is None:
            continue
        delta = abs((peer_start - start).total_seconds())
        if delta <= window and delta < best_delta:
            best_delta = delta
            best_id = p["log_id"]

    return best_id


def build_answered_elsewhere_index(
    rows: Iterable[Any],
    *,
    window_seconds: int = DEFAULT_ANSWERED_ELSEWHERE_WINDOW_SECONDS,
) -> dict[str, str]:
    """
    Map missed-like log_id → answering sibling log_id for a batch of CDRs.

    Builds answered peers once, then resolves each missed candidate against them.
    """
    materialized = list(rows)
    answered = [
        r
        for r in materialized
        if is_inbound(_cdr_fields(r)["direction"])
        and is_answered_result(_cdr_fields(r)["result"])
    ]
    out: dict[str, str] = {}
    for row in materialized:
        fields = _cdr_fields(row)
        if not fields["log_id"]:
            continue
        if is_answered_result(fields["result"]):
            continue
        sibling = find_answered_elsewhere_sibling(
            row, answered, window_seconds=window_seconds
        )
        if sibling:
            out[fields["log_id"]] = sibling
    return out


def effective_is_missed(
    *,
    result: Any,
    is_missed: bool | None = None,
    answered_elsewhere: bool = False,
    answered_elsewhere_log_id: str | None = None,
) -> bool:
    """Authoritative miss flag after group-ring suppression."""
    if answered_elsewhere or answered_elsewhere_log_id:
        return False
    if is_missed is False:
        return False
    if is_missed is True:
        return True
    return is_missed_like_result(result)
