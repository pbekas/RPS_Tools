"""Shared call eligibility rules for QA."""

from __future__ import annotations

import os
from typing import Any

# Recordings at or under this length are usually IVR-only / no live interaction.
MIN_CALL_DURATION_SECONDS = 30

# Spam / non-agent extensions that must never be transcribed or scored.
# Override with QA_EXCLUDED_EXTENSIONS="4912,1234" (empty string excludes none).
_DEFAULT_EXCLUDED_EXTENSIONS = ("4912",)


def is_qa_eligible_duration(duration_seconds: int | float | None) -> bool:
    """True when the call is long enough to treat as a real caller."""
    try:
        seconds = float(duration_seconds or 0)
    except (TypeError, ValueError):
        seconds = 0.0
    return seconds > MIN_CALL_DURATION_SECONDS


def extension_digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def excluded_qa_extensions() -> frozenset[str]:
    """Extensions that are ingested as CDRs but never sent through QA scoring."""
    raw = os.getenv("QA_EXCLUDED_EXTENSIONS")
    parts = _DEFAULT_EXCLUDED_EXTENSIONS if raw is None else tuple(raw.split(","))
    return frozenset(digits for part in parts if (digits := extension_digits(part)))


def is_excluded_qa_extension(*values: Any) -> bool:
    """True when any extension value is on the QA exclusion list."""
    blocked = excluded_qa_extensions()
    if not blocked:
        return False
    for value in values:
        if isinstance(value, (list, tuple, set, frozenset)):
            if is_excluded_qa_extension(*tuple(value)):
                return True
            continue
        if extension_digits(value) in blocked:
            return True
    return False
