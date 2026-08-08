#!/usr/bin/env python3
"""One-time, idempotent Firestore to PostgreSQL direct-cutover backfill.

The destination schema must be migrated before running this script. By default
all writes occur in one transaction; ``--dry-run`` executes the same SQL and
rolls the transaction back.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from psycopg import Connection, sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import firestore_db, postgres_db  # noqa: E402


COLLECTIONS = (
    "users",
    "calls",
    "feedback",
    "metrics",
    "qa_rules",
    "call_topics",
    "call_flags",
    "alert_state",
    "call_logs",
)

CALL_COLUMNS = (
    "agent_email", "agent_name", "patient_name", "doctor_name", "call_date",
    "duration_seconds", "time_to_answer_seconds", "topic", "topic_id",
    "ai_empathy_score", "ai_name_stated", "ai_summary", "transcript",
    "transcript_original", "transcript_language", "transcript_translated",
    "stt_language",
    "transfer_count", "fcr", "quality_score", "ruleset_version", "auto_failed",
    "auto_fail_rules", "flagset_version", "has_critical_flags",
    "sentiment_label", "sentiment_score", "sentiment_notes", "manager_feedback",
    "manager_notes", "reviewed_by", "reviewed_at", "recording_url",
    "recording_storage_uri", "recording_gcs_path", "original_filename", "source",
    "status", "error_message", "vonage_call_id", "vonage_recording_id",
    "vonage_extension", "vonage_caller_id", "vonage_cnam", "vonage_dnis",
    "vonage_direction", "critical_alert_sent_at",
)

CALL_LOG_MAP = {
    "direction": "direction", "from_number": "from_number", "to_number": "to_number",
    "result": "result", "recorded": "recorded", "length_seconds": "length_seconds",
    "start": "start_at", "end": "end_at", "source_user": "source_user",
    "source_user_full_name": "source_user_full_name",
    "source_extension": "source_extension", "source_device_name": "source_device_name",
    "source_sip_id": "source_sip_id", "destination_user": "destination_user",
    "destination_user_full_name": "destination_user_full_name",
    "destination_extension": "destination_extension",
    "destination_device_name": "destination_device_name",
    "destination_sip_id": "destination_sip_id", "custom_tag": "custom_tag",
    "in_network": "in_network", "international": "international", "charge": "charge",
    "rate": "rate", "is_missed": "is_missed", "is_unrecorded": "is_unrecorded",
    "matched_call_id": "matched_call_id",
}


@dataclass
class Report:
    counts: Counter[str] = field(default_factory=Counter)
    errors: list[str] = field(default_factory=list)

    def done(self, collection: str) -> None:
        self.counts[f"{collection}.upserted"] += 1

    def skip(self, collection: str, reason: str) -> None:
        self.counts[f"{collection}.skipped"] += 1
        self.errors.append(f"SKIP {collection}: {reason}")

    def error(self, collection: str, doc_id: str, exc: Exception) -> None:
        self.counts[f"{collection}.errors"] += 1
        self.errors.append(f"ERROR {collection}/{doc_id}: {type(exc).__name__}: {exc}")


def json_value(value: Any) -> Any:
    """Convert Firestore values to values accepted by PostgreSQL jsonb."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    # Firestore GeoPoint and DocumentReference are uncommon here but should not
    # abort an otherwise valid backfill.
    if not isinstance(value, (str, int, float, bool, type(None))):
        return str(value)
    return value


def email(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    return normalized or None


def utc(value: Any, fallback: datetime | None = None) -> datetime | None:
    if value is None:
        return fallback
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
        except ValueError:
            return fallback
    return fallback


def fetch_documents() -> dict[str, list[tuple[str, dict[str, Any]]]]:
    db = firestore_db.get_db()
    result: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for collection in COLLECTIONS:
        result[collection] = [
            (snapshot.id, snapshot.to_dict() or {})
            for snapshot in db.collection(collection).stream()
        ]
    return result


def upsert(
    conn: Connection[dict[str, Any]],
    table: str,
    key_columns: tuple[str, ...],
    values: dict[str, Any],
) -> None:
    names = list(values)
    updates = [name for name in names if name not in key_columns]
    query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) ").format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, names)),
        sql.SQL(", ").join(sql.Placeholder() for _ in names),
        sql.SQL(", ").join(map(sql.Identifier, key_columns)),
    )
    if updates:
        query += sql.SQL("DO UPDATE SET {}").format(
            sql.SQL(", ").join(
                sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(name), sql.Identifier(name))
                for name in updates
            )
        )
    else:
        query += sql.SQL("DO NOTHING")
    conn.execute(query, list(values.values()))


