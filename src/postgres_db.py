"""PostgreSQL data access layer with the same public contract as Firestore."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterator
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.call_filters import is_qa_eligible_duration
from src.config import get_settings

_CALL_COLUMNS = (
    "agent_email",
    "agent_name",
    "patient_name",
    "doctor_name",
    "call_date",
    "duration_seconds",
    "time_to_answer_seconds",
    "topic",
    "topic_id",
    "ai_empathy_score",
    "ai_name_stated",
    "ai_summary",
    "transcript",
    "transcript_original",
    "transcript_language",
    "transcript_translated",
    "stt_language",
    "transfer_count",
    "fcr",
    "quality_score",
    "ruleset_version",
    "auto_failed",
    "auto_fail_rules",
    "flagset_version",
    "has_critical_flags",
    "sentiment_label",
    "sentiment_score",
    "sentiment_notes",
    "manager_feedback",
    "manager_notes",
    "reviewed_by",
    "reviewed_at",
    "recording_url",
    "recording_storage_uri",
    "recording_gcs_path",
    "original_filename",
    "source",
    "status",
    "error_message",
    "vonage_call_id",
    "vonage_recording_id",
    "vonage_extension",
    "vonage_caller_id",
    "vonage_cnam",
    "vonage_dnis",
    "vonage_direction",
    "critical_alert_sent_at",
)
_CALL_JSON_COLUMNS = {"transcript", "transcript_original"}

_CALL_LOG_COLUMN_MAP = {
    "direction": "direction",
    "from_number": "from_number",
    "to_number": "to_number",
    "result": "result",
    "recorded": "recorded",
    "length_seconds": "length_seconds",
    "start": "start_at",
    "end": "end_at",
    "source_user": "source_user",
    "source_user_full_name": "source_user_full_name",
    "source_extension": "source_extension",
    "source_device_name": "source_device_name",
    "source_sip_id": "source_sip_id",
    "destination_user": "destination_user",
    "destination_user_full_name": "destination_user_full_name",
    "destination_extension": "destination_extension",
    "destination_device_name": "destination_device_name",
    "destination_sip_id": "destination_sip_id",
    "custom_tag": "custom_tag",
    "in_network": "in_network",
    "international": "international",
    "charge": "charge",
    "rate": "rate",
    "is_missed": "is_missed",
    "is_unrecorded": "is_unrecorded",
    "matched_call_id": "matched_call_id",
    # Telephony wait stubs (null until Vonage/ACD exposes ring/queue timing).
    "ring_seconds": "ring_seconds",
    "wait_seconds": "wait_seconds",
    "queue_seconds": "queue_seconds",
    "answered_at": "answered_at",
}
_CONFIG_KINDS = {"qa_rules", "call_topics", "call_flags"}
_CONFIG_HELPER_KEYS = {
    "qa_rules": "all_rules",
    "call_topics": "all_topics",
    "call_flags": "all_flags",
}


def connection_config() -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    if settings.database_url:
        return settings.database_url, {}
    if not settings.postgres_configured:
        raise RuntimeError(
            "DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD is required "
            "when DB_BACKEND=postgres"
        )
    kwargs: dict[str, Any] = {
        "host": settings.pg_host,
        "port": settings.pg_port,
        "dbname": settings.pg_database,
        "user": settings.pg_user,
        "password": settings.pg_password,
        "sslmode": settings.pg_sslmode,
    }
    if settings.pg_sslrootcert:
        kwargs["sslrootcert"] = settings.pg_sslrootcert
    return "", kwargs


@contextmanager
def get_connection() -> Iterator[Connection[dict[str, Any]]]:
    conninfo, kwargs = connection_config()
    with psycopg.connect(
        conninfo,
        **kwargs,
        row_factory=dict_row,
        connect_timeout=10,
    ) as conn:
        yield conn


def ping() -> bool:
    with get_connection() as conn:
        row = conn.execute("SELECT 1 AS ok").fetchone()
    return bool(row and row["ok"] == 1)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid4().hex


def _normalize(value: Any) -> Any:
    """Convert PostgreSQL-specific values while retaining datetime objects."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize(item) for item in value]
    return value


