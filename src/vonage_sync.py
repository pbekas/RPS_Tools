"""Pull Vonage VBC company call recordings into the QA pipeline."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from src import firestore_db as db
from src.config import get_settings
from src.pipeline import enqueue_bytes
from src.vonage_vbc import VBCRecording, VonageVBCClient


def find_existing_by_vonage_recording_id(recording_id: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.firestore_configured:
        return None
    # Prefer a field query; fall back to recent scan if index missing
    try:
        from google.cloud import firestore

        client = db.get_db()
        q = (
            client.collection("calls")
            .where("vonage_recording_id", "==", str(recording_id))
            .limit(1)
        )
        for doc in q.stream():
            data = doc.to_dict() or {}
            data["id"] = doc.id
            return data
    except Exception:
        for call in db.list_calls(limit=200):
            if str(call.get("vonage_recording_id") or "") == str(recording_id):
                return call
    return None


def sync_company_recordings(
    *,
    days_back: int = 7,
    start: datetime | None = None,
    end: datetime | None = None,
    max_recordings: int = 100,
    extension: str | None = None,
    skip_existing: bool = True,
    enqueue_for_qa: bool = True,
) -> dict[str, Any]:
    """
    List VBC company recordings in a date window, download new ones,
    and queue them for Transcribe + Bedrock QA.
    """
    client = VonageVBCClient()
    now = datetime.now(timezone.utc)
    start_gte = start or (now - timedelta(days=days_back))
    start_lte = end or now

    summary: dict[str, Any] = {
        "listed": 0,
        "queued": 0,
        "skipped_existing": 0,
        "errors": [],
        "call_ids": [],
    }

    seen = 0
    for rec in client.iter_company_recordings(
        start_gte=start_gte,
        start_lte=start_lte,
        page_size=50,
        extension=extension,
    ):
        if not rec.recording_id:
            continue
        seen += 1
        summary["listed"] = seen
        if seen > max_recordings:
            break

        if skip_existing and find_existing_by_vonage_recording_id(rec.recording_id):
            summary["skipped_existing"] += 1
            continue

        if not enqueue_for_qa:
            continue

        try:
            call_id = ingest_recording(client, rec)
            summary["queued"] += 1
            summary["call_ids"].append(call_id)
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(
                {"recording_id": rec.recording_id, "error": str(exc)}
            )

    return summary


def ingest_recording(client: VonageVBCClient, rec: VBCRecording) -> str:
    audio = client.download_recording(rec)
    filename = f"vbc_{rec.recording_id}.mp3"
    # Heuristic: WAV often larger headers; keep mp3 default — content-type unknown
    if audio[:4] == b"RIFF":
        filename = f"vbc_{rec.recording_id}.wav"

    call_id = enqueue_bytes(
        data=audio,
        original_filename=filename,
        source="vonage",
        vonage_call_id=rec.call_id,
        call_date=rec.start or datetime.now(timezone.utc),
    )

    settings = get_settings()
    if settings.firestore_configured and not str(call_id).startswith("local_"):
        db.update_call(
            call_id,
            {
                "vonage_recording_id": rec.recording_id,
                "vonage_call_id": rec.call_id,
                "vonage_extension": rec.extension,
                "vonage_caller_id": rec.caller_id,
                "vonage_cnam": rec.cnam,
                "vonage_dnis": rec.dnis,
                "vonage_direction": rec.call_direction,
                "duration_seconds": rec.duration_seconds or 0,
                "call_date": rec.start or datetime.now(timezone.utc),
            },
        )
    return call_id


def test_connection() -> dict[str, Any]:
    """Fetch one page to validate credentials / API subscription."""
    client = VonageVBCClient()
    token_preview = client.get_access_token()[:12] + "…"
    rows, meta = client.list_company_recordings(page=0, page_size=1)
    return {
        "ok": True,
        "token_preview": token_preview,
        "account_id": client.account_id,
        "sample_count_on_first_page": len(rows),
        "page_size": meta.get("page_size"),
        "sample_recording_id": rows[0].recording_id if rows else None,
    }
