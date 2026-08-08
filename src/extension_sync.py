"""Sync Vonage extensions into Postgres and map them onto app users.

Primary sources:
  1. VBC Provisioning users API (when the API app is subscribed)
  2. Distinct extensions harvested from CDR call_logs (always available)

Auto-map rules (only when users.extension is empty):
  - Exact email match: VBC user email → users.email
  - Existing users.extension already set wins
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from src import database as db
from src.config import get_settings
from src.vonage_vbc import VonageVBCClient, VonageVBCError

logger = logging.getLogger(__name__)


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
        "users_with_extension": 0,
        "unmapped_extensions": 0,
    }

    catalog: dict[str, dict[str, Any]] = {}

    # 1) Provisioning (best effort)
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

    # 2) Harvest from CDRs
    try:
        from src import postgres_db as pg

        cdr_exts = pg.list_distinct_cdr_extensions(limit=2000)
        summary["cdr_extensions"] = len(cdr_exts)
        for row in cdr_exts:
            ext = str(row.get("extension") or "").strip()
            if not ext or ext in catalog:
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

    # 4) Auto-map by email → users.extension
    if auto_map:
        users = {str(u.get("email") or "").lower(): u for u in db.list_users()}
        for ext, payload in catalog.items():
            vbc_email = (payload.get("vbc_email") or "").strip().lower()
            if not vbc_email or vbc_email not in users:
                continue
            user = users[vbc_email]
            existing_ext = str(user.get("extension") or "").strip()
            if existing_ext and existing_ext != ext:
                continue
            if existing_ext == ext:
                pg.set_vonage_extension_mapping(ext, vbc_email)
                continue
            # Avoid stealing an extension already owned by another user
            owner = pg.get_user_by_extension(ext)
            if owner and str(owner.get("email") or "").lower() != vbc_email:
                continue
            pg.set_user_extension(vbc_email, ext)
            pg.set_vonage_extension_mapping(ext, vbc_email)
            summary["auto_mapped"] += 1

    # Refresh counts
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
