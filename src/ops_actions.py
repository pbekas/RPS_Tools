"""Shared ops actions used by the poller FastAPI service (and Streamlit)."""

from __future__ import annotations

from typing import Any

from src.agent_identity import resolve_or_create_agent
from src.bedrock_analyst import analyze_transcript
from src import database as db
from src.pipeline import enqueue_bytes


def reanalyze_call(call_id: str, *, send_alerts: bool = True) -> dict[str, Any]:
    """Re-score a call from its stored transcript (no Transcribe).

    If the stored transcript is Spanish (or other non-English), analysis translates
    it to English and stores transcript_original. Already-translated calls keep
    their original language turns.
    """
    call = db.get_call(call_id)
    if not call:
        raise LookupError(f"Call not found: {call_id}")

    transcript = call.get("transcript") or []
    if not transcript:
        raise ValueError("No transcript on this call to re-score")

    # Prefer source-language turns when we already translated once, so re-runs
    # can refresh the English transcript from the original Spanish.
    source_transcript = call.get("transcript_original") or transcript
    stt_language = call.get("stt_language") or call.get("transcript_language")

    scored = analyze_transcript(
        source_transcript,
        duration_seconds=call.get("duration_seconds"),
        original_filename=call.get("original_filename"),
        transfer_count_hint=call.get("transfer_count"),
        stt_language=stt_language if stt_language and stt_language != "en" else None,
    )
    if not scored.get("transcript"):
        scored["transcript"] = transcript

    # Preserve prior original/language metadata when this run did not re-translate.
    if not scored.get("transcript_original") and call.get("transcript_original"):
        scored["transcript_original"] = call.get("transcript_original")
        scored["transcript_translated"] = True
        if call.get("transcript_language"):
            scored["transcript_language"] = call.get("transcript_language")
    if call.get("stt_language") and not scored.get("stt_language"):
        scored["stt_language"] = call.get("stt_language")

    existing_email = (call.get("agent_email") or "").strip().lower()
    updates = {k: v for k, v in scored.items() if k != "recording_storage_uri"}
    if existing_email and not existing_email.startswith("unmapped."):
        updates.pop("agent_email", None)
        updates.pop("agent_name", None)
    else:
        email, name = resolve_or_create_agent(
            scored.get("agent_name") or call.get("agent_name") or ""
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
