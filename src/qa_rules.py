"""Versioned phone QA rule set — load, score, and seed to Firestore."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES_PATH = ROOT / "docs" / "qa_rules_v1.json"


def load_rules_from_file(path: Path | None = None) -> dict[str, Any]:
    path = path or DEFAULT_RULES_PATH
    data = json.loads(path.read_text())
    return _normalize_ruleset(data)


def _normalize_ruleset(data: dict[str, Any]) -> dict[str, Any]:
    rules = data.get("rules") or []
    active = [r for r in rules if r.get("active", True)]
    return {
        "version": str(data.get("version") or "v1"),
        "name": str(data.get("name") or "QA Rules"),
        "description": str(data.get("description") or ""),
        "auto_fail_quality_cap": int(data.get("auto_fail_quality_cap") or 4),
        "empathy_pass_threshold": int(data.get("empathy_pass_threshold") or 7),
        "transfer_soft_limit": int(data.get("transfer_soft_limit") or 1),
        "transfer_auto_fail_at": int(data.get("transfer_auto_fail_at") or 3),
        "rules": active,
        "all_rules": rules,
    }


@lru_cache(maxsize=1)
def default_ruleset() -> dict[str, Any]:
    return load_rules_from_file()


def get_active_ruleset(*, prefer_firestore: bool = True) -> dict[str, Any]:
    """Prefer Firestore qa_rules/current; fall back to shipped JSON."""
    if prefer_firestore:
        try:
            from src.config import get_settings
            from src import firestore_db as db

            if get_settings().firestore_configured:
                remote = db.get_qa_rules_current()
                if remote and remote.get("rules"):
                    return _normalize_ruleset(remote)
        except Exception:
            pass
    return deepcopy(default_ruleset())


def active_rules(ruleset: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rs = ruleset or get_active_ruleset()
    return list(rs.get("rules") or [])


def rules_for_prompt(ruleset: dict[str, Any] | None = None) -> str:
    """Format active rules as plain text for Bedrock."""
    rs = ruleset or get_active_ruleset()
    lines = [
        f"Ruleset version: {rs.get('version')}",
        f"Empathy pass threshold: {rs.get('empathy_pass_threshold')}/10",
        f"Transfer soft limit: {rs.get('transfer_soft_limit')}; "
        f"auto-fail at transfers >= {rs.get('transfer_auto_fail_at')}",
        f"Auto-fail quality cap: {rs.get('auto_fail_quality_cap')}",
        "",
        "Score EVERY active rule below. Return rule_results with one entry per rule id.",
        "",
    ]
    for r in active_rules(rs):
        lines.append(
            f"- id={r['id']} | {r['label']} | category={r.get('category')} | "
            f"weight={r.get('weight')} | auto_fail={r.get('auto_fail')}\n"
            f"  pass_criteria: {r.get('pass_criteria')}"
        )
    return "\n".join(lines)


def normalize_rule_results(
    raw_results: list[dict[str, Any]] | None,
    ruleset: dict[str, Any] | None = None,
    *,
    transcript: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    rs = ruleset or get_active_ruleset()
    by_id = {str(r.get("rule_id") or r.get("id") or ""): r for r in (raw_results or [])}
    out: list[dict[str, Any]] = []
    for rule in active_rules(rs):
        rid = rule["id"]
        item = by_id.get(rid) or {}
        score = item.get("score_1_to_10")
        if score is not None:
            try:
                score = max(1, min(10, int(round(float(score)))))
            except (TypeError, ValueError):
                score = None
        passed = bool(item.get("passed", False))
        # Empathy: enforce threshold if score present
        if rid == "empathy" and score is not None:
            passed = score >= int(rs.get("empathy_pass_threshold") or 7)

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
                turn_index=turn_index,
            )

        out.append(
            {
                "rule_id": rid,
                "label": rule.get("label") or rid,
                "category": rule.get("category") or "",
                "passed": passed,
                "score_1_to_10": score,
                "evidence": evidence,
                "evidence_timestamp": evidence_ts,
                "evidence_turn_index": turn_index,
                "notes": str(item.get("notes") or "").strip(),
                "auto_fail": bool(rule.get("auto_fail")),
                "weight": float(rule.get("weight") or 1.0),
            }
        )
    return out


def resolve_evidence_anchor(
    transcript: list[dict[str, Any]],
    *,
    evidence: str,
    evidence_timestamp: str = "",
    turn_index: int | None = None,
) -> tuple[int | None, str]:
    """
    Resolve a transcript turn for deep-linking.
    Preference: explicit turn_index → timestamp match → fuzzy evidence text match.
    """
    if not transcript:
        return None, evidence_timestamp

    if turn_index is not None and 0 <= turn_index < len(transcript):
        ts = str(transcript[turn_index].get("timestamp") or evidence_timestamp)
        return turn_index, ts

    # Exact / normalized timestamp match
    if evidence_timestamp:
        needle = evidence_timestamp.strip()
        for i, turn in enumerate(transcript):
            ts = str(turn.get("timestamp") or "").strip()
            if ts == needle or ts.lstrip("0") == needle.lstrip("0"):
                return i, ts or needle

    # Fuzzy quote match against turn text
    quote = _normalize_text(evidence)
    if len(quote) >= 8:
        best_i = None
        best_score = 0
        for i, turn in enumerate(transcript):
            text = _normalize_text(str(turn.get("text") or ""))
            if not text:
                continue
            if quote in text or text in quote:
                return i, str(turn.get("timestamp") or evidence_timestamp)
            # token overlap
            q_tokens = set(quote.split())
            t_tokens = set(text.split())
            if not q_tokens:
                continue
            overlap = len(q_tokens & t_tokens) / max(len(q_tokens), 1)
            if overlap > best_score and overlap >= 0.5:
                best_score = overlap
                best_i = i
        if best_i is not None:
            return best_i, str(transcript[best_i].get("timestamp") or evidence_timestamp)

    return None, evidence_timestamp


def _normalize_text(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def apply_transfer_rules(
    rule_results: list[dict[str, Any]],
    transfer_count: int,
    ruleset: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Override excessive_transfers from counted transfers when available."""
    rs = ruleset or get_active_ruleset()
    soft = int(rs.get("transfer_soft_limit") or 1)
    hard = int(rs.get("transfer_auto_fail_at") or 3)
    out = []
    for r in rule_results:
        if r.get("rule_id") != "excessive_transfers":
            out.append(r)
            continue
        passed = transfer_count <= soft
        # Still mark auto_fail trigger when over hard limit (rule.auto_fail already true)
        notes = r.get("notes") or ""
        evidence = r.get("evidence") or f"transfer_count={transfer_count}"
        out.append(
            {
                **r,
                "passed": passed,
                "evidence": evidence,
                "notes": notes
                or (
                    f"Soft limit {soft}; auto-fail at {hard}. Observed {transfer_count}."
                ),
                "score_1_to_10": max(1, min(10, 10 - 3 * max(0, transfer_count - soft))),
            }
        )
    return out


