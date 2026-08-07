#!/usr/bin/env python3
"""Re-analyze completed calls with the current QA ruleset (transcript only).

Usage:
  python scripts/reanalyze_calls.py
  python scripts/reanalyze_calls.py --limit 10
  python scripts/reanalyze_calls.py --only-missing
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.bedrock_analyst import analyze_transcript
from src import firestore_db as db
from src.agent_identity import resolve_or_create_agent
from src.qa_rules import get_active_ruleset


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-score calls against current QA rules")
    parser.add_argument("--limit", type=int, default=200, help="Max calls to process")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only calls that lack rule_results",
    )
    args = parser.parse_args()

    ruleset = get_active_ruleset()
    print(f"Ruleset {ruleset.get('version')} · {len(ruleset.get('rules') or [])} rules")

    calls = db.list_calls(limit=args.limit, status="complete")
    ok = skip = err = 0
    for i, call in enumerate(calls, 1):
        call_id = call.get("id")
        transcript = call.get("transcript") or []
        if not call_id:
            skip += 1
            continue
        if args.only_missing and call.get("rule_results"):
            skip += 1
            continue
        if not transcript:
            print(f"[{i}/{len(calls)}] SKIP {call_id} — no transcript")
            skip += 1
            continue
        try:
            print(
                f"[{i}/{len(calls)}] Scoring {call_id} · "
                f"{call.get('agent_name')} · {call.get('topic')} …",
                flush=True,
            )
            scored = analyze_transcript(
                transcript,
                duration_seconds=call.get("duration_seconds"),
                original_filename=call.get("original_filename"),
                transfer_count_hint=call.get("transfer_count"),
            )
            if not scored.get("transcript"):
                scored["transcript"] = transcript

            existing_email = (call.get("agent_email") or "").strip().lower()
            updates = {
                k: v for k, v in scored.items() if k != "recording_storage_uri"
            }
            if existing_email and not existing_email.startswith("unmapped."):
                # Preserve manager-mapped Workspace identity
                updates.pop("agent_email", None)
                updates.pop("agent_name", None)
            else:
                email, name = resolve_or_create_agent(
                    scored.get("agent_name") or call.get("agent_name") or ""
                )
                updates["agent_email"] = email
                updates["agent_name"] = name

            db.update_call(call_id, updates)
            fails = [
                r.get("rule_id")
                for r in (scored.get("rule_results") or [])
                if not r.get("passed")
            ]
            print(
                f"  → Q{scored.get('quality_score')} E{scored.get('ai_empathy_score')} "
                f"auto={scored.get('auto_failed')} fails={fails}"
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001
            err += 1
            print(f"  ERROR: {exc}")
            try:
                db.update_call(call_id, {"error_message": f"reanalyze: {exc}"})
            except Exception:
                pass

    print(f"\nDone. ok={ok} skip={skip} err={err}")


if __name__ == "__main__":
    main()
