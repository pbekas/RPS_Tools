"""Batch processing pipeline for uploaded / Vonage call recordings."""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from src import database as db
from src.agent_identity import resolve_or_create_agent
from src.call_filters import is_qa_eligible_duration
from src.config import get_settings
from src.bedrock_analyst import analyze_call_audio
from src.metrics import recompute_weekly_metrics_for_agent
from src.storage import upload_recording

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
_UPLOAD_ROOT.mkdir(exist_ok=True)

_lock = threading.Lock()
_queue: list[str] = []
_worker_started = False


def enqueue_local_file(
    *,
    source_path: Path,
    original_filename: str,
    source: str = "upload",
    vonage_call_id: str | None = None,
    call_date: datetime | None = None,
) -> str:
    """Copy file into uploads/, create Firestore pending row, queue for analysis."""
    call_id = _create_pending(
        original_filename=original_filename,
        source=source,
        vonage_call_id=vonage_call_id,
        call_date=call_date,
    )
    dest = _UPLOAD_ROOT / f"{call_id}_{original_filename}"
    shutil.copy2(source_path, dest)
    _queue_job(call_id, dest)
    return call_id


def enqueue_bytes(
    *,
    data: bytes,
    original_filename: str,
    source: str = "upload",
    vonage_call_id: str | None = None,
    call_date: datetime | None = None,
    queue_background: bool = True,
) -> str:
    call_id = _create_pending(
        original_filename=original_filename,
        source=source,
        vonage_call_id=vonage_call_id,
        call_date=call_date,
    )
    dest = _UPLOAD_ROOT / f"{call_id}_{original_filename}"
    dest.write_bytes(data)
    if queue_background:
        _queue_job(call_id, dest)
    return call_id


def enqueue_upload_file(
    *,
    fileobj: BinaryIO,
    original_filename: str,
) -> str:
    data = fileobj.read()
    return enqueue_bytes(data=data, original_filename=original_filename, source="upload")


def process_call_sync(call_id: str, audio_path: Path) -> dict[str, Any]:
    """Run Transcribe + Bedrock analysis and storage update for one call."""
    settings = get_settings()
    existing = db.get_call(call_id) or {}
    known_duration = int(existing.get("duration_seconds") or 0)
    # Only short-circuit when we already know a positive short duration (e.g. Vonage).
    if known_duration > 0 and not is_qa_eligible_duration(known_duration):
        updates = {
            "status": "skipped_short",
            "error_message": "Call under 30s — likely IVR-only; skipped QA",
            "ai_summary": "Skipped: recording 30 seconds or shorter (no live interaction).",
        }
        db.update_call(call_id, updates)
        return {"call_id": call_id, **existing, **updates}

    db.update_call(call_id, {"status": "processing"})
    try:
        storage_uri, recording_url = "", ""
        if settings.s3_configured:
            blob = f"recordings/{call_id}/{audio_path.name}"
            storage_uri, recording_url = upload_recording(
                local_path=audio_path,
                destination_blob=blob,
            )
        elif settings.gcs_bucket:
            blob = f"recordings/{call_id}/{audio_path.name}"
            storage_uri, recording_url = upload_recording(
                local_path=audio_path,
                destination_blob=blob,
            )

        analysis = analyze_call_audio(
            audio_path,
            original_filename=audio_path.name,
            s3_uri=storage_uri if storage_uri.startswith("s3://") else None,
        )

        # Prefer permanent recordings/ path over transcribe-inbox if analysis uploaded separately
        if analysis.get("recording_storage_uri") and not storage_uri:
            storage_uri = analysis["recording_storage_uri"]

        if not recording_url:
            recording_url = str(audio_path.resolve())

        duration_seconds = int(analysis.get("duration_seconds") or 0)
        if not is_qa_eligible_duration(duration_seconds):
            updates = {
                "duration_seconds": duration_seconds,
                "recording_gcs_path": storage_uri or analysis.get("recording_storage_uri") or "",
                "recording_storage_uri": storage_uri or analysis.get("recording_storage_uri") or "",
                "recording_url": recording_url,
                "status": "skipped_short",
                "error_message": "Call under 30s — likely IVR-only; skipped QA",
                "ai_summary": "Skipped: recording 30 seconds or shorter (no live interaction).",
                "transcript": analysis.get("transcript") or [],
                "call_date": datetime.now(timezone.utc),
            }
            db.update_call(call_id, updates)
            return {"call_id": call_id, **updates}

        agent_name = analysis["agent_name"]
        agent_email, agent_name = resolve_or_create_agent(agent_name)
        analysis["agent_name"] = agent_name

        updates = {
            **{k: v for k, v in analysis.items() if k != "recording_storage_uri"},
            "agent_email": agent_email,
            "recording_gcs_path": storage_uri or analysis.get("recording_storage_uri") or "",
            "recording_storage_uri": storage_uri or analysis.get("recording_storage_uri") or "",
            "recording_url": recording_url,
            "status": "complete",
            "error_message": None,
            "call_date": datetime.now(timezone.utc),
        }
        db.update_call(call_id, updates)

        if updates.get("has_critical_flags"):
            try:
                from src.notify import alert_critical_flags

                existing = db.get_call(call_id) or {}
                alert_critical_flags(
                    call_id=call_id,
                    agent_name=updates.get("agent_name"),
                    agent_email=agent_email,
                    patient_name=updates.get("patient_name"),
                    phone=existing.get("vonage_caller_id"),
                    doctor_name=updates.get("doctor_name"),
                    flags=list(updates.get("critical_flags") or []),
                )
            except Exception:
                pass
        if agent_email:
            try:
                from src.agent_identity import is_mapped_agent_user

                user = db.get_user(agent_email)
                if is_mapped_agent_user(user):
                    recompute_weekly_metrics_for_agent(agent_email)
            except Exception:
                pass

        return {"call_id": call_id, **updates}
    except Exception as exc:  # noqa: BLE001
        db.update_call(
            call_id,
            {"status": "error", "error_message": str(exc)},
        )
        raise


