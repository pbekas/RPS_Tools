"""Weekly metrics rollups and coaching trigger."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from src import database as db
from src.bedrock_analyst import generate_coaching_report


def _week_bounds(dt: datetime) -> tuple[datetime, datetime, int, int]:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # ISO week: Monday start
    start = dt - timedelta(days=dt.weekday())
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    iso = start.isocalendar()
    return start, end, iso.year, iso.week


def recompute_weekly_metrics_for_agent(agent_email: str) -> list[str]:
    """Rebuild weekly metric docs for an agent from their completed calls."""
    calls = db.list_calls(agent_email=agent_email, limit=500, status="complete")
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    agent_name = ""

    for call in calls:
        call_date = call.get("call_date") or call.get("created_at")
        if not isinstance(call_date, datetime):
            continue
        start, end, year, week = _week_bounds(call_date)
        doc_id = f"{agent_email}_{year}_W{week:02d}"
        buckets[doc_id].append(call)
        agent_name = call.get("agent_name") or agent_name

    written: list[str] = []
    for doc_id, rows in buckets.items():
        # Derive week from first row
        first_date = rows[0].get("call_date") or rows[0].get("created_at")
        start, end, year, week = _week_bounds(first_date)
        talk = [int(r.get("duration_seconds") or 0) for r in rows]
        empathy = [float(r.get("ai_empathy_score") or 0) for r in rows]
        quality = [float(r.get("quality_score") or 0) for r in rows]
        transfers = [float(r.get("transfer_count") or 0) for r in rows]
        fcr_flags = [1.0 if r.get("fcr") else 0.0 for r in rows]
        n = len(rows) or 1
        payload = {
            "agent_email": agent_email.lower(),
            "agent_name": agent_name,
            "week_start": start.date().isoformat(),
            "week_end": end.date().isoformat(),
            "year": year,
            "week": week,
            "call_count": len(rows),
            "total_talk_time_seconds": sum(talk),
            "avg_talk_time_seconds": sum(talk) / n,
            "avg_empathy_score": sum(empathy) / n,
            "avg_quality_score": sum(quality) / n,
            "fcr_rate": sum(fcr_flags) / n,
            "avg_transfers": sum(transfers) / n,
        }
        db.upsert_weekly_metrics(doc_id, payload)
        written.append(doc_id)
    return written


def run_weekly_coaching_for_agent(agent_email: str) -> str:
    """
    Aggregate recent calls + manager feedback, ask Bedrock for a coaching report,
    and save onto the Users record (rolling_ai_feedback).
    """
    user = db.get_user(agent_email)
    if not user:
        raise ValueError(f"User not found: {agent_email}")

    calls = db.list_calls(agent_email=agent_email, limit=100, status="complete")
    if not calls:
        report = "No completed calls in the recent window to coach on."
        db.set_rolling_feedback(agent_email, report)
        return report

    talk = sum(int(c.get("duration_seconds") or 0) for c in calls)
    empathy_vals = [float(c.get("ai_empathy_score") or 0) for c in calls]
    avg_empathy = sum(empathy_vals) / max(len(empathy_vals), 1)
    summaries = [str(c.get("ai_summary") or "") for c in calls]
    manager_notes = [
        str(c.get("manager_feedback") or "")
        for c in calls
        if (c.get("manager_feedback") or "").strip()
    ]
    # Also pull centralized feedback collection
    for fb in db.list_feedback(agent_email=agent_email, limit=50):
        if fb.get("text"):
            manager_notes.append(str(fb["text"]))

    report = generate_coaching_report(
        agent_name=user.get("name") or agent_email,
        avg_empathy=avg_empathy,
        total_talk_seconds=talk,
        call_count=len(calls),
        manager_feedback_notes=manager_notes,
        ai_summaries=summaries,
    )
    db.set_rolling_feedback(agent_email, report)
    recompute_weekly_metrics_for_agent(agent_email)
    return report


def run_weekly_coaching_all_agents() -> dict[str, str]:
    results: dict[str, str] = {}
    for user in db.list_users(role="Agent"):
        email = user.get("email")
        if not email:
            continue
        try:
            results[email] = run_weekly_coaching_for_agent(email)
        except Exception as exc:  # noqa: BLE001
            results[email] = f"ERROR: {exc}"
    return results