def _json_value(value: Any) -> Any:
    """Produce values accepted by jsonb without changing ordinary payloads."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _identifiers(names: list[str]) -> sql.Composed:
    return sql.SQL(", ").join(sql.Identifier(name) for name in names)


def _call_db_value(column: str, value: Any) -> Any:
    if column in _CALL_JSON_COLUMNS:
        return Jsonb(_json_value(value))
    return value


def _serialize_user(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = _normalize(dict(row))
    data["id"] = str(data["email"])
    return data


def _serialize_call(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    values = dict(row)
    raw = values.pop("analysis_raw", {}) or {}
    data = {**raw, **values}
    return _normalize(data)


def _serialize_call_log(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    values = dict(row)
    raw = values.pop("raw", {}) or {}
    values["start"] = values.pop("start_at", None)
    values["end"] = values.pop("end_at", None)
    return _normalize({**raw, "raw": raw, **values})


# ── Users ──────────────────────────────────────────────────────────────


def upsert_user(
    email: str,
    name: str,
    role: str | None = None,
    *,
    provisional: bool | None = None,
    modules: list[str] | None = None,
) -> dict[str, Any]:
    email_norm = email.strip().lower()
    role_value = role or None
    with get_connection() as conn:
        row = conn.execute(
            """
            INSERT INTO users (email, name, role, provisional, modules)
            VALUES (
              %s, %s, COALESCE(%s, 'Agent'), COALESCE(%s, false),
              COALESCE(%s::text[], '{}'::text[])
            )
            ON CONFLICT (email) DO UPDATE SET
                name = EXCLUDED.name,
                role = CASE
                    WHEN %s::text IS NULL THEN users.role
                    ELSE EXCLUDED.role
                END,
                provisional = CASE
                    WHEN %s::boolean IS NULL THEN users.provisional
                    ELSE EXCLUDED.provisional
                END,
                modules = CASE
                    WHEN %s::text[] IS NULL THEN users.modules
                    ELSE EXCLUDED.modules
                END,
                updated_at = now()
            RETURNING *
            """,
            (
                email_norm,
                name,
                role_value,
                provisional,
                modules,
                role_value,
                provisional,
                modules,
            ),
        ).fetchone()
    return _serialize_user(row)  # type: ignore[return-value]


def get_user(email: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = %s",
            (email.strip().lower(),),
        ).fetchone()
    return _serialize_user(row)


def list_users(role: str | None = None) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if role:
            rows = conn.execute(
                "SELECT * FROM users WHERE role = %s",
                (role,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM users").fetchall()
    return [_serialize_user(row) for row in rows]  # type: ignore[misc]


def set_rolling_feedback(email: str, feedback: str) -> None:
    with get_connection() as conn:
        result = conn.execute(
            """
            UPDATE users
            SET rolling_ai_feedback = %s, last_coaching_at = now(), updated_at = now()
            WHERE email = %s
            """,
            (feedback, email.strip().lower()),
        )
        if result.rowcount == 0:
            raise ValueError(f"User {email} not found")


def set_user_extension(email: str, extension: str | None) -> dict[str, Any]:
    """Set or clear a user's VBC extension. Empty string clears."""
    email_norm = email.strip().lower()
    ext = str(extension or "").strip()
    with get_connection() as conn:
        if ext:
            clash = conn.execute(
                """
                SELECT email FROM users
                WHERE extension = %s AND email <> %s
                LIMIT 1
                """,
                (ext, email_norm),
            ).fetchone()
            if clash:
                raise ValueError(
                    f"Extension {ext} is already mapped to {clash['email']}"
                )
        row = conn.execute(
            """
            UPDATE users
            SET extension = %s, updated_at = now()
            WHERE email = %s
            RETURNING *
            """,
            (ext, email_norm),
        ).fetchone()
        if not row:
            raise ValueError(f"User {email} not found")
        if ext:
            conn.execute(
                """
                INSERT INTO vonage_extensions (extension, mapped_email, source, updated_at)
                VALUES (%s, %s, 'manual', now())
                ON CONFLICT (extension) DO UPDATE SET
                    mapped_email = EXCLUDED.mapped_email,
                    source = CASE
                        WHEN vonage_extensions.source = 'provisioning' THEN vonage_extensions.source
                        ELSE 'manual'
                    END,
                    updated_at = now()
                """,
                (ext, email_norm),
            )
        else:
            conn.execute(
                """
                UPDATE vonage_extensions
                SET mapped_email = NULL, updated_at = now()
                WHERE mapped_email = %s
                """,
                (email_norm,),
            )
    return _serialize_user(row)  # type: ignore[return-value]


