#!/usr/bin/env python3
"""Import & map AI-detected agents onto {name}@releviumpain.com users.

Usage:
  python scripts/import_agents.py              # list candidates
  python scripts/import_agents.py --apply      # create users + remap calls
  python scripts/import_agents.py --apply --name Diana --email diana@releviumpain.com
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.agent_identity import discover_unmapped_agents, import_and_map_agent


def main() -> None:
    parser = argparse.ArgumentParser(description="Import/map call agents to users")
    parser.add_argument("--apply", action="store_true", help="Create users and remap calls")
    parser.add_argument("--name", type=str, default="", help="Only import this agent name")
    parser.add_argument("--email", type=str, default="", help="Override email for --name")
    args = parser.parse_args()

    rows = discover_unmapped_agents()
    if args.name:
        needle = args.name.strip().lower()
        rows = [r for r in rows if r["agent_name"].lower() == needle]

    if not args.apply:
        print(json.dumps(rows, indent=2))
        return

    results = []
    for row in rows:
        if row.get("mapped") and not args.name:
            continue
        name = row["agent_name"]
        email = args.email.strip().lower() if args.name and args.email else row["suggested_email"]
        try:
            out = import_and_map_agent(agent_name=name, email=email)
            results.append({"ok": True, **{k: out[k] for k in ("email", "name", "remapped_calls")}})
            print(f"OK  {name} → {out['email']} ({out['remapped_calls']} calls)")
        except Exception as exc:  # noqa: BLE001
            results.append({"ok": False, "name": name, "error": str(exc)})
            print(f"ERR {name}: {exc}")
    print(json.dumps({"imported": results}, indent=2))


if __name__ == "__main__":
    main()
