#!/usr/bin/env python3
"""Sync Vonage VBC Reports call-logs (CDRs) into Firestore.

Usage:
  python scripts/sync_vonage_call_logs.py --minutes 60
  python scripts/sync_vonage_call_logs.py --days 7 --max 500
  python scripts/sync_vonage_call_logs.py --test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.cdr_sync import sync_call_logs, test_reports_connection


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull VBC Reports call-logs (CDRs)")
    parser.add_argument(
        "--test",
        action="store_true",
        help="Test Reports API connection only",
    )
    parser.add_argument("--days", type=int, default=None, help="How many days back")
    parser.add_argument("--hours", type=int, default=None, help="How many hours back")
    parser.add_argument(
        "--minutes",
        type=int,
        default=None,
        help="How many minutes back (near-real-time window)",
    )
    parser.add_argument("--max", type=int, default=500, help="Max call logs to upsert")
    parser.add_argument(
        "--no-match",
        action="store_true",
        help="Skip linking CDRs to QA calls",
    )
    args = parser.parse_args()

    if args.test:
        print(json.dumps(test_reports_connection(), indent=2, default=str))
        return

    kwargs: dict = {
        "max_logs": args.max,
        "match_calls": not args.no_match,
    }
    if args.minutes is not None:
        kwargs["minutes_back"] = args.minutes
    elif args.hours is not None:
        kwargs["hours_back"] = args.hours
    else:
        kwargs["days_back"] = args.days if args.days is not None else 7

    summary = sync_call_logs(**kwargs)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