def get_user_by_extension(extension: str) -> dict[str, Any] | None:
    ext = str(extension or "").strip()
    if not ext:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE extension = %s LIMIT 1",
            (ext,),
        ).fetchone()
    return _serialize_user(row)


def list_distinct_cdr_extensions(*, limit: int = 2000) -> list[dict[str, Any]]:
    """Harvest unique extensions seen on CDRs with a best-effort display name."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            WITH parts AS (
                SELECT
                    nullif(trim(destination_extension), '') AS extension,
                    nullif(trim(destination_user_full_name), '') AS display_name,
                    nullif(trim(destination_user), '') AS username
                FROM call_logs
                WHERE nullif(trim(destination_extension), '') IS NOT NULL
                UNION ALL
                SELECT
                    nullif(trim(source_extension), '') AS extension,
                    nullif(trim(source_user_full_name), '') AS display_name,
                    nullif(trim(source_user), '') AS username
                FROM call_logs
                WHERE nullif(trim(source_extension), '') IS NOT NULL
            )
            SELECT
                extension,
                coalesce(max(display_name), '') AS display_name,
                coalesce(max(username), '') AS username,
                count(*)::int AS seen_count
            FROM parts
            WHERE extension IS NOT NULL
            GROUP BY extension
            ORDER BY count(*) DESC, extension
            LIMIT %s
            """,
            (max(1, limit),),
        ).fetchall()
    return [_normalize(dict(row)) for row in rows]


def upsert_vonage_extension(payload: dict[str, Any]) -> dict[str, Any]:
    ext = str(payload.get("extension") or "").strip()
    if not ext:
        raise ValueError("extension is required")
    with get_connection() as conn:
        row = conn.execute(
            """
            INSERT INTO vonage_extensions (
                extension, display_name, vbc_username, vbc_email, vbc_user_id,
                source, raw, synced_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, now(), now())
            ON CONFLICT (extension) DO UPDATE SET
                display_name = CASE
                    WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name
                    ELSE vonage_extensions.display_name
                END,
                vbc_username = CASE
                    WHEN EXCLUDED.vbc_username <> '' THEN EXCLUDED.vbc_username
                    ELSE vonage_extensions.vbc_username
                END,
                vbc_email = CASE
                    WHEN EXCLUDED.vbc_email <> '' THEN EXCLUDED.vbc_email
                    ELSE vonage_extensions.vbc_email
                END,
                vbc_user_id = CASE
                    WHEN EXCLUDED.vbc_user_id <> '' THEN EXCLUDED.vbc_user_id
                    ELSE vonage_extensions.vbc_user_id
                END,
                source = CASE
                    WHEN EXCLUDED.source = 'provisioning' THEN 'provisioning'
                    WHEN vonage_extensions.source = 'provisioning' THEN 'provisioning'
                    ELSE EXCLUDED.source
                END,
                raw = vonage_extensions.raw || EXCLUDED.raw,
                synced_at = now(),
                updated_at = now()
            RETURNING *
            """,
            (
                ext,
                str(payload.get("display_name") or "").strip(),
                str(payload.get("vbc_username") or "").strip(),
                str(payload.get("vbc_email") or "").strip().lower(),
                str(payload.get("vbc_user_id") or "").strip(),
                str(payload.get("source") or "cdr"),
                Jsonb(_json_value(payload.get("raw") or {})),
            ),
        ).fetchone()
    return _normalize(dict(row))  # type: ignore[arg-type]