def compute_scores(
    rule_results: list[dict[str, Any]],
    ruleset: dict[str, Any] | None = None,
    *,
    transfer_count: int | None = None,
) -> dict[str, Any]:
    """
    Compute quality_score, empathy score, auto-fail flags from rule_results.
    """
    rs = ruleset or get_active_ruleset()
    results = list(rule_results)
    if transfer_count is not None:
        results = apply_transfer_rules(results, transfer_count, rs)

    hard = int(rs.get("transfer_auto_fail_at") or 3)
    auto_fail_rules: list[str] = []
    for r in results:
        if not r.get("passed") and r.get("auto_fail"):
            auto_fail_rules.append(r["rule_id"])
        if (
            r.get("rule_id") == "excessive_transfers"
            and transfer_count is not None
            and transfer_count >= hard
        ):
            if "excessive_transfers" not in auto_fail_rules:
                auto_fail_rules.append("excessive_transfers")

    # Weighted quality: passed rules contribute full weight, failed contribute 0
    total_w = sum(float(r.get("weight") or 1.0) for r in results) or 1.0
    earned = sum(float(r.get("weight") or 1.0) for r in results if r.get("passed"))
    quality = int(round(1 + 9 * (earned / total_w)))  # map 0..1 -> 1..10
    quality = max(1, min(10, quality))

    auto_failed = bool(auto_fail_rules)
    cap = int(rs.get("auto_fail_quality_cap") or 4)
    if auto_failed:
        quality = min(quality, cap)

    empathy = 5
    name_stated = False
    fcr = False
    for r in results:
        if r.get("rule_id") == "empathy":
            empathy = int(r.get("score_1_to_10") or (8 if r.get("passed") else 4))
        if r.get("rule_id") == "name_stated":
            name_stated = bool(r.get("passed"))
        if r.get("rule_id") == "fcr":
            fcr = bool(r.get("passed"))

    return {
        "rule_results": results,
        "ruleset_version": rs.get("version"),
        "quality_score": quality,
        "ai_empathy_score": max(1, min(10, empathy)),
        "ai_name_stated": name_stated,
        "fcr": fcr,
        "auto_failed": auto_failed,
        "auto_fail_rules": auto_fail_rules,
    }


def seed_firestore(ruleset: dict[str, Any] | None = None, *, force: bool = False) -> str:
    """Write ruleset to qa_rules/current (and versioned doc). Returns doc path."""
    from src import firestore_db as db

    rs = ruleset or load_rules_from_file()
    return db.seed_qa_rules(rs, force=force)
