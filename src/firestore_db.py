"""Firestore data access layer for Call QA."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore
from google.oauth2 import service_account

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


def list_calls(
    *,
    agent_email: str | None = None,
    agent_name: str | None = None,
    limit: int = 100,
    status: str | None = None,
) -> list[dict[str, Any]]:
    db = get_db()
    query: Any = db.collection("calls")
    if agent_email:
        query = query.where("agent_email", "==", agent_email.strip().lower())
    if agent_name:
        query = query.where("agent_name", "==", agent_name)
    if status:
        query = query.where("status", "==", status)
    query = query.order_by("call_date", direction=firestore.Query.DESCENDING).limit(limit)
    try:
        return [d for d in (_serialize(doc) for doc in query.stream()) if d]
    except Exception:
        # Fallback if composite index missing — fetch and sort in memory
        query = db.collection("calls").limit(limit * 3)
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
        return rows[:limit]


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
