"""Agent identity matching. QA credit is assigned only to directory Agent users."""

from __future__ import annotations

import re
from typing import Any


def slugify_agent_name(name: str) -> str:
    """Lowercase dotted slug for emails, e.g. 'Diana Lopez' -> 'diana.lopez'."""
    slug = re.sub(r"[^a-z0-9]+", ".", name.strip().lower())
    slug = slug.strip(".")
    return slug or "unknown"


def suggested_agent_email(name: str) -> str:
    """
    Workspace-style email from display name.
    'Diana' -> diana@releviumpain.com
    'Diana Lopez' -> diana.lopez@releviumpain.com
    """
    from src.config import get_settings

    domain = (get_settings().allowed_email_domain or "releviumpain.com").lower()
    return f"{slugify_agent_name(name)}@{domain}"


# Back-compat alias
provisional_agent_email = suggested_agent_email


def names_match(a: str, b: str) -> bool:
    left = (a or "").strip().lower()
    right = (b or "").strip().lower()
    if not left or not right:
        return False
    if left == right:
        return True
    left_parts = left.split()
    right_parts = right.split()
    if len(left_parts) == 1 and left_parts[0] == right_parts[0]:
        return True
    if len(right_parts) == 1 and right_parts[0] == left_parts[0]:
        return True
    return left in right or right in left


def names_match_confident(detected: str, known: str) -> bool:
    """
    Assign QA credit only when the detected name confidently matches a known agent.
    First-name-only matches are not enough (outbound callees often share a first name).
    """
    left = (detected or "").strip().lower()
    right = (known or "").strip().lower()
    if not left or not right:
        return False
    if left == right:
        return True
    left_parts = [p for p in left.split() if p]
    right_parts = [p for p in right.split() if p]
    if len(left_parts) >= 2 and len(right_parts) >= 2:
        return left_parts[0] == right_parts[0] and left_parts[-1] == right_parts[-1]
    return False


def is_mapped_agent_user(user: dict[str, Any] | None) -> bool:
    """True for an active, non-provisional Agent user in the directory."""
    if not user:
        return False
    if user.get("active") is False:
        return False
    email = str(user.get("email") or "").strip().lower()
    if not email or email.startswith("unmapped.") or user.get("provisional"):
        return False
    return str(user.get("role") or "Agent").strip().lower() == "agent"


def match_mapped_agent(
    agent_name: str,
    users: list[dict[str, Any]] | None = None,
) -> tuple[str | None, str]:
    """
    Match an AI-detected name to a real Agent user.

    Does not create users. If the name is missing or does not confidently match
    a directory agent, returns (None, cleaned_name) so the call stays out of
    QA metrics until a manager assigns it.
    """
    cleaned = (agent_name or "").strip()
    if not cleaned or cleaned.lower() == "unknown":
        return None, "Unknown"

    for u in users or []:
        if not is_mapped_agent_user(u):
            continue
        name = (u.get("name") or "").strip()
        email = (u.get("email") or "").strip().lower()
        local = email.split("@")[0].replace(".", " ")
        if names_match_confident(cleaned, name) or names_match_confident(cleaned, local):
            return email, name or cleaned

    return None, cleaned


def resolve_or_create_agent(agent_name: str) -> tuple[str | None, str]:
    """Load directory users and match; never creates a user."""
    cleaned = (agent_name or "").strip()
    if not cleaned or cleaned.lower() == "unknown":
        return None, "Unknown"

    from src import database as db
    from src.config import get_settings

    settings = get_settings()
    if not settings.database_configured:
        return None, cleaned

    try:
        users = db.list_users()
    except Exception:
        return None, cleaned

    return match_mapped_agent(cleaned, users)


def discover_unmapped_agents(*, call_limit: int = 400) -> list[dict[str, Any]]:
    """
    Find agent names on calls that still need a mapped user/email.
    """
    from src import database as db

    calls = db.list_calls(limit=call_limit, status="complete", require_min_duration=False)
    users = { (u.get("email") or "").lower(): u for u in db.list_users() }
    by_name: dict[str, dict[str, Any]] = {}

    for call in calls:
        name = (call.get("agent_name") or "").strip()
        email = (call.get("agent_email") or "").strip().lower()
        if not name or name.lower() == "unknown":
            continue

        key = name.lower()
        row = by_name.get(key)
        if not row:
            suggested = suggested_agent_email(name)
            user = users.get(email) or users.get(suggested)
            mapped = bool(
                email
                and email in users
                and not (users[email].get("provisional") or email.startswith("unmapped."))
            )
            row = {
                "agent_name": name,
                "suggested_email": suggested,
                "current_email": email or None,
                "call_count": 0,
                "mapped": mapped,
                "provisional": bool(
                    (user or {}).get("provisional")
                    or (email or suggested).startswith("unmapped.")
                ),
                "user_exists": user is not None,
            }
            by_name[key] = row
        row["call_count"] += 1
        if email and not row.get("current_email"):
            row["current_email"] = email

    # Also include provisional users even if no recent calls
    for email, u in users.items():
        if not (u.get("provisional") or email.startswith("unmapped.")):
            continue
        name = (u.get("name") or email.split("@")[0]).strip()
        key = name.lower()
        if key in by_name:
            by_name[key]["provisional"] = True
            by_name[key]["user_exists"] = True
            by_name[key]["current_email"] = email
            continue
        by_name[key] = {
            "agent_name": name,
            "suggested_email": suggested_agent_email(name),
            "current_email": email,
            "call_count": 0,
            "mapped": False,
            "provisional": True,
            "user_exists": True,
        }

    rows = list(by_name.values())
    rows.sort(key=lambda r: (-int(r["call_count"]), str(r["agent_name"]).lower()))
    return rows


def import_and_map_agent(
    *,
    agent_name: str,
    email: str | None = None,
    role: str = "Agent",
) -> dict[str, Any]:
    """
    Create/update the user as {name}@domain (or provided email) and remap calls
    that share this agent_name (and empty/provisional emails).
    """
    cleaned = (agent_name or "").strip()
    if not cleaned or cleaned.lower() == "unknown":
        raise ValueError("Agent name is required")

    from src import database as db
    from src.config import get_settings

    domain = (get_settings().allowed_email_domain or "releviumpain.com").lower()
    target = (email or suggested_agent_email(cleaned)).strip().lower()
    if not target.endswith(f"@{domain}"):
        raise ValueError(f"Email must be @{domain}")

    user = db.upsert_user(
        email=target,
        name=cleaned,
        role=role or "Agent",
        provisional=False,
    )

    # Remap calls with this name that are unassigned / provisional / already this email
    calls = db.list_calls(limit=500, status="complete", require_min_duration=False)
    remapped = 0
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    for call in calls:
        call_id = call.get("id")
        if not call_id:
            continue
        name = (call.get("agent_name") or "").strip()
        cur_email = (call.get("agent_email") or "").strip().lower()
        if not names_match(cleaned, name):
            continue
        if cur_email and cur_email == target:
            # Still normalize name
            db.update_call(call_id, {"agent_name": cleaned, "updated_at": now})
            continue
        if cur_email and not cur_email.startswith("unmapped.") and cur_email != target:
            # Already mapped to someone else — leave alone
            continue
        db.update_call(
            call_id,
            {
                "agent_email": target,
                "agent_name": cleaned,
                "updated_at": now,
            },
        )
        remapped += 1

    return {"user": user, "remapped_calls": remapped, "email": target, "name": cleaned}