def set_vonage_extension_mapping(extension: str, email: str | None) -> dict[str, Any]:
    ext = str(extension or "").strip()
    email_norm = (email or "").strip().lower() or None
    with get_connection() as conn:
        row = conn.execute(
            """
            UPDATE vonage_extensions
            SET mapped_email = %s, updated_at = now()
            WHERE extension = %s
            RETURNING *
            """,
            (email_norm, ext),
        ).fetchone()
        if not row:
            raise ValueError(f"Extension {ext} not found")
    return _normalize(dict(row))


def list_vonage_extensions() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM vonage_extensions
            ORDER BY
                CASE WHEN mapped_email IS NULL THEN 0 ELSE 1 END,
                extension
            """
        ).fetchall()
    return [_normalize(dict(row)) for row in rows]


# ── Calls ──────────────────────────────────────────────────────────────


def _call_parts(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    columns = {key: payload[key] for key in _CALL_COLUMNS if key in payload}
    unknown = {
        key: value
        for key, value in payload.items()
        if key not in _CALL_COLUMNS and key not in {"id", "created_at", "updated_at"}
    }
    return columns, unknown


def create_call(payload: dict[str, Any]) -> str:
    call_id = _new_id()
    columns, unknown = _call_parts(payload)
    columns.setdefault("call_date", _now())
    columns.setdefault("status", "pending")
    names = ["id", *columns, "analysis_raw"]
    values = [
        call_id,
        *(_call_db_value(name, columns[name]) for name in columns),
        Jsonb(_json_value(unknown)),
    ]
    query = sql.SQL("INSERT INTO calls ({}) VALUES ({})").format(
        _identifiers(names),
        sql.SQL(", ").join(sql.Placeholder() for _ in names),
    )
    with get_connection() as conn:
        conn.execute(query, values)
        _sync_call_results(conn, call_id, payload)
    return call_id


def update_call(call_id: str, updates: dict[str, Any]) -> None:
    columns, unknown = _call_parts(updates)
    assignments: list[sql.Composed] = []
    values: list[Any] = []
    for name, value in columns.items():
        assignments.append(
            sql.SQL("{} = {}").format(sql.Identifier(name), sql.Placeholder())
        )
        values.append(_call_db_value(name, value))
    if unknown:
        assignments.append(sql.SQL("analysis_raw = analysis_raw || %s::jsonb"))
        values.append(Jsonb(_json_value(unknown)))
    assignments.append(sql.SQL("updated_at = now()"))
    values.append(call_id)
    query = sql.SQL("UPDATE calls SET {} WHERE id = %s").format(
        sql.SQL(", ").join(assignments)
    )
    with get_connection() as conn:
        result = conn.execute(query, values)
        if result.rowcount == 0:
            raise ValueError(f"Call {call_id} not found")
        _sync_call_results(conn, call_id, updates)


def _sync_call_results(
    conn: Connection[dict[str, Any]],
    call_id: str,
    payload: dict[str, Any],
) -> None:
    if "rule_results" in payload:
        conn.execute("DELETE FROM call_rule_results WHERE call_id = %s", (call_id,))
        for item in payload.get("rule_results") or []:
            if not isinstance(item, dict):
                continue
            rule_id = str(item.get("rule_id") or item.get("id") or "").strip()
            if not rule_id:
                continue
            conn.execute(
                """
                INSERT INTO call_rule_results (
                    call_id, rule_id, label, category, passed, score_1_to_10,
                    evidence, evidence_timestamp, evidence_turn_index, notes,
                    auto_fail, weight
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    call_id,
                    rule_id,
                    item.get("label"),
                    item.get("category"),
                    bool(item.get("passed", False)),
                    item.get("score_1_to_10"),
                    item.get("evidence"),
                    item.get("evidence_timestamp"),
                    item.get("evidence_turn_index"),
                    item.get("notes"),
                    bool(item.get("auto_fail", False)),
                    item.get("weight"),
                ),
            )
    if "critical_flags" in payload:
        conn.execute("DELETE FROM call_flag_results WHERE call_id = %s", (call_id,))
        for item in payload.get("critical_flags") or []:
            if not isinstance(item, dict):
                continue
            flag_id = str(item.get("flag_id") or item.get("id") or "").strip()
            if not flag_id:
                continue
            conn.execute(
                """
                INSERT INTO call_flag_results (
                    call_id, flag_id, label, severity, triggered, evidence,
                    evidence_timestamp, evidence_turn_index, notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    call_id,
                    flag_id,
                    item.get("label"),
                    item.get("severity"),
                    bool(item.get("triggered", True)),
                    item.get("evidence"),
                    item.get("evidence_timestamp"),
                    item.get("evidence_turn_index"),
                    item.get("notes"),
                ),
            )


def _attach_call_results(
    conn: Connection[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not rows:
        return rows
    ids = [row["id"] for row in rows]
    rules: dict[str, list[dict[str, Any]]] = {}
    for result in conn.execute(
        """
        SELECT call_id, rule_id, label, category, passed, score_1_to_10,
               evidence, evidence_timestamp, evidence_turn_index, notes,
               auto_fail, weight
        FROM call_rule_results
        WHERE call_id = ANY(%s)
        ORDER BY call_id, rule_id
        """,
        (ids,),
    ).fetchall():
        call_id = result.pop("call_id")
        rules.setdefault(call_id, []).append(_normalize(result))
    flags: dict[str, list[dict[str, Any]]] = {}
    for result in conn.execute(
        """
        SELECT call_id, flag_id, label, severity, triggered, evidence,
               evidence_timestamp, evidence_turn_index, notes
        FROM call_flag_results
        WHERE call_id = ANY(%s)
        ORDER BY call_id, flag_id
        """,
        (ids,),
    ).fetchall():
        call_id = result.pop("call_id")
        flags.setdefault(call_id, []).append(_normalize(result))
    for row in rows:
        raw = row.get("analysis_raw") or {}
        call_id = row["id"]
        if call_id in rules or "rule_results" in raw:
            raw["rule_results"] = rules.get(call_id, [])
        if call_id in flags or "critical_flags" in raw:
            raw["critical_flags"] = flags.get(call_id, [])
        row["analysis_raw"] = raw
    return rows


def get_call(call_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM calls WHERE id = %s", (call_id,)).fetchone()
        rows = _attach_call_results(conn, [row] if row else [])
    return _serialize_call(rows[0]) if rows else None


def find_call_by_vonage_recording_id(recording_id: str) -> dict[str, Any] | None:
    """Find a call directly through the schema's recording-id index."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM calls WHERE vonage_recording_id = %s LIMIT 1",
            (recording_id.strip(),),
        ).fetchone()
        rows = _attach_call_results(conn, [row] if row else [])
    return _serialize_call(rows[0]) if rows else None


