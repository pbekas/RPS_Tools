"""Shared ops actions used by the poller FastAPI service (and Streamlit)."""

from __future__ import annotations

from typing import Any

from src.agent_identity import is_mapped_agent_user, resolve_or_create_agent
from src.bedrock_analyst import analyze_transcript
from src import database as db
from src.pipeline import enqueue_bytes


def reanalyze_call(call_id: str, *, send_alerts: bool = True) -> dict[str, Any]:
    """Re-score a call from its stored transcript (no Transcribe)."""
    call = db.get_call(call_id)
    if not call:
        raise LookupError(f"Call not found: {call_id}")

    transcript = call.get("transcript") or []
    if not transcript:
        raise ValueError("No transcript on this call to re-score")

    scored = analyze_transcript(
        transcript,
        duration_seconds=call.get("duration_seconds"),
        original_filename=call.get("original_filename"),
        transfer_count_hint=call.get("transfer_count"),
    )
    if not scored.get("transcript"):
        scored["transcript"] = transcript

    existing_email = (call.get("agent_email") or "").strip().lower()
    existing_user = db.get_user(existing_email) if existing_email else None
    updates = {k: v for k, v in scored.items() if k != "recording_storage_uri"}
    if is_mapped_agent_user(existing_user):
        updates.pop("agent_email", None)
        updates.pop("agent_name", None)
    else:
        email, name = resolve_or_create_agent(
            scored.get("agent_name") or call.get("agent_name") or "",
            vonage_extension=call.get("vonage_extension"),
        )
        updates["agent_email"] = email
        updates["agent_name"] = name

    db.update_call(call_id, updates)

    if send_alerts and updates.get("has_critical_flags"):
        try:
            from src.notify import alert_critical_flags

            alert_critical_flags(
                call_id=call_id,
                agent_name=updates.get("agent_name") or call.get("agent_name"),
                agent_email=updates.get("agent_email") or call.get("agent_email"),
                patient_name=updates.get("patient_name") or call.get("patient_name"),
                phone=call.get("vonage_caller_id"),
                doctor_name=updates.get("doctor_name") or call.get("doctor_name"),
                flags=list(updates.get("critical_flags") or []),
            )
        except Exception:
            pass

    refreshed = db.get_call(call_id) or {**call, **updates, "id": call_id}
    return {
        "call_id": call_id,
        "quality_score": refreshed.get("quality_score"),
        "ai_empathy_score": refreshed.get("ai_empathy_score"),
        "auto_failed": refreshed.get("auto_failed"),
        "has_critical_flags": refreshed.get("has_critical_flags"),
        "critical_flags": refreshed.get("critical_flags") or [],
        "patient_name": refreshed.get("patient_name"),
        "doctor_name": refreshed.get("doctor_name"),
        "topic": refreshed.get("topic"),
        "agent_name": refreshed.get("agent_name"),
        "agent_email": refreshed.get("agent_email"),
    }


def enqueue_upload(
    *,
    data: bytes,
    original_filename: str,
) -> dict[str, Any]:
    """Queue a manual audio upload for Transcribe + Bedrock analysis."""
    if not data:
        raise ValueError("Empty upload")
    name = (original_filename or "upload.wav").strip() or "upload.wav"
    call_id = enqueue_bytes(
        data=data,
        original_filename=name,
        source="upload",
        queue_background=True,
    )
    return {"call_id": call_id, "status": "queued", "original_filename": name}