def _create_pending(
    *,
    original_filename: str,
    source: str,
    vonage_call_id: str | None,
    call_date: datetime | None,
) -> str:
    settings = get_settings()
    if not settings.database_configured:
        # Local stub id when the selected database is not ready — still process files
        return f"local_{uuid.uuid4().hex[:12]}"

    return db.create_call(
        {
            "agent_name": "",
            "agent_email": None,
            "patient_name": "",
            "call_date": call_date or datetime.now(timezone.utc),
            "duration_seconds": 0,
            "time_to_answer_seconds": None,
            "topic": "",
            "topic_id": "",
            "ai_empathy_score": 0,
            "ai_name_stated": False,
            "ai_summary": "",
            "transcript": [],
            "transfer_count": 0,
            "fcr": False,
            "quality_score": 0,
            "manager_feedback": "",
            "manager_notes": "",
            "recording_url": "",
            "recording_gcs_path": "",
            "original_filename": original_filename,
            "source": source,
            "vonage_call_id": vonage_call_id,
            "status": "pending",
            "error_message": None,
            "reviewed_by": None,
            "reviewed_at": None,
        }
    )


def _queue_job(call_id: str, path: Path) -> None:
    global _worker_started
    with _lock:
        _queue.append(f"{call_id}::{path}")
        if not _worker_started:
            _worker_started = True
            t = threading.Thread(target=_worker_loop, daemon=True)
            t.start()


def _worker_loop() -> None:
    while True:
        item = None
        with _lock:
            if _queue:
                item = _queue.pop(0)
        if not item:
            import time

            time.sleep(1)
            continue
        call_id, path_str = item.split("::", 1)
        path = Path(path_str)
        try:
            if call_id.startswith("local_"):
                # Without Firestore, write results next to file as JSON for demo
                import json

                analysis = analyze_call_audio(path, original_filename=path.name)
                out = path.with_suffix(path.suffix + ".qa.json")
                out.write_text(json.dumps({"call_id": call_id, **analysis}, indent=2))
            else:
                process_call_sync(call_id, path)
        except Exception:
            # Errors already recorded on the call document when using Firestore
            pass


def save_upload_to_temp(uploaded_file: Any) -> Path:
    suffix = Path(uploaded_file.name).suffix or ".mp3"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(uploaded_file.getvalue())
    tmp.flush()
    tmp.close()
    return Path(tmp.name)
