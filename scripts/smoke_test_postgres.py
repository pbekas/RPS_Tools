#!/usr/bin/env python3
"""Run a non-PHI CRUD smoke test against the configured PostgreSQL database."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import postgres_db as db  # noqa: E402


def main() -> None:
    suffix = uuid.uuid4().hex[:12]
    email = f"postgres-smoke-{suffix}@example.invalid"
    recording_id = f"postgres-smoke-recording-{suffix}"
    log_id = f"postgres-smoke-log-{suffix}"
    call_id: str | None = None

    try:
        assert db.ping()
        user = db.upsert_user(email, "PostgreSQL Smoke Test", role="Agent")
        assert user["email"] == email

        now = datetime.now(timezone.utc)
        call_id = db.create_call(
            {
                "agent_email": email,
                "agent_name": "PostgreSQL Smoke Test",
                "patient_name": "",
                "call_date": now,
                "duration_seconds": 60,
                "status": "complete",
                "vonage_recording_id": recording_id,
                "smoke_test": True,
            }
        )
        db.update_call(call_id, {"quality_score": 99, "smoke_value": "verified"})
        call = db.get_call(call_id)
        assert call and call["smoke_value"] == "verified"
        matched = db.find_call_by_vonage_recording_id(recording_id)
        assert matched and matched["id"] == call_id

        db.upsert_call_log(
            {
                "id": log_id,
                "direction": "Inbound",
                "result": "Answered",
                "recorded": True,
                "length_seconds": 60,
                "start": now,
                "end": now,
                "matched_call_id": call_id,
                "smoke_test": True,
            }
        )
        log = db.get_call_log(log_id)
        assert log and log["matched_call_id"] == call_id
        print("PostgreSQL repository smoke test passed")
    finally:
        with db.get_connection() as conn:
            conn.execute("DELETE FROM call_logs WHERE id = %s", (log_id,))
            if call_id:
                conn.execute("DELETE FROM calls WHERE id = %s", (call_id,))
            conn.execute("DELETE FROM users WHERE email = %s", (email,))


if __name__ == "__main__":
    main()
