#!/usr/bin/env python3
"""Sync Vonage VBC company call recordings into the QA queue.

Usage:
  python scripts/sync_vonage_recordings.py --days 7 --max 50
  python scripts/sync_vonage_recordings.py --test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.vonage_sync import sync_company_recordings, test_connection


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull VBC call recordings")
    parser.add_argument("--test", action="store_true", help="Test API connection only")
    parser.add_argument("--days", type=int, default=None, help="How many days back to sync")
    parser.add_argument("--hours", type=int, default=None, help="How many hours back to sync")
    parser.add_argument(
        "--minutes",
        type=int,
        default=None,
        help="How many minutes back to sync (near-real-time window)",
    )
    parser.add_argument("--max", type=int, default=100, help="Max recordings to ingest")
    parser.add_argument("--extension", type=str, default="", help="Filter by extension")
    parser.add_argument(
        "--background",
        action="store_true",
        help="Queue QA in background worker instead of processing inline",
    )
    args = parser.parse_args()

    if args.test:
        print(json.dumps(test_connection(), indent=2))
        return

    kwargs = {
        "max_recordings": args.max,
        "extension": args.extension.strip() or None,
        "process_now": not args.background,
    }
    if args.minutes is not None:
        kwargs["minutes_back"] = args.minutes
    elif args.hours is not None:
        kwargs["hours_back"] = args.hours
    else:
        kwargs["days_back"] = args.days if args.days is not None else 7

    summary = sync_company_recordings(**kwargs)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
