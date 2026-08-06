#!/usr/bin/env python3
"""CLI: run weekly coaching for one agent or all agents.

Usage:
  python scripts/run_weekly_coaching.py --all
  python scripts/run_weekly_coaching.py --agent jane@releviumpain.com
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.metrics import run_weekly_coaching_all_agents, run_weekly_coaching_for_agent


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate rolling AI coaching reports")
    parser.add_argument("--all", action="store_true", help="All Agent-role users")
    parser.add_argument("--agent", type=str, help="Single agent email")
    args = parser.parse_args()

    if args.all:
        results = run_weekly_coaching_all_agents()
        for email, report in results.items():
            print(f"\n=== {email} ===\n{report}\n")
        return

    if args.agent:
        report = run_weekly_coaching_for_agent(args.agent)
        print(report)
        return

    parser.error("Specify --all or --agent EMAIL")


if __name__ == "__main__":
    main()
