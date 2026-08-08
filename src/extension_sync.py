"""Sync Vonage extensions into Postgres and map them onto app users.

Primary sources:
  1. VBC Provisioning users API (when the API app is subscribed) — includes email
  2. Distinct extensions harvested from CDR call_logs (extension + display name only)

Auto-map (only fills empty users.extension):
  1. Exact email match when Provisioning provided vbc_email
  2. Fuzzy name match: CDR/Provisioning display_name ↔ users.name
  3. Username / email-local match (e.g. jsmith ↔ jsmith@…)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from src import database as db
from src.config import get_settings
from src.vonage_vbc import VonageVBCClient, VonageVBCError

logger = logging.getLogger(__name__)


def _norm_name(value: str | None) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower())
    return re.sub(r"\s+", " ", text).strip()


def _names_match(a: str | None, b: str | None) -> bool:
    left = _norm_name(a)
    right = _norm_name(b)
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
    if len(left_parts) >= 2 and len(right_parts) >= 2:
        if {left_parts[0], left_parts[-1]} == {right_parts[0], right_parts[-1]}:
            return True
    return left in right or right in left


def _email_local(email: str) -> str:
    return (
        (email or "")
        .split("@", 1)[0]
        .replace(".", " ")
        .replace("_", " ")
        .strip()
        .lower()
    )


def _find_user_for_extension(
    payload: dict[str, Any],
    users: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Best-effort match from catalog row → app user."""
    vbc_email = (payload.get("vbc_email") or "").strip().lower()
    if vbc_email:
        for user in users:
            if str(user.get("email") or "").lower() == vbc_email:
                return user

    display = (payload.get("display_name") or "").strip()
    username = (payload.get("vbc_username") or "").strip()
    candidates: list[tuple[int, dict[str, Any]]] = []
    for user in users:
        if user.get("active") is False:
            continue
        if user.get("provisional"):
            continue
        email = str(user.get("email") or "").strip().lower()
        name = str(user.get("name") or "").strip()
        score = 0
        if display and _names_match(display, name):
            score = 3
        elif username and (
            _names_match(username, name)
            or _names_match(username, _email_local(email))
            or username.lower() == email.split("@", 1)[0].lower()
        ):
            score = 2
        elif display and _names_match(display, _email_local(email)):
            score = 1
        if score:
            candidates.append((score, user))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item[0], str(item[1].get("email") or "")))
    top = candidates[0][0]
    tops = [u for s, u in candidates if s == top]
    if len(tops) > 1:
        return None
    return tops[0]


def sync_extensions(*, auto_map: bool = True) -> dict[str, Any]:
    """Upsert extension catalog and optionally stamp users.extension."""
    settings = get_settings()
    if settings.database_backend != "postgres":
        raise RuntimeError("Extension sync requires DB_BACKEND=postgres")

    summary: dict[str, Any] = {
        "provisioning_users": 0,
        "provisioning_ok": False,
        "provisioning_error": None,
        "cdr_extensions": 0,
        "upserted": 0,
        "auto_mapped": 0,
        "auto_mapped_by_name": 0,
        "users_with_extension": 0,
        "unmapped_extensions": 0,
    }

    catalog: dict[str, dict[str, Any]] = {}

    # 1) Provisioning (best effort — needs Provisioning API on the VBC app)
    try:
        client = VonageVBCClient()
        for user in client.iter_provisioning_users():
            summary["provisioning_users"] += 1
            email = str(user.get("email") or "").strip().lower()
            first = str(user.get("first_name") or "").strip()
            last = str(user.get("last_name") or "").strip()
            display = f"{first} {last}".strip() or str(user.get("login_name") or "").strip()
            username = str(user.get("login_name") or "").strip()
            user_id = str(user.get("id") or "").strip()
            for ext_obj in user.get("extensions") or []:
                if not isinstance(ext_obj, dict):
                    continue
                ext = str(ext_obj.get("extension_number") or "").strip()
                if not ext:
                    continue
                catalog[ext] = {
                    "extension": ext,
                    "display_name": display,
                    "vbc_username": username,
                    "vbc_email": email,
                    "vbc_user_id": user_id,
                    "source": "provisioning",
                    "raw": {"user": user, "extension": ext_obj},
                }
        summary["provisioning_ok"] = True
    except VonageVBCError as exc:
        summary["provisioning_error"] = str(exc)[:400]
        logger.warning("Provisioning sync unavailable: %s", exc)
    except Exception as exc:  # noqa: BLE001
        summary["provisioning_error"] = str(exc)[:400]
        logger.exception("Provisioning sync failed")

    # 2) Harvest from CDRs (extension + name/username — usually no email)
    try:
        from src import postgres_db as pg

        cdr_exts = pg.list_distinct_cdr_extensions(limit=2000)
        summary["cdr_extensions"] = len(cdr_exts)
        for row in cdr_exts:
            ext = str(row.get("extension") or "").strip()
            if not ext:
                continue
            if ext in catalog:
                if not catalog[ext].get("display_name"):
                    catalog[ext]["display_name"] = str(row.get("display_name") or "").strip()
                if not catalog[ext].get("vbc_username"):
                    catalog[ext]["vbc_username"] = str(row.get("username") or "").strip()
                continue
            catalog[ext] = {
                "extension": ext,
                "display_name": str(row.get("display_name") or "").strip(),
                "vbc_username": str(row.get("username") or "").strip(),
                "vbc_email": "",
                "vbc_user_id": "",
                "source": "cdr",
                "raw": row,
            }
    except Exception:
        logger.exception("CDR extension harvest failed")

    # 3) Persist catalog
    from src import postgres_db as pg

    for payload in catalog.values():
        pg.upsert_vonage_extension(payload)
        summary["upserted"] += 1

    # 4) Auto-map catalog → users (email first, then name)
    if auto_map:
        users = [
            u
            for u in db.list_users()
            if u.get("active") is not False and not u.get("provisional")
        ]
        claimed_exts = {
            str(u.get("extension") or "").strip()
            for u in users
            if str(u.get("extension") or "").strip()
        }
        for ext, payload in catalog.items():
            if ext in claimed_exts:
                owner = pg.get_user_by_extension(ext)
                if owner:
                    pg.set_vonage_extension_mapping(
                        ext, str(owner.get("email") or "").lower()
                    )
                continue

            match = _find_user_for_extension(payload, users)
            if not match:
                continue
            email = str(match.get("email") or "").strip().lower()
            existing_ext = str(match.get("extension") or "").strip()
            if existing_ext and existing_ext != ext:
                continue
            owner = pg.get_user_by_extension(ext)
            if owner and str(owner.get("email") or "").lower() != email:
                continue

            by_email = bool((payload.get("vbc_email") or "").strip())
            pg.set_user_extension(email, ext)
            pg.set_vonage_extension_mapping(ext, email)
            claimed_exts.add(ext)
            match["extension"] = ext
            summary["auto_mapped"] += 1
            if not by_email:
                summary["auto_mapped_by_name"] += 1

    users = db.list_users()
    summary["users_with_extension"] = sum(
        1 for u in users if str(u.get("extension") or "").strip()
    )
    exts = pg.list_vonage_extensions()
    summary["unmapped_extensions"] = sum(
        1 for e in exts if not str(e.get("mapped_email") or "").strip()
    )
    summary["synced_at"] = datetime.now(timezone.utc).isoformat()
    return summary
