"""
Vonage recording webhook + near-real-time VBC poller API.

Run alongside Streamlit / Next.js:
  VBC_POLLER_ENABLED=1 uvicorn webhook:app --host 0.0.0.0 --port 8080

Or run the poller alone:
  python scripts/poll_vonage_recordings.py
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from src.config import get_settings
from src.pipeline import enqueue_bytes
from src.vonage_poller import (
    autostart_from_env,
    poller_status,
    run_sync_cycle,
    start_poller,
    stop_poller,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("webhook")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    status = autostart_from_env()
    if status:
        logger.info("VBC poller autostarted: %s", status)
    yield
    stop_poller()


app = FastAPI(
    title="RPS Call QA Webhooks",
    version="0.2.0",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "poller": poller_status()}


@app.get("/poller/status")
def get_poller_status() -> dict[str, Any]:
    return poller_status()


@app.post("/poller/start")
async def poller_start(request: Request) -> JSONResponse:
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass
    status = start_poller(
        interval_seconds=body.get("interval_seconds"),
        lookback_minutes=body.get("lookback_minutes"),
        max_per_cycle=body.get("max_per_cycle"),
    )
    return JSONResponse({"status": "started", "poller": status})


@app.post("/poller/stop")
def poller_stop() -> JSONResponse:
    return JSONResponse({"status": "stopped", "poller": stop_poller()})


@app.post("/poller/sync-now")
async def poller_sync_now(request: Request) -> JSONResponse:
    """Trigger one incremental VBC sync (used by EventBridge / manual kick)."""
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass
    try:
        summary = run_sync_cycle(
            lookback_minutes=body.get("lookback_minutes"),
            max_per_cycle=body.get("max_per_cycle"),
            process_now=bool(body.get("inline", False)),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return JSONResponse({"status": "ok", "summary": summary})


@app.post("/webhooks/vonage/recording")
async def vonage_recording(request: Request) -> JSONResponse:
    """
    Accept classic Vonage Voice API recording callbacks (if used).

    VBC company recordings are pull-based — use the poller for those.
    """
    settings = get_settings()
    try:
        payload: dict[str, Any] = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    if settings.vonage_signature_secret:
        provided = request.headers.get("x-vonage-signature") or request.headers.get(
            "Authorization"
        )
        if not provided or settings.vonage_signature_secret not in str(provided):
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
    """
    Catch-all for Vonage / VIS call events.

    On call-ended style events, kick an incremental VBC sync shortly after,
    because company recordings usually appear a bit after hangup.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    keys = list(payload.keys()) if isinstance(payload, dict) else []
    event_type = str(
        (payload or {}).get("type")
        or (payload or {}).get("event")
        or (payload or {}).get("state")
        or ""
    ).lower()

    triggered = False
    if any(
        token in event_type
        for token in ("end", "hangup", "complete", "completed", "finished")
    ) or "ended" in str(payload).lower():
        try:
            # Small lookback is enough; recording may land within minutes.
            run_sync_cycle(lookback_minutes=15, max_per_cycle=10, process_now=False)
            triggered = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Event-triggered sync failed: %s", exc)

    return JSONResponse(
        {
            "status": "received",
            "keys": keys,
            "event_type": event_type,
            "sync_triggered": triggered,
        }
    )
