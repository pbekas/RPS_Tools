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

from src import database as db
from src.ops_actions import reanalyze_call
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
            result = reanalyze_call(call_id, send_alerts=True)
            fails = [
                r.get("rule_id")
                for r in (result.get("critical_flags") or [])
                if r.get("triggered") is not False
            ]
            print(
                f"  → Q{result.get('quality_score')} E{result.get('ai_empathy_score')} "
                f"auto={result.get('auto_failed')} critical={fails}"
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