def list_calls(
    *,
    agent_email: str | None = None,
    agent_name: str | None = None,
    limit: int = 100,
    status: str | None = None,
    require_min_duration: bool | None = None,
) -> list[dict[str, Any]]:
    if require_min_duration is None:
        require_min_duration = status == "complete"
    clauses: list[sql.SQL] = []
    params: list[Any] = []
    if agent_email:
        clauses.append(sql.SQL("agent_email = %s"))
        params.append(agent_email.strip().lower())
    if agent_name:
        clauses.append(sql.SQL("agent_name = %s"))
        params.append(agent_name)
    if status:
        clauses.append(sql.SQL("status = %s"))
        params.append(status)
    fetch_limit = max(0, limit * 3 if require_min_duration else limit)
    where = (
        sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses)
        if clauses
        else sql.SQL("")
    )
    query = sql.SQL("SELECT * FROM calls{} ORDER BY call_date DESC LIMIT %s").format(
        where
    )
    params.append(fetch_limit)
    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        rows = _attach_call_results(conn, rows)
    serialized = [_serialize_call(row) for row in rows]
    if require_min_duration:
        serialized = [
            row
            for row in serialized
            if row and is_qa_eligible_duration(row.get("duration_seconds"))
        ]
    return [row for row in serialized if row][: max(0, limit)]


