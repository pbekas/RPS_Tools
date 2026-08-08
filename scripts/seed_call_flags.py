#!/usr/bin/env python3
"""Seed call_flags/current in Firestore from docs/call_flags_v1.json.

Usage:
  python scripts/seed_call_flags.py
  python scripts/seed_call_flags.py --force
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.call_flags import load_flags_from_file, seed_firestore


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed critical call flags into Firestore")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite call_flags/current even if it already exists",
    )
    args = parser.parse_args()
    fs = load_flags_from_file()
    path = seed_firestore(fs, force=args.force)
    print(
        f"Seeded {path} version={fs.get('version')} "
        f"flags={len(fs.get('flags') or [])}"
    )


if __name__ == "__main__":
    main()
