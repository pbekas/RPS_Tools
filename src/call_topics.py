"""Configurable call topic catalog — load, normalize, and seed to Firestore."""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOPICS_PATH = ROOT / "docs" / "call_topics_v1.json"


def load_topics_from_file(path: Path | None = None) -> dict[str, Any]:
    import json

    path = path or DEFAULT_TOPICS_PATH
    data = json.loads(path.read_text())
    return _normalize_topicset(data)


def _normalize_topicset(data: dict[str, Any]) -> dict[str, Any]:
    topics = data.get("topics") or []
    active = [t for t in topics if t.get("active", True)]
    return {
        "version": str(data.get("version") or "v1"),
        "name": str(data.get("name") or "Call Topics"),
        "description": str(data.get("description") or ""),
        "topics": active,
        "all_topics": topics,
    }


@lru_cache(maxsize=1)
def default_topicset() -> dict[str, Any]:
    return load_topics_from_file()


def get_active_topicset(*, prefer_firestore: bool = True) -> dict[str, Any]:
    """Prefer Firestore call_topics/current; fall back to shipped JSON."""
    if prefer_firestore:
        try:
            from src.config import get_settings
            from src import database as db

            if get_settings().database_configured:
                remote = db.get_call_topics_current()
                if remote and remote.get("topics"):
                    return _normalize_topicset(remote)
        except Exception:
            pass
    return deepcopy(default_topicset())


def active_topics(topicset: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    ts = topicset or get_active_topicset()
    return list(ts.get("topics") or [])


def topics_for_prompt(topicset: dict[str, Any] | None = None) -> str:
    ts = topicset or get_active_topicset()
    lines = [
        f"Topic catalog version: {ts.get('version')}",
        "Pick exactly ONE topic id from the list below for the primary purpose of the call.",
        "Use the descriptions to decide; prefer the most specific matching topic.",
        "Return topic as the topic id (not the label), e.g. scheduling.",
        "",
    ]
    for t in active_topics(ts):
        lines.append(
            f"- id={t['id']} | label={t.get('label')}\n"
            f"  details: {t.get('description') or t.get('details') or ''}"
        )
    return "\n".join(lines)


def normalize_topic(
    raw: str | None,
    topicset: dict[str, Any] | None = None,
) -> dict[str, str]:
    """
    Map model output to a catalog topic.
    Returns {topic_id, topic_label} (topic field on calls stores the label for readability,
    topic_id stores the stable id).
    """
    ts = topicset or get_active_topicset()
    topics = active_topics(ts)
    if not topics:
        label = (raw or "Other").strip() or "Other"
        return {"topic_id": "other", "topic": label}

    by_id = {str(t.get("id") or "").lower(): t for t in topics}
    by_label = {str(t.get("label") or "").strip().lower(): t for t in topics}

    text = (raw or "").strip()
    key = text.lower()

    match = by_id.get(key) or by_label.get(key)
    if not match:
        # Fuzzy: id or label contained in raw / raw contained in label
        for t in topics:
            tid = str(t.get("id") or "").lower()
            lab = str(t.get("label") or "").lower()
            if tid and (tid in key or key in tid):
                match = t
                break
            if lab and (lab in key or key in lab):
                match = t
                break

    if not match:
        match = by_id.get("other") or topics[-1]

    return {
        "topic_id": str(match.get("id") or "other"),
        "topic": str(match.get("label") or match.get("id") or "Other"),
    }


def seed_firestore(topicset: dict[str, Any] | None = None, *, force: bool = False) -> str:
    from src import database as db

    ts = topicset or load_topics_from_file()
    return db.seed_call_topics(ts, force=force)