def save_manager_review(
    call_id: str,
    *,
    manager_feedback: str,
    manager_notes: str,
    reviewer_email: str,
    reviewer_name: str,
) -> None:
    with get_connection() as conn:
        call = conn.execute(
            "SELECT agent_email, agent_name, call_date, topic FROM calls WHERE id = %s",
            (call_id,),
        ).fetchone()
        if not call:
            raise ValueError(f"Call {call_id} not found")
        conn.execute(
            """
            UPDATE calls
            SET manager_feedback = %s, manager_notes = %s, reviewed_by = %s,
                reviewed_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (manager_feedback, manager_notes, reviewer_email.lower(), call_id),
        )
        if manager_feedback.strip():
            _insert_feedback(
                conn,
                call_id=call_id,
                agent_email=call.get("agent_email"),
                agent_name=call.get("agent_name") or "",
                author_email=reviewer_email,
                author_name=reviewer_name,
                text=manager_feedback.strip(),
                call_date=call.get("call_date"),
                topic=call.get("topic"),
            )


# ── Feedback ───────────────────────────────────────────────────────────


def _insert_feedback(
    conn: Connection[dict[str, Any]],
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
    feedback_id = _new_id()
    conn.execute(
        """
        INSERT INTO feedback (
            id, call_id, agent_email, agent_name, author_email, author_name,
            text, call_date, topic
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            feedback_id,
            call_id,
            (agent_email or "").lower() or None,
            agent_name,
            author_email.lower(),
            author_name,
            text,
            call_date,
            topic,
        ),
    )
    return feedback_id


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
    with get_connection() as conn:
        return _insert_feedback(
            conn,
            call_id=call_id,
            agent_email=agent_email,
            agent_name=agent_name,
            author_email=author_email,
            author_name=author_name,
            text=text,
            call_date=call_date,
            topic=topic,
        )


