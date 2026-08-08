#!/usr/bin/env python3
"""Sync Vonage extensions (Provisioning + CDR harvest) and map onto users.

Usage:
  python scripts/sync_vonage_extensions.py
  python scripts/sync_vonage_extensions.py --no-auto-map
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.extension_sync import sync_extensions


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Vonage extensions → users")
    parser.add_argument(
        "--no-auto-map",
        action="store_true",
        help="Upsert catalog only; do not stamp users.extension from VBC email",
    )
    args = parser.parse_args()
    summary = sync_extensions(auto_map=not args.no_auto_map)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
