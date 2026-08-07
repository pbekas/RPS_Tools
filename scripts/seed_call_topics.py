#!/usr/bin/env python3
"""Seed call_topics/current in Firestore from docs/call_topics_v1.json.

Usage:
  python scripts/seed_call_topics.py
  python scripts/seed_call_topics.py --force
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.call_topics import load_topics_from_file, seed_firestore


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed call topics into Firestore")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite call_topics/current even if it already exists",
    )
    args = parser.parse_args()
    ts = load_topics_from_file()
    path = seed_firestore(ts, force=args.force)
    print(
        f"Seeded {path} version={ts.get('version')} "
        f"topics={len(ts.get('topics') or [])}"
    )


if __name__ == "__main__":
    main()