def list_feedback(
    *,
    agent_email: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if agent_email:
            rows = conn.execute(
                """
                SELECT * FROM feedback
                WHERE agent_email = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (agent_email.strip().lower(), max(0, limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM feedback ORDER BY created_at DESC LIMIT %s",
                (max(0, limit),),
            ).fetchall()
    return [_normalize(row) for row in rows]


# ── Metrics ────────────────────────────────────────────────────────────


def upsert_weekly_metrics(doc_id: str, payload: dict[str, Any]) -> None:
    columns = (
        "agent_email",
        "agent_name",
        "week_start",
        "week_end",
        "year",
        "week",
        "call_count",
        "total_talk_time_seconds",
        "avg_talk_time_seconds",
        "avg_empathy_score",
        "avg_quality_score",
        "fcr_rate",
        "avg_transfers",
    )
    supplied = {key: payload[key] for key in columns if key in payload}
    if "agent_email" in supplied:
        supplied["agent_email"] = str(supplied["agent_email"] or "").strip().lower()
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM weekly_metrics WHERE id = %s",
            (doc_id,),
        ).fetchone()
        if exists:
            assignments = [
                sql.SQL("{} = %s").format(sql.Identifier(key)) for key in supplied
            ]
            assignments.append(sql.SQL("updated_at = now()"))
            conn.execute(
                sql.SQL("UPDATE weekly_metrics SET {} WHERE id = %s").format(
                    sql.SQL(", ").join(assignments)
                ),
                (*supplied.values(), doc_id),
            )
            return

        missing = [key for key in columns if key not in supplied]
        if missing:
            raise ValueError(
                "New weekly metrics require fields: " + ", ".join(missing)
            )
        names = ["id", *supplied]
        conn.execute(
            sql.SQL("INSERT INTO weekly_metrics ({}) VALUES ({})").format(
                _identifiers(names),
                sql.SQL(", ").join(sql.Placeholder() for _ in names),
            ),
            (doc_id, *supplied.values()),
        )


def _serialize_metric(row: dict[str, Any]) -> dict[str, Any]:
    data = _normalize(row)
    for key in ("week_start", "week_end"):
        if isinstance(data.get(key), date) and not isinstance(data[key], datetime):
            data[key] = data[key].isoformat()
    return data


def list_metrics(
    *,
    agent_email: str | None = None,
    limit: int = 52,
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if agent_email:
            rows = conn.execute(
                """
                SELECT * FROM weekly_metrics
                WHERE agent_email = %s
                ORDER BY week_start DESC
                LIMIT %s
                """,
                (agent_email.strip().lower(), max(0, limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM weekly_metrics ORDER BY week_start DESC LIMIT %s",
                (max(0, limit),),
            ).fetchall()
    return [_serialize_metric(row) for row in rows]


# ── Versioned configuration sets ──────────────────────────────────────


def _get_config_current(kind: str) -> dict[str, Any] | None:
    if kind not in _CONFIG_KINDS:
        raise ValueError(f"Unsupported config kind: {kind}")
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT payload, updated_at
            FROM config_sets
            WHERE kind = %s AND is_current = true
            LIMIT 1
            """,
            (kind,),
        ).fetchone()
    if not row:
        return None
    payload = row.pop("payload") or {}
    return _normalize({**payload, **row, "id": "current"})


def _seed_config(kind: str, config: dict[str, Any], *, force: bool = False) -> str:
    if kind not in _CONFIG_KINDS:
        raise ValueError(f"Unsupported config kind: {kind}")
    version = str(config.get("version") or "v1")
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM config_sets WHERE kind = %s AND is_current = true",
            (kind,),
        ).fetchone()
        if exists and not force:
            return f"{kind}/current (unchanged — exists; pass force=True to overwrite)"
        payload = dict(config)
        payload.pop(_CONFIG_HELPER_KEYS[kind], None)
        payload.pop("updated_at", None)
        conn.execute(
            "UPDATE config_sets SET is_current = false, updated_at = now() WHERE kind = %s",
            (kind,),
        )
        conn.execute(
            """
            INSERT INTO config_sets (
                kind, version, name, description, payload, is_current
            ) VALUES (%s, %s, %s, %s, %s, true)
            ON CONFLICT (kind, version) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                payload = EXCLUDED.payload,
                is_current = true,
                updated_at = now()
            """,
            (
                kind,
                version,
                str(config.get("name") or ""),
                str(config.get("description") or ""),
                Jsonb(_json_value(payload)),
            ),
        )
    return f"{kind}/current + {kind}/{version}"


def get_qa_rules_current() -> dict[str, Any] | None:
    return _get_config_current("qa_rules")


def seed_qa_rules(ruleset: dict[str, Any], *, force: bool = False) -> str:
    return _seed_config("qa_rules", ruleset, force=force)


def save_qa_rules(ruleset: dict[str, Any]) -> str:
    return seed_qa_rules(ruleset, force=True)


def get_call_topics_current() -> dict[str, Any] | None:
    return _get_config_current("call_topics")


def seed_call_topics(topicset: dict[str, Any], *, force: bool = False) -> str:
    return _seed_config("call_topics", topicset, force=force)


def save_call_topics(topicset: dict[str, Any]) -> str:
    return seed_call_topics(topicset, force=True)


def get_call_flags_current() -> dict[str, Any] | None:
    return _get_config_current("call_flags")


def seed_call_flags(flagset: dict[str, Any], *, force: bool = False) -> str:
    return _seed_config("call_flags", flagset, force=force)


def save_call_flags(flagset: dict[str, Any]) -> str:
    return seed_call_flags(flagset, force=True)


# ── Alert deduplication ────────────────────────────────────────────────


