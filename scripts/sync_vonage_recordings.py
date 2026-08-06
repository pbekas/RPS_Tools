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
    parser.add_argument("--days", type=int, default=7, help="How many days back to sync")
    parser.add_argument("--max", type=int, default=100, help="Max recordings to ingest")
    parser.add_argument("--extension", type=str, default="", help="Filter by extension")
    args = parser.parse_args()

    if args.test:
        print(json.dumps(test_connection(), indent=2))
        return

    summary = sync_company_recordings(
        days_back=args.days,
        max_recordings=args.max,
        extension=args.extension.strip() or None,
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
