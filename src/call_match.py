"""Shared rules for linking a Vonage CDR to a QA recording."""

from __future__ import annotations

import re
from typing import Any, Mapping

from src.call_filters import is_qa_eligible_duration
from src.missed_call_group import is_answered_result

_RECORDING_ID_KEYS = (
    "recording_id",
    "call_recording_id",
    "company_call_recording_id",
    "recordingId",
)


def digits(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\D", "", str(value))


def phones_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 10 and len(b) >= 10:
        return a[-10:] == b[-10:]
    return a.endswith(b) or b.endswith(a)


def recording_id_from_raw(raw: Mapping[str, Any] | None) -> str | None:
    """Pull a Vonage recording id out of a CDR payload when Reports includes one."""
    if not isinstance(raw, Mapping):
        return None
    for key in _RECORDING_ID_KEYS:
        value = raw.get(key)
        if value:
            text = str(value).strip()
            if text:
                return text
    nested = raw.get("recordings") or raw.get("call_recordings")
    if isinstance(nested, list) and nested:
        first = nested[0]
        if isinstance(first, str) and first.strip():
            return first.strip()
        if isinstance(first, Mapping):
            for key in ("id", "recording_id"):
                value = first.get(key)
                if value and str(value).strip():
                    return str(value).strip()
    return None


def alignment_score(
    *,
    direction: str | None,
    log_from: str,
    log_to: str,
    caller: str,
    dnis: str,
    log_exts: set[str],
    other_exts: set[str],
) -> int:
    """Higher is a better CDR ↔ recording match. Zero means no phone/extension overlap.

    Outbound prefers the dialed number (CDR to). Inbound prefers the caller (CDR from).
    """
    score = 0
    text = (direction or "").strip().lower()
    outbound = text.startswith("out")
    inbound = text.startswith("in") and not text.startswith("intra")

    if log_exts and other_exts and (log_exts & other_exts):
        score += 50

    from_caller = bool(log_from and caller and phones_match(log_from, caller))
    to_dnis = bool(log_to and dnis and phones_match(log_to, dnis))
    from_dnis = bool(log_from and dnis and phones_match(log_from, dnis))
    to_caller = bool(log_to and caller and phones_match(log_to, caller))

    if inbound:
        if from_caller:
            score += 40
        if to_dnis:
            score += 20
    elif outbound:
        if to_dnis or to_caller:
            score += 40
        if from_caller or from_dnis:
            score += 15
    else:
        if from_caller:
            score += 20
        if to_dnis:
            score += 20

    if from_caller:
        score += 10
    if to_dnis:
        score += 10
    if from_dnis:
        score += 8
    if to_caller:
        score += 8
    return score


def is_capture_candidate(log: Mapping[str, Any]) -> bool:
    """Answered, recorded, >30s, and not yet linked to a QA call.

    Includes group-ring legs stored as Missed but answered elsewhere, matching
    the ops capture denominator.
    """
    if str(log.get("matched_call_id") or "").strip():
        return False
    if log.get("recorded") is not True:
        return False
    if log.get("is_unrecorded"):
        return False
    if not is_qa_eligible_duration(log.get("length_seconds")):
        return False
    if log.get("answered_elsewhere"):
        return True
    if is_answered_result(log.get("result")) and log.get("is_missed") is not True:
        return True
    # Sibling legs keep result=Missed after the answered-elsewhere suppress.
    if log.get("is_missed") is False and not is_answered_result(log.get("result")):
        return True
    return False
