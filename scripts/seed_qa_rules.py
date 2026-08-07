#!/usr/bin/env python3
"""Seed qa_rules/current in Firestore from docs/qa_rules_v1.json.

Usage:
  python scripts/seed_qa_rules.py
  python scripts/seed_qa_rules.py --force
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.qa_rules import load_rules_from_file, seed_firestore


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed QA rules into Firestore")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite qa_rules/current even if it already exists",
    )
    args = parser.parse_args()
    rs = load_rules_from_file()
    path = seed_firestore(rs, force=args.force)
    print(f"Seeded {path} version={rs.get('version')} rules={len(rs.get('rules') or [])}")


if __name__ == "__main__":
    main()
