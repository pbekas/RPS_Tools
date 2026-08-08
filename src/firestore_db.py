"""Firestore data access layer for Call QA."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from google.cloud import firestore
from google.oauth2 import service_account

from src.call_filters import is_qa_eligible_duration
from src.config import get_settings

_db: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _db
    if _db is not None:
        return _db
    settings = get_settings()
    if not settings.firebase_service_account:
        raise RuntimeError(
            "FIREBASE_SERVICE_ACCOUNT is not configured. "
            "Paste the service account JSON (or a file path) into .env."
        )
    creds = service_account.Credentials.from_service_account_info(
        settings.firebase_service_account
    )
    project_id = settings.firebase_service_account.get("project_id")
    _db = firestore.Client(project=project_id, credentials=creds)
    return _db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(doc: firestore.DocumentSnapshot) -> dict[str, Any] | None:
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data["id"] = doc.id
    return data


# ── Users ──────────────────────────────────────────────────────────────


def upsert_user(
    email: str,
    name: str,
    role: str | None = None,
    *,
    provisional: bool | None = None,
) -> dict[str, Any]:
    db = get_db()
    email_norm = email.strip().lower()
    ref = db.collection("users").document(email_norm)
    snap = ref.get()
    now = _now()
    if snap.exists:
        updates: dict[str, Any] = {"name": name, "updated_at": now}
        if role:
            updates["role"] = role
        if provisional is not None:
            updates["provisional"] = provisional
        ref.update(updates)
    else:
        ref.set(
            {
                "email": email_norm,
                "name": name,
                "role": role or "Agent",
                "rolling_ai_feedback": "",
                "last_coaching_at": None,
                "active": True,
                "provisional": bool(provisional) if provisional is not None else False,
                "created_at": now,
                "updated_at": now,
            }
        )
    return _serialize(ref.get())  # type: ignore[return-value]


def get_user(email: str) -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("users").document(email.strip().lower()).get())


def list_users(role: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    query: Any = db.collection("users")
    if role:
        query = query.where("role", "==", role)
    return [d for d in (_serialize(doc) for doc in query.stream()) if d]


def set_rolling_feedback(email: str, feedback: str) -> None:
    db = get_db()
    db.collection("users").document(email.strip().lower()).update(
        {
            "rolling_ai_feedback": feedback,
            "last_coaching_at": _now(),
            "updated_at": _now(),
        }
    )


# ── Calls ──────────────────────────────────────────────────────────────


def create_call(payload: dict[str, Any]) -> str:
    db = get_db()
    now = _now()
    data = {
        **payload,
        "created_at": now,
        "updated_at": now,
        "status": payload.get("status", "pending"),
    }
    _ref = db.collection("calls").document()
    _ref.set(data)
    return _ref.id


def update_call(call_id: str, updates: dict[str, Any]) -> None:
    db = get_db()
    updates = {**updates, "updated_at": _now()}
    db.collection("calls").document(call_id).update(updates)


def get_call(call_id: str) -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("calls").document(call_id).get())


def find_call_by_vonage_recording_id(recording_id: str) -> dict[str, Any] | None:
    db = get_db()
    query = (
        db.collection("calls")
        .where("vonage_recording_id", "==", str(recording_id))
        .limit(1)
    )
    for doc in query.stream():
        return _serialize(doc)
    return None


def list_calls(
    *,
    agent_email: str | None = None,
    agent_name: str | None = None,
    limit: int = 100,
    status: str | None = None,
    require_min_duration: bool | None = None,
) -> list[dict[str, Any]]:
    """
    List calls. For status=\"complete\", short IVR-only recordings (<=30s)
    are excluded by default.
    """
    if require_min_duration is None:
        require_min_duration = status == "complete"
    db = get_db()
    fetch_limit = limit * 3 if require_min_duration else limit
    query: Any = db.collection("calls")
    if agent_email:
        query = query.where("agent_email", "==", agent_email.strip().lower())
    if agent_name:
        query = query.where("agent_name", "==", agent_name)
    if status:
        query = query.where("status", "==", status)
    query = query.order_by("call_date", direction=firestore.Query.DESCENDING).limit(
        fetch_limit
    )

    def _filter(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if require_min_duration:
            rows = [
                r for r in rows if is_qa_eligible_duration(r.get("duration_seconds"))
            ]
        return rows[:limit]

    try:
        rows = [d for d in (_serialize(doc) for doc in query.stream()) if d]
        return _filter(rows)
    except Exception:
        # Fallback if composite index missing — fetch and sort in memory
        query = db.collection("calls").limit(max(fetch_limit, limit * 3))
        rows = [d for d in (_serialize(doc) for doc in query.stream()) if d]
        if agent_email:
            rows = [
                r
                for r in rows
                if (r.get("agent_email") or "").lower() == agent_email.strip().lower()
            ]
        if agent_name:
            rows = [r for r in rows if r.get("agent_name") == agent_name]
        if status:
            rows = [r for r in rows if r.get("status") == status]

        def _sort_key(r: dict[str, Any]) -> datetime:
            v = r.get("call_date") or r.get("created_at") or datetime.min.replace(
                tzinfo=timezone.utc
            )
            if isinstance(v, datetime):
                return v
            return datetime.min.replace(tzinfo=timezone.utc)

        rows.sort(key=_sort_key, reverse=True)
        return _filter(rows)


def save_manager_review(
    call_id: str,
    *,
    manager_feedback: str,
    manager_notes: str,
    reviewer_email: str,
    reviewer_name: str,
) -> None:
    call = get_call(call_id)
    if not call:
        raise ValueError(f"Call {call_id} not found")
    update_call(
        call_id,
        {
            "manager_feedback": manager_feedback,
            "manager_notes": manager_notes,
            "reviewed_by": reviewer_email,
            "reviewed_at": _now(),
        },
    )
    if manager_feedback.strip():
        add_feedback(
            call_id=call_id,
            agent_email=call.get("agent_email"),
            agent_name=call.get("agent_name", ""),
            author_email=reviewer_email,
            author_name=reviewer_name,
            text=manager_feedback.strip(),
            call_date=call.get("call_date"),
            topic=call.get("topic"),
        )


# ── Feedback ───────────────────────────────────────────────────────────


def add_feedback(
    *,
    call_id: str,
    agent_email: str | None,
    agent_name: str,
    author_email: str,
    author_name: str,
    text: str,
    call_date: Any = None,
    topic: str | None = None,
) -> str:
    db = get_db()
    ref = db.collection("feedback").document()
    ref.set(
        {
            "call_id": call_id,
            "agent_email": (agent_email or "").lower() or None,
            "agent_name": agent_name,
            "author_email": author_email.lower(),
            "author_name": author_name,
            "text": text,
            "call_date": call_date,
            "topic": topic,
            "created_at": _now(),
        }
    )
    return ref.id


def list_feedback(
    *,
    agent_email: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    db = get_db()
    query: Any = db.collection("feedback")
    if agent_email:
        query = query.where("agent_email", "==", agent_email.strip().lower())
    query = query.order_by("created_at", direction=firestore.Query.DESCENDING).limit(
        limit
    )
    try:
        return [d for d in (_serialize(doc) for doc in query.stream()) if d]
    except Exception:
        rows = [d for d in (_serialize(doc) for doc in query.limit(limit * 2).stream()) if d]
        rows.sort(key=lambda r: r.get("created_at") or datetime.min, reverse=True)
        return rows[:limit]


# ── Metrics ────────────────────────────────────────────────────────────


def upsert_weekly_metrics(doc_id: str, payload: dict[str, Any]) -> None:
    db = get_db()
    payload = {**payload, "updated_at": _now()}
    db.collection("metrics").document(doc_id).set(payload, merge=True)


def list_metrics(
    *,
    agent_email: str | None = None,
    limit: int = 52,
) -> list[dict[str, Any]]:
    db = get_db()
    query: Any = db.collection("metrics")
    if agent_email:
        query = query.where("agent_email", "==", agent_email.strip().lower())
    query = query.order_by("week_start", direction=firestore.Query.DESCENDING).limit(
        limit
    )
    try:
        return [d for d in (_serialize(doc) for doc in query.stream()) if d]
    except Exception:
        rows = [d for d in (_serialize(doc) for doc in db.collection("metrics").stream()) if d]
        if agent_email:
            rows = [
                r
                for r in rows
                if (r.get("agent_email") or "").lower() == agent_email.strip().lower()
            ]
        rows.sort(key=lambda r: r.get("week_start") or "", reverse=True)
        return rows[:limit]


# ── QA Rules ───────────────────────────────────────────────────────────


def get_qa_rules_current() -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("qa_rules").document("current").get())


def seed_qa_rules(ruleset: dict[str, Any], *, force: bool = False) -> str:
    """Write ruleset to qa_rules/current and qa_rules/{version}."""
    db = get_db()
    version = str(ruleset.get("version") or "v1")
    current_ref = db.collection("qa_rules").document("current")
    if current_ref.get().exists and not force:
        return "qa_rules/current (unchanged — exists; pass force=True to overwrite)"

    payload = {
        **ruleset,
        "updated_at": _now(),
    }
    # Drop helper key if present
    payload.pop("all_rules", None)
    current_ref.set(payload)
    db.collection("qa_rules").document(version).set(payload)
    return f"qa_rules/current + qa_rules/{version}"


def save_qa_rules(ruleset: dict[str, Any]) -> str:
    """Always overwrite qa_rules/current (manager edits)."""
    return seed_qa_rules(ruleset, force=True)


# ── Call Topics ────────────────────────────────────────────────────────


def get_call_topics_current() -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("call_topics").document("current").get())


def seed_call_topics(topicset: dict[str, Any], *, force: bool = False) -> str:
    """Write topic catalog to call_topics/current and call_topics/{version}."""
    db = get_db()
    version = str(topicset.get("version") or "v1")
    current_ref = db.collection("call_topics").document("current")
    if current_ref.get().exists and not force:
        return "call_topics/current (unchanged — exists; pass force=True to overwrite)"

    payload = {
        **topicset,
        "updated_at": _now(),
    }
    payload.pop("all_topics", None)
    current_ref.set(payload)
    db.collection("call_topics").document(version).set(payload)
    return f"call_topics/current + call_topics/{version}"


def save_call_topics(topicset: dict[str, Any]) -> str:
    """Always overwrite call_topics/current (manager edits)."""
    return seed_call_topics(topicset, force=True)


# ── Critical Call Flags ────────────────────────────────────────────────


def get_call_flags_current() -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("call_flags").document("current").get())


def seed_call_flags(flagset: dict[str, Any], *, force: bool = False) -> str:
    """Write flag catalog to call_flags/current and call_flags/{version}."""
    db = get_db()
    version = str(flagset.get("version") or "v1")
    current_ref = db.collection("call_flags").document("current")
    if current_ref.get().exists and not force:
        return "call_flags/current (unchanged — exists; pass force=True to overwrite)"

    payload = {
        **flagset,
        "updated_at": _now(),
    }
    payload.pop("all_flags", None)
    current_ref.set(payload)
    db.collection("call_flags").document(version).set(payload)
    return f"call_flags/current + call_flags/{version}"


def save_call_flags(flagset: dict[str, Any]) -> str:
    """Always overwrite call_flags/current (manager edits)."""
    return seed_call_flags(flagset, force=True)


# ── Alert dedup ────────────────────────────────────────────────────────


def alert_recently_sent(alert_key: str, *, cooldown_minutes: int) -> bool:
    db = get_db()
    snap = db.collection("alert_state").document(alert_key).get()
    if not snap.exists:
        return False
    data = snap.to_dict() or {}
    sent_at = data.get("sent_at")
    if not isinstance(sent_at, datetime):
        return False
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    age = (_now() - sent_at).total_seconds() / 60.0
    return age < max(1, cooldown_minutes)


def mark_alert_sent(alert_key: str) -> None:
    db = get_db()
    db.collection("alert_state").document(alert_key).set(
        {"sent_at": _now(), "updated_at": _now()},
        merge=True,
    )


# ── Call Logs (VBC Reports CDRs) ───────────────────────────────────────


def upsert_call_log(payload: dict[str, Any]) -> str:
    """Upsert a CDR by Vonage call-log id (doc id = log id)."""
    db = get_db()
    log_id = str(payload.get("id") or "").strip()
    if not log_id:
        raise ValueError("call_log payload requires id")
    now = _now()
    data = {**payload, "synced_at": now, "updated_at": now, "created_at": now}
    data.pop("id", None)
    # Single write — avoid a read-before-write (quota-heavy during bulk sync).
    # created_at is overwritten on re-sync; acceptable for CDR ops data.
    db.collection("call_logs").document(log_id).set(data, merge=True)
    return log_id


def get_call_log(log_id: str) -> dict[str, Any] | None:
    db = get_db()
    return _serialize(db.collection("call_logs").document(log_id).get())


def list_call_logs(
    *,
    limit: int = 200,
    days: int | None = None,
    result: str | None = None,
    recorded: bool | None = None,
    direction: str | None = None,
    missed_only: bool = False,
    unrecorded_only: bool = False,
) -> list[dict[str, Any]]:
    """List CDRs newest-first. Filters applied in memory for index flexibility."""
    db = get_db()
    fetch_limit = max(limit * 3, 100)
    query: Any = db.collection("call_logs")
    try:
        query = query.order_by("start", direction=firestore.Query.DESCENDING).limit(
            fetch_limit
        )
        rows = [d for d in (_serialize(doc) for doc in query.stream()) if d]
    except Exception:
        rows = [
            d
            for d in (
                _serialize(doc) for doc in db.collection("call_logs").limit(fetch_limit).stream()
            )
            if d
        ]

        def _sort_key(r: dict[str, Any]) -> datetime:
            v = r.get("start") or r.get("synced_at") or datetime.min.replace(
                tzinfo=timezone.utc
            )
            if isinstance(v, datetime):
                return v
            return datetime.min.replace(tzinfo=timezone.utc)

        rows.sort(key=_sort_key, reverse=True)

    if days is not None and days > 0:
        cutoff = _now() - timedelta(days=days)
        filtered: list[dict[str, Any]] = []
        for r in rows:
            start = r.get("start")
            if isinstance(start, datetime):
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                if start >= cutoff:
                    filtered.append(r)
            else:
                filtered.append(r)
        rows = filtered

    if result:
        needle = result.strip().lower()
        rows = [r for r in rows if (r.get("result") or "").strip().lower() == needle]
    if recorded is not None:
        rows = [r for r in rows if r.get("recorded") is recorded]
    if direction:
        needle = direction.strip().lower()
        rows = [
            r for r in rows if (r.get("direction") or "").strip().lower() == needle
        ]
    if missed_only:
        rows = [r for r in rows if r.get("is_missed") or _is_missed_result(r.get("result"))]
    if unrecorded_only:
        rows = [r for r in rows if r.get("recorded") is False or r.get("is_unrecorded")]

    return rows[:limit]


def _is_missed_result(result: Any) -> bool:
    text = (str(result) if result is not None else "").strip().lower()
    if not text:
        return False
    return text not in {"answered", "connected"}
