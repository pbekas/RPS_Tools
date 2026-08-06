"""
Vonage recording webhook + health API.

Run alongside Streamlit:
  uvicorn webhook:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from src.config import get_settings
from src.pipeline import enqueue_bytes

app = FastAPI(title="RPS Call QA Webhooks", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/webhooks/vonage/recording")
async def vonage_recording(request: Request) -> JSONResponse:
    """
    Accept Vonage recording callbacks.

    Typical payload includes recording_url / recording_uuid fields.
    Docs vary by Voice API version — we accept common shapes and download audio.
    """
    settings = get_settings()
    try:
        payload: dict[str, Any] = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    # Optional shared-secret header check
    if settings.vonage_signature_secret:
        provided = request.headers.get("x-vonage-signature") or request.headers.get(
            "Authorization"
        )
        if not provided or settings.vonage_signature_secret not in str(provided):
            # Soft check — tighten once your Vonage signing method is confirmed
            pass

    recording_url = (
        payload.get("recording_url")
        or payload.get("recordingUrl")
        or (payload.get("body") or {}).get("recording_url")
    )
    call_id = (
        payload.get("conversation_uuid")
        or payload.get("call_uuid")
        or payload.get("uuid")
        or payload.get("recording_uuid")
    )
    if not recording_url:
        raise HTTPException(
            status_code=422,
            detail="Missing recording_url in Vonage payload",
        )

    auth = None
    if settings.vonage_api_key and settings.vonage_api_secret:
        auth = (settings.vonage_api_key, settings.vonage_api_secret)

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(recording_url, auth=auth)
        if resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download recording ({resp.status_code})",
            )
        audio = resp.content

    filename = f"vonage_{call_id or 'unknown'}.mp3"
    content_type = resp.headers.get("content-type", "")
    if "wav" in content_type:
        filename = filename.replace(".mp3", ".wav")

    queued_id = enqueue_bytes(
        data=audio,
        original_filename=filename,
        source="vonage",
        vonage_call_id=str(call_id) if call_id else None,
        call_date=datetime.now(timezone.utc),
    )
    return JSONResponse(
        {"status": "queued", "call_id": queued_id, "vonage_call_id": call_id}
    )


@app.post("/webhooks/vonage/event")
async def vonage_event(request: Request) -> JSONResponse:
    """Catch-all for Vonage call events (answer, hangup, etc.)."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return JSONResponse({"status": "received", "keys": list(payload.keys())})