def ensure_user(
    conn: Connection[dict[str, Any]],
    value: Any,
    name: str,
    report: Report,
) -> str | None:
    normalized = email(value)
    if not normalized:
        return None
    exists = conn.execute("SELECT 1 FROM users WHERE email = %s", (normalized,)).fetchone()
    if not exists:
        now = datetime.now(timezone.utc)
        upsert(conn, "users", ("email",), {
            "email": normalized,
            "name": name or f"Provisional user ({normalized})",
            "role": "Agent",
            "provisional": True,
            "active": True,
            "created_at": now,
            "updated_at": now,
        })
        report.counts["users.placeholders"] += 1
    return normalized


def import_user(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    user_email = email(data.get("email") or doc_id)
    if not user_email:
        report.skip("users", f"{doc_id}: no email")
        return
    role = str(data.get("role") or "Agent")
    if role not in {"Admin", "Agent"}:
        role = "Agent"
        report.counts["users.roles_normalized"] += 1
    linked_to = email(data.get("linked_to"))
    if linked_to:
        ensure_user(conn, linked_to, "Provisional linked user", report)
    now = datetime.now(timezone.utc)
    upsert(conn, "users", ("email",), {
        "email": user_email,
        "name": str(data.get("name") or ""),
        "role": role,
        "rolling_ai_feedback": str(data.get("rolling_ai_feedback") or ""),
        "last_coaching_at": utc(data.get("last_coaching_at")),
        "active": bool(data.get("active", True)),
        "provisional": bool(data.get("provisional", False)),
        "linked_to": linked_to,
        "created_at": utc(data.get("created_at"), now),
        "updated_at": utc(data.get("updated_at"), now),
    })
    report.done("users")


def import_call(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    if not doc_id:
        report.skip("calls", "empty document id")
        return
    now = datetime.now(timezone.utc)
    agent = ensure_user(conn, data.get("agent_email"), str(data.get("agent_name") or ""), report)
    reviewer = ensure_user(conn, data.get("reviewed_by"), "Provisional reviewer", report)
    known: dict[str, Any] = {}
    for name in CALL_COLUMNS:
        if name in data:
            known[name] = data[name]
    known.update({
        "id": doc_id,
        "agent_email": agent,
        "reviewed_by": reviewer,
        "agent_name": str(data.get("agent_name") or ""),
        "patient_name": str(data.get("patient_name") or ""),
        "call_date": utc(data.get("call_date"), utc(data.get("created_at"), now)),
        "duration_seconds": max(0, int(data.get("duration_seconds") or 0)),
        "transfer_count": max(0, int(data.get("transfer_count") or 0)),
        "transcript": Jsonb(json_value(data.get("transcript") or [])),
        "auto_fail_rules": list(data.get("auto_fail_rules") or []),
        "auto_failed": bool(data.get("auto_failed", False)),
        "has_critical_flags": bool(data.get("has_critical_flags", False)),
        "manager_feedback": str(data.get("manager_feedback") or ""),
        "manager_notes": str(data.get("manager_notes") or ""),
        "status": str(data.get("status") or "pending"),
        "created_at": utc(data.get("created_at"), now),
        "updated_at": utc(data.get("updated_at"), now),
    })
    unknown = {
        key: value for key, value in data.items()
        if key not in CALL_COLUMNS
        and key not in {"id", "created_at", "updated_at", "rule_results", "critical_flags"}
    }
    known["analysis_raw"] = Jsonb(json_value(unknown))
    upsert(conn, "calls", ("id",), known)

    conn.execute("DELETE FROM call_rule_results WHERE call_id = %s", (doc_id,))
    for item in data.get("rule_results") or []:
        if not isinstance(item, dict):
            report.counts["call_rule_results.skipped"] += 1
            continue
        rule_id = str(item.get("rule_id") or item.get("id") or "").strip()
        if not rule_id:
            report.counts["call_rule_results.skipped"] += 1
            continue
        upsert(conn, "call_rule_results", ("call_id", "rule_id"), {
            "call_id": doc_id, "rule_id": rule_id, "label": item.get("label"),
            "category": item.get("category"), "passed": bool(item.get("passed", False)),
            "score_1_to_10": item.get("score_1_to_10"), "evidence": item.get("evidence"),
            "evidence_timestamp": item.get("evidence_timestamp"),
            "evidence_turn_index": item.get("evidence_turn_index"), "notes": item.get("notes"),
            "auto_fail": bool(item.get("auto_fail", False)), "weight": item.get("weight"),
            "created_at": utc(item.get("created_at"), utc(data.get("created_at"), now)),
            "updated_at": utc(item.get("updated_at"), utc(data.get("updated_at"), now)),
        })
        report.done("call_rule_results")

    conn.execute("DELETE FROM call_flag_results WHERE call_id = %s", (doc_id,))
    for item in data.get("critical_flags") or []:
        if not isinstance(item, dict):
            report.counts["call_flag_results.skipped"] += 1
            continue
        flag_id = str(item.get("flag_id") or item.get("id") or "").strip()
        if not flag_id:
            report.counts["call_flag_results.skipped"] += 1
            continue
        upsert(conn, "call_flag_results", ("call_id", "flag_id"), {
            "call_id": doc_id, "flag_id": flag_id, "label": item.get("label"),
            "severity": item.get("severity"), "triggered": bool(item.get("triggered", True)),
            "evidence": item.get("evidence"),
            "evidence_timestamp": item.get("evidence_timestamp"),
            "evidence_turn_index": item.get("evidence_turn_index"), "notes": item.get("notes"),
            "created_at": utc(item.get("created_at"), utc(data.get("created_at"), now)),
            "updated_at": utc(item.get("updated_at"), utc(data.get("updated_at"), now)),
        })
        report.done("call_flag_results")
    report.done("calls")


def import_feedback(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    call_id = str(data.get("call_id") or "").strip()
    if not call_id or not conn.execute("SELECT 1 FROM calls WHERE id = %s", (call_id,)).fetchone():
        report.skip("feedback", f"{doc_id}: missing call {call_id!r}")
        return
    agent = ensure_user(conn, data.get("agent_email"), str(data.get("agent_name") or ""), report)
    author = ensure_user(conn, data.get("author_email"), str(data.get("author_name") or ""), report)
    upsert(conn, "feedback", ("id",), {
        "id": doc_id, "call_id": call_id, "agent_email": agent,
        "agent_name": str(data.get("agent_name") or ""), "author_email": author,
        "author_name": str(data.get("author_name") or ""), "text": str(data.get("text") or ""),
        "call_date": utc(data.get("call_date")), "topic": data.get("topic"),
        "created_at": utc(data.get("created_at"), datetime.now(timezone.utc)),
    })
    report.done("feedback")


def import_metric(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    agent = ensure_user(conn, data.get("agent_email"), str(data.get("agent_name") or ""), report)
    if not agent:
        report.skip("metrics", f"{doc_id}: no agent_email")
        return
    required = ("week_start", "week_end", "year", "week")
    if any(data.get(key) in (None, "") for key in required):
        report.skip("metrics", f"{doc_id}: missing required week fields")
        return
    upsert(conn, "weekly_metrics", ("id",), {
        "id": doc_id, "agent_email": agent, "agent_name": str(data.get("agent_name") or ""),
        "week_start": data["week_start"], "week_end": data["week_end"],
        "year": int(data["year"]), "week": int(data["week"]),
        "call_count": max(0, int(data.get("call_count") or 0)),
        "total_talk_time_seconds": int(data.get("total_talk_time_seconds") or 0),
        "avg_talk_time_seconds": data.get("avg_talk_time_seconds") or 0,
        "avg_empathy_score": data.get("avg_empathy_score") or 0,
        "avg_quality_score": data.get("avg_quality_score") or 0,
        "fcr_rate": data.get("fcr_rate") or 0, "avg_transfers": data.get("avg_transfers") or 0,
        "updated_at": utc(data.get("updated_at"), datetime.now(timezone.utc)),
    })
    report.done("metrics")


def import_configs(
    conn: Connection[dict[str, Any]],
    kind: str,
    documents: Iterable[tuple[str, dict[str, Any]]],
    report: Report,
) -> None:
    docs = sorted(documents, key=lambda item: item[0] == "current")
    for doc_id, data in docs:
        version = str(data.get("version") or (doc_id if doc_id != "current" else "v1"))
        payload = dict(data)
        payload.pop("updated_at", None)
        now = datetime.now(timezone.utc)
        if doc_id == "current":
            conn.execute(
                "UPDATE config_sets SET is_current = false WHERE kind = %s AND version <> %s",
                (kind, version),
            )
        upsert(conn, "config_sets", ("kind", "version"), {
            "kind": kind, "version": version, "name": str(data.get("name") or ""),
            "description": str(data.get("description") or ""),
            "payload": Jsonb(json_value(payload)), "is_current": doc_id == "current",
            "created_at": utc(data.get("created_at"), utc(data.get("updated_at"), now)),
            "updated_at": utc(data.get("updated_at"), now),
        })
        report.done(kind)


def import_alert(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    sent_at = utc(data.get("sent_at"))
    if not sent_at:
        report.skip("alert_state", f"{doc_id}: no valid sent_at")
        return
    upsert(conn, "alert_state", ("alert_key",), {
        "alert_key": doc_id, "sent_at": sent_at,
        "updated_at": utc(data.get("updated_at"), sent_at),
    })
    report.done("alert_state")


def import_call_log(
    conn: Connection[dict[str, Any]], doc_id: str, data: dict[str, Any], report: Report
) -> None:
    matched = str(data.get("matched_call_id") or "").strip() or None
    if matched and not conn.execute("SELECT 1 FROM calls WHERE id = %s", (matched,)).fetchone():
        matched = None
        report.counts["call_logs.links_nulled"] += 1
    values = {
        db_name: data[source] for source, db_name in CALL_LOG_MAP.items()
        if source in data and source != "matched_call_id"
    }
    values["matched_call_id"] = matched
    values["length_seconds"] = max(0, int(data.get("length_seconds") or 0))
    unknown = {
        key: value for key, value in data.items()
        if key not in CALL_LOG_MAP and key not in {"id", "raw", "synced_at", "created_at", "updated_at"}
    }
    raw = data.get("raw") if isinstance(data.get("raw"), dict) else {}
    now = datetime.now(timezone.utc)
    values.update({
        "id": doc_id, "raw": Jsonb(json_value({**raw, **unknown})),
        "synced_at": utc(data.get("synced_at"), now),
        "created_at": utc(data.get("created_at"), now),
        "updated_at": utc(data.get("updated_at"), now),
    })
    upsert(conn, "call_logs", ("id",), values)
    report.done("call_logs")


def run_backfill(
    conn: Connection[dict[str, Any]],
    documents: dict[str, list[tuple[str, dict[str, Any]]]],
) -> Report:
    required_tables = (
        "users", "calls", "call_rule_results", "call_flag_results", "feedback",
        "weekly_metrics", "config_sets", "alert_state", "call_logs",
    )
    missing = [
        table for table in required_tables
        if conn.execute("SELECT to_regclass(%s) AS table_name", (table,)).fetchone()["table_name"]
        is None
    ]
    if missing:
        raise RuntimeError(
            "PostgreSQL schema is not migrated; missing tables: " + ", ".join(missing)
        )
    report = Report()
    handlers = (
        ("users", import_user), ("calls", import_call), ("feedback", import_feedback),
        ("metrics", import_metric), ("alert_state", import_alert), ("call_logs", import_call_log),
    )
    for collection, handler in handlers:
        for doc_id, data in documents.get(collection, []):
            try:
                with conn.transaction():
                    handler(conn, doc_id, data, report)
            except Exception as exc:
                report.error(collection, doc_id, exc)
    for kind in ("qa_rules", "call_topics", "call_flags"):
        try:
            with conn.transaction():
                import_configs(conn, kind, documents.get(kind, []), report)
        except Exception as exc:
            report.error(kind, "*", exc)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="execute and validate, then roll back")
    parser.add_argument(
        "--allow-errors", action="store_true",
        help="commit successful documents even if some documents fail or are skipped",
    )
    args = parser.parse_args()

    print("Reading Firestore collections...", file=sys.stderr)
    documents = fetch_documents()
    source_counts = {name: len(rows) for name, rows in documents.items()}
    with postgres_db.get_connection() as conn:
        report = run_backfill(conn, documents)
        has_problems = bool(report.errors)
        should_rollback = args.dry_run or (has_problems and not args.allow_errors)
        if should_rollback:
            conn.rollback()

    output = {
        "mode": "dry-run" if args.dry_run else "backfill",
        "outcome": "rolled_back" if should_rollback else "committed",
        "source_counts": source_counts,
        "counts": dict(sorted(report.counts.items())),
        "messages": report.errors,
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    if has_problems and not args.allow_errors:
        print("Backfill was not committed; fix reported problems or pass --allow-errors.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
