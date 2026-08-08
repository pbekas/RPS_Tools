"""Batch processing pipeline for uploaded / Vonage call recordings."""

from __future__ import annotations

import logging
import os
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

logger = logging.getLogger(__name__)

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
_UPLOAD_ROOT.mkdir(exist_ok=True)

_lock = threading.Lock()
_queue: list[str] = []
_workers_started = 0
_queue_wakeup = threading.Condition(_lock)


def qa_worker_count() -> int:
    """Parallel Transcribe/Bedrock workers (cap avoids accidental API storms)."""
    raw = os.getenv("QA_WORKER_COUNT", "4").strip() or "4"
    try:
        n = int(raw)
    except ValueError:
        n = 4
    return max(1, min(16, n))


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


def process_call_sync(
    call_id: str,
    audio_path: Path,
    *,
    transcribe_even_if_short: bool = False,
) -> dict[str, Any]:
    """Run Transcribe + Bedrock analysis and storage update for one call."""
    settings = get_settings()
    existing = db.get_call(call_id) or {}
    known_duration = int(existing.get("duration_seconds") or 0)
    # Only short-circuit when we already know a positive short duration (e.g. Vonage).
    if (
        known_duration > 0
        and not is_qa_eligible_duration(known_duration)
        and not transcribe_even_if_short
    ):
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

        # Short voicemail path: Transcribe only (skip Bedrock QA scoring).
        if (
            transcribe_even_if_short
            and known_duration > 0
            and not is_qa_eligible_duration(known_duration)
        ):
            from src.bedrock_analyst import transcribe_audio

            media_uri = storage_uri if storage_uri.startswith("s3://") else None
            if not media_uri:
                raise RuntimeError("S3 recording URI required to transcribe short voicemail")
            turns, duration_seconds, stt_language = transcribe_audio(media_uri)
            updates = {
                "duration_seconds": duration_seconds or known_duration,
                "recording_gcs_path": storage_uri,
                "recording_storage_uri": storage_uri,
                "recording_url": recording_url or str(audio_path.resolve()),
                "status": "skipped_short",
                "error_message": "Voicemail / short recording — transcribed for alerts, skipped QA",
                "ai_summary": "Short recording transcribed for voicemail alert (QA scoring skipped).",
                "transcript": turns or [],
                "stt_language": stt_language,
                "call_date": existing.get("call_date") or datetime.now(timezone.utc),
            }
            db.update_call(call_id, updates)
            _maybe_alert_missed_after_transcript(call_id)
            return {"call_id": call_id, **updates}

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
            _maybe_alert_missed_after_transcript(call_id)
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
                recompute_weekly_metrics_for_agent(agent_email)
            except Exception:
                pass

        _maybe_alert_missed_after_transcript(call_id)
        return {"call_id": call_id, **updates}
    except Exception as exc:  # noqa: BLE001
        db.update_call(
            call_id,
            {"status": "error", "error_message": str(exc)},
        )
        raise


def _maybe_alert_missed_after_transcript(call_id: str) -> None:
    try:
        from src.notify import maybe_alert_missed_call_for_processed_call

        call = db.get_call(call_id) or {}
        maybe_alert_missed_call_for_processed_call(call)
    except Exception:
        logger.exception(
            "Post-transcript missed-call alert failed for %s", call_id
        )

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


def _ensure_workers_locked() -> None:
    """Start up to QA_WORKER_COUNT daemon workers (caller holds _lock)."""
    global _workers_started
    target = qa_worker_count()
    while _workers_started < target:
        _workers_started += 1
        name = f"qa-worker-{_workers_started}"
        threading.Thread(target=_worker_loop, name=name, daemon=True).start()
        logger.info("Started %s (pool size %s)", name, target)


def _queue_job(call_id: str, path: Path) -> None:
    with _queue_wakeup:
        _queue.append(f"{call_id}::{path}")
        _ensure_workers_locked()
        _queue_wakeup.notify()


def _worker_loop() -> None:
    while True:
        with _queue_wakeup:
            while not _queue:
                _queue_wakeup.wait(timeout=5.0)
                if not _queue:
                    continue
            item = _queue.pop(0)
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
            logger.exception("QA worker failed for call_id=%s", call_id)


def save_upload_to_temp(uploaded_file: Any) -> Path:
    suffix = Path(uploaded_file.name).suffix or ".mp3"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(uploaded_file.getvalue())
    tmp.flush()
    tmp.close()
    return Path(tmp.name)