def alert_recently_sent(alert_key: str, *, cooldown_minutes: int) -> bool:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT sent_at FROM alert_state WHERE alert_key = %s",
            (alert_key,),
        ).fetchone()
    if not row or not isinstance(row.get("sent_at"), datetime):
        return False
    sent_at = row["sent_at"]
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    return (_now() - sent_at).total_seconds() / 60.0 < max(1, cooldown_minutes)


def mark_alert_sent(alert_key: str) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO alert_state (alert_key, sent_at)
            VALUES (%s, now())
            ON CONFLICT (alert_key) DO UPDATE SET
                sent_at = now(), updated_at = now()
            """,
            (alert_key,),
        )


# ── Call Logs (VBC Reports CDRs) ───────────────────────────────────────


def upsert_call_log(payload: dict[str, Any]) -> str:
    log_id = str(payload.get("id") or "").strip()
    if not log_id:
        raise ValueError("call_log payload requires id")
    supplied = {
        db_name: payload[external]
        for external, db_name in _CALL_LOG_COLUMN_MAP.items()
        if external in payload
    }
    unknown = {
        key: value
        for key, value in payload.items()
        if key not in {"id", "raw"} and key not in _CALL_LOG_COLUMN_MAP
    }
    source_raw = payload.get("raw")
    raw = {
        **(source_raw if isinstance(source_raw, dict) else {}),
        **unknown,
    }
    names = ["id", *supplied, "raw", "synced_at", "created_at", "updated_at"]
    now = _now()
    values = [
        log_id,
        *(supplied[name] for name in supplied),
        Jsonb(_json_value(raw)),
        now,
        now,
        now,
    ]
    updates = [
        sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(name), sql.Identifier(name))
        for name in supplied
    ]
    updates.extend(
        [
            sql.SQL("raw = call_logs.raw || EXCLUDED.raw"),
            sql.SQL("synced_at = EXCLUDED.synced_at"),
            sql.SQL("created_at = EXCLUDED.created_at"),
            sql.SQL("updated_at = EXCLUDED.updated_at"),
        ]
    )
    query = sql.SQL(
        "INSERT INTO call_logs ({}) VALUES ({}) "
        "ON CONFLICT (id) DO UPDATE SET {}"
    ).format(
        _identifiers(names),
        sql.SQL(", ").join(sql.Placeholder() for _ in names),
        sql.SQL(", ").join(updates),
    )
    with get_connection() as conn:
        conn.execute(query, values)
    return log_id


def get_call_log(log_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM call_logs WHERE id = %s",
            (log_id,),
        ).fetchone()
    return _serialize_call_log(row)


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
    clauses: list[sql.SQL] = []
    params: list[Any] = []
    if days is not None and days > 0:
        clauses.append(sql.SQL("(start_at IS NULL OR start_at >= %s)"))
        params.append(_now() - timedelta(days=days))
    if result:
        clauses.append(sql.SQL("lower(btrim(result)) = %s"))
        params.append(result.strip().lower())
    if recorded is not None:
        clauses.append(sql.SQL("recorded = %s"))
        params.append(recorded)
    if direction:
        clauses.append(sql.SQL("lower(btrim(direction)) = %s"))
        params.append(direction.strip().lower())
    if missed_only:
        clauses.append(
            sql.SQL(
                "(is_missed = true OR "
                "(result IS NOT NULL AND btrim(result) <> '' "
                "AND lower(btrim(result)) NOT IN ('answered', 'connected')))"
            )
        )
    if unrecorded_only:
        clauses.append(sql.SQL("(recorded = false OR is_unrecorded = true)"))
    where = (
        sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses)
        if clauses
        else sql.SQL("")
    )
    query = sql.SQL(
        "SELECT * FROM call_logs{} "
        "ORDER BY start_at DESC NULLS LAST, synced_at DESC LIMIT %s"
    ).format(where)
    params.append(max(0, limit))
    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_serialize_call_log(row) for row in rows]  # type: ignore[misc]


def _is_missed_result(result: Any) -> bool:
    text = (str(result) if result is not None else "").strip().lower()
    return bool(text) and text not in {"answered", "connected"}
