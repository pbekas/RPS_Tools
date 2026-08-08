"""Live call board: join Telephony active calls onto mapped extensions."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from src import database as db
from src.vonage_vbc import VonageVBCClient, VonageVBCError

logger = logging.getLogger(__name__)


def _digits(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\D", "", str(value))


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        # epoch seconds
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit():
            try:
                return datetime.fromtimestamp(float(text), tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _normalize_status(raw: Any) -> str:
    text = str(raw or "").strip().lower().replace("_", "-")
    if text in {"ringing"}:
        return "ringing"
    if text in {"on-call", "oncall", "active", "connected", "answered"}:
        return "on-call"
    if text in {"busy"}:
        return "busy"
    if text in {"held", "hold"}:
        return "held"
    if text in {"parked"}:
        return "parked"
    if text:
        return text
    return "unknown"


def _party_label(number: Any, *, ext_directory: dict[str, dict[str, Any]]) -> str:
    digits = _digits(number)
    if not digits:
        return "—"
    # Exact extension match (short codes like 1100)
    if digits in ext_directory:
        row = ext_directory[digits]
        name = (row.get("name") or "").strip()
        return f"{name} ({digits})" if name else digits
    # Last-10 for PSTN
    if len(digits) >= 10:
        pretty = digits[-10:]
        return f"({pretty[0:3]}) {pretty[3:6]}-{pretty[6:10]}"
    return digits


def build_live_call_board() -> dict[str, Any]:
    """Snapshot for Ops live board (directory + who is ringing/on a call)."""
    now = datetime.now(timezone.utc)
    users = [
        u
        for u in db.list_users()
        if u.get("active") is not False
        and not u.get("provisional")
        and str(u.get("extension") or "").strip()
    ]
    ext_directory: dict[str, dict[str, Any]] = {}
    for user in users:
        ext = str(user.get("extension") or "").strip()
        if not ext:
            continue
        ext_directory[ext] = {
            "extension": ext,
            "name": (user.get("name") or "").strip() or user.get("email"),
            "email": str(user.get("email") or "").strip().lower(),
        }

    # Enrich from vonage_extensions catalog when user map is thin.
    try:
        for row in db.list_vonage_extensions():
            ext = str(row.get("extension") or "").strip()
            if not ext or ext in ext_directory:
                continue
            ext_directory[ext] = {
                "extension": ext,
                "name": (row.get("display_name") or row.get("vbc_username") or ext).strip(),
                "email": str(row.get("vbc_email") or row.get("mapped_email") or "").strip().lower(),
            }
    except Exception:
        logger.exception("Failed loading vonage_extensions for live board")

    telephony_error: str | None = None
    raw_calls: list[dict[str, Any]] = []
    try:
        client = VonageVBCClient()
        raw_calls = client.list_active_calls(page_size=100)
    except VonageVBCError as exc:
        telephony_error = str(exc)[:400]
        logger.warning("Telephony active calls unavailable: %s", exc)
    except Exception as exc:  # noqa: BLE001
        telephony_error = str(exc)[:400]
        logger.exception("Telephony active calls failed")

    # extension -> best live activity
    activity: dict[str, dict[str, Any]] = {}
    for call in raw_calls:
        call_id = str(call.get("call_id") or call.get("id") or "").strip()
        direction = str(call.get("direction") or "").strip().lower()
        call_status = _normalize_status(call.get("status"))
        call_start = _as_dt(call.get("start_time") or call.get("start"))
        legs = call.get("legs") if isinstance(call.get("legs"), list) else []
        parts = legs or [call]
        for leg in parts:
            if not isinstance(leg, dict):
                continue
            status = _normalize_status(leg.get("status") or call_status)
            start = _as_dt(leg.get("start_time") or call_start) or call_start
            duration = None
            if start:
                duration = max(0, int((now - start).total_seconds()))
            for side_key in ("to", "from"):
                side = leg.get(side_key)
                if side is None:
                    side = call.get(side_key)
                digits = _digits(side)
                # Prefer short extension keys present in directory
                ext = None
                if digits in ext_directory:
                    ext = digits
                elif len(digits) <= 6 and digits:
                    ext = digits
                if not ext:
                    continue
                other_side = leg.get("from" if side_key == "to" else "to")
                if other_side is None:
                    other_side = call.get("from" if side_key == "to" else "to")
                row = {
                    "extension": ext,
                    "status": status,
                    "direction": direction or str(leg.get("direction") or "").lower(),
                    "on_call_with": _party_label(other_side, ext_directory=ext_directory),
                    "on_call_with_raw": str(other_side or ""),
                    "duration_seconds": duration,
                    "call_id": call_id,
                    "started_at": start.isoformat() if start else None,
                }
                prev = activity.get(ext)
                # Prefer ringing/on-call over weaker statuses; then longer duration.
                rank = {"ringing": 3, "on-call": 2, "busy": 1, "held": 1}.get(status, 0)
                prev_rank = (
                    {"ringing": 3, "on-call": 2, "busy": 1, "held": 1}.get(
                        str(prev.get("status")), 0
                    )
                    if prev
                    else -1
                )
                if not prev or rank > prev_rank or (
                    rank == prev_rank
                    and (duration or 0) >= int(prev.get("duration_seconds") or 0)
                ):
                    activity[ext] = row

    directory: list[dict[str, Any]] = []
    for ext, base in sorted(
        ext_directory.items(),
        key=lambda item: (
            0 if item[0] in activity else 1,
            item[1].get("name") or "",
            item[0],
        ),
    ):
        live = activity.get(ext)
        directory.append(
            {
                "extension": ext,
                "name": base.get("name") or ext,
                "email": base.get("email") or "",
                "status": live.get("status") if live else "idle",
                "direction": live.get("direction") if live else "",
                "on_call_with": live.get("on_call_with") if live else "",
                "duration_seconds": live.get("duration_seconds") if live else None,
                "call_id": live.get("call_id") if live else None,
                "started_at": live.get("started_at") if live else None,
            }
        )

    ringing = sum(1 for r in directory if r["status"] == "ringing")
    on_call = sum(1 for r in directory if r["status"] == "on-call")
    return {
        "ok": telephony_error is None,
        "telephony_error": telephony_error,
        "fetched_at": now.isoformat(),
        "active_calls": len(raw_calls),
        "ringing": ringing,
        "on_call": on_call,
        "idle": sum(1 for r in directory if r["status"] == "idle"),
        "directory": directory,
    }
