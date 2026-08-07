"""Shared call eligibility rules for QA."""

# Recordings at or under this length are not real caller conversations.
MIN_CALL_DURATION_SECONDS = 10


def is_qa_eligible_duration(duration_seconds: int | float | None) -> bool:
    """True when the call is long enough to treat as a real caller."""
    try:
        seconds = float(duration_seconds or 0)
    except (TypeError, ValueError):
        seconds = 0.0
    return seconds > MIN_CALL_DURATION_SECONDS
