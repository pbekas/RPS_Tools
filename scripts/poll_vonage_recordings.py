#!/usr/bin/env python3
"""Near-real-time poller for Vonage VBC company call recordings.

VBC does not push “recording ready” events for company recordings.
This process polls for new recordings and queues them into Transcribe + Bedrock QA.

Usage:
  # Continuous (default: every 60s, last 30 minutes)
  python scripts/poll_vonage_recordings.py

  # One-shot
  python scripts/poll_vonage_recordings.py --once --minutes 30

  # Faster loop while testing
  python scripts/poll_vonage_recordings.py --interval 30 --minutes 20 --max 10
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.vonage_poller import poller_status, run_sync_cycle, start_poller, stop_poller

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll VBC recordings into Call QA")
    parser.add_argument("--once", action="store_true", help="Run a single sync cycle and exit")
    parser.add_argument("--interval", type=int, default=300, help="Seconds between polls (default 5 min)")
    parser.add_argument("--minutes", type=int, default=30, help="Lookback window in minutes")
    parser.add_argument("--max", type=int, default=25, help="Max recordings per cycle")
    parser.add_argument(
        "--inline",
        action="store_true",
        help="Process QA inline (slower). Default queues background worker.",
    )
    args = parser.parse_args()

    if args.once:
        summary = run_sync_cycle(
            lookback_minutes=args.minutes,
            max_per_cycle=args.max,
            process_now=args.inline,
        )
        print(json.dumps(summary, indent=2, default=str))
        return

    start_poller(
        interval_seconds=args.interval,
        lookback_minutes=args.minutes,
        max_per_cycle=args.max,
    )
    print(
        json.dumps(
            {
                "status": "polling",
                **poller_status(),
                "hint": "Ctrl+C to stop",
            },
            indent=2,
        )
    )

    def _stop(*_args: object) -> None:
        stop_poller()
        sys.exit(0)

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    while True:
        time.sleep(5)
        status = poller_status()
        if not status.get("running"):
            break


if __name__ == "__main__":
    main()
