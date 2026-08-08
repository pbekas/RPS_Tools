"""Configurable critical call flags — load, normalize, seed to Firestore."""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FLAGS_PATH = ROOT / "docs" / "call_flags_v1.json"


def load_flags_from_file(path: Path | None = None) -> dict[str, Any]:
    import json

    path = path or DEFAULT_FLAGS_PATH
    data = json.loads(path.read_text())
    return _normalize_flagset(data)


def _normalize_flagset(data: dict[str, Any]) -> dict[str, Any]:
    flags = data.get("flags") or []
    active = [f for f in flags if f.get("active", True)]
    return {
        "version": str(data.get("version") or "v1"),
        "name": str(data.get("name") or "Call Flags"),
        "description": str(data.get("description") or ""),
        "flags": active,
        "all_flags": flags,
    }


@lru_cache(maxsize=1)
def default_flagset() -> dict[str, Any]:
    return load_flags_from_file()


def get_active_flagset(*, prefer_firestore: bool = True) -> dict[str, Any]:
    if prefer_firestore:
        try:
            from src.config import get_settings
            from src import database as db

            if get_settings().database_configured:
                remote = db.get_call_flags_current()
                if remote and remote.get("flags"):
                    return _normalize_flagset(remote)
        except Exception:
            pass
    return deepcopy(default_flagset())


def active_flags(flagset: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    fs = flagset or get_active_flagset()
    return list(fs.get("flags") or [])


def flags_for_prompt(flagset: dict[str, Any] | None = None) -> str:
    fs = flagset or get_active_flagset()
    lines = [
        f"Critical flag catalog version: {fs.get('version')}",
        "Evaluate EVERY active flag. Include a critical_flags entry only when triggered=true.",
        "These are business alerts (not agent coaching fails) unless the notes say otherwise.",
        "",
    ]
    for f in active_flags(fs):
        lines.append(
            f"- id={f['id']} | label={f.get('label')} | severity={f.get('severity') or 'critical'}\n"
            f"  trigger_when: {f.get('description') or ''}"
        )
    return "\n".join(lines)


def normalize_critical_flags(
    raw: list[dict[str, Any]] | None,
    flagset: dict[str, Any] | None = None,
    *,
    transcript: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    from src.qa_rules import resolve_evidence_anchor

    fs = flagset or get_active_flagset()
    by_id = {
        str(item.get("flag_id") or item.get("id") or ""): item
        for item in (raw or [])
    }
    out: list[dict[str, Any]] = []
    for flag in active_flags(fs):
        fid = str(flag.get("id") or "")
        item = by_id.get(fid) or {}
        if "triggered" not in item:
            continue
        if not bool(item.get("triggered")):
            continue
        evidence = str(item.get("evidence") or "").strip()
        evidence_ts = str(item.get("evidence_timestamp") or "").strip()
        turn_index = item.get("evidence_turn_index")
        try:
            turn_index = int(turn_index) if turn_index is not None else None
        except (TypeError, ValueError):
            turn_index = None
        if transcript:
            turn_index, evidence_ts = resolve_evidence_anchor(
                transcript,
                evidence=evidence,
                evidence_timestamp=evidence_ts,
                evidence_turn_index=turn_index,
            )
        out.append(
            {
                "flag_id": fid,
                "label": flag.get("label") or fid,
                "severity": flag.get("severity") or "critical",
                "triggered": True,
                "evidence": evidence,
                "evidence_timestamp": evidence_ts,
                "evidence_turn_index": turn_index,
                "notes": str(item.get("notes") or "").strip(),
            }
        )
    return out


def normalize_sentiment(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    label = str(data.get("label") or data.get("sentiment") or "neutral").strip().lower()
    if label not in {"positive", "neutral", "negative", "mixed"}:
        label = "neutral"
    score = data.get("score_1_to_10")
    try:
        score = max(1, min(10, int(round(float(score))))) if score is not None else None
    except (TypeError, ValueError):
        score = None
    if score is None:
        score = {"positive": 8, "neutral": 5, "mixed": 5, "negative": 2}.get(label, 5)
    return {
        "sentiment_label": label,
        "sentiment_score": score,
        "sentiment_notes": str(data.get("notes") or "").strip(),
    }


def seed_firestore(flagset: dict[str, Any] | None = None, *, force: bool = False) -> str:
    from src import database as db

    fs = flagset or load_flags_from_file()
    return db.seed_call_flags(fs, force=force)
