"""Unit tests for missed-call Google Chat formatting (no network)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from src.notify import (
    _caller_name_from_missed_log,
    format_missed_call_gchat_text,
)


class FormatMissedCallGchatTest(unittest.TestCase):
    def test_includes_core_fields(self) -> None:
        start = datetime(2026, 8, 8, 15, 30, tzinfo=timezone.utc)
        text = format_missed_call_gchat_text(
            from_number="+16303633316",
            to_number="+17029049704",
            caller_name="Jane Doe",
            caller_id="+16303633316",
            start=start,
            result="Missed",
            destination_extension="101",
            sms_sent=True,
            log_id="cdr-1",
        )
        self.assertIn("*Missed call*", text)
        self.assertIn("Name: Jane Doe", text)
        self.assertIn("Phone: (630) 363-3316", text)
        self.assertIn("Caller ID: +16303633316", text)
        self.assertIn("Result: Missed", text)
        self.assertIn("Patient SMS: sent", text)
        self.assertIn("Date / time:", text)

    def test_name_from_raw_cnam(self) -> None:
        class Log:
            raw = {"cnam": "Smith, Pat"}
            source_user_full_name = None

        self.assertEqual(_caller_name_from_missed_log(Log()), "Smith, Pat")

    def test_name_from_matched_call(self) -> None:
        class Log:
            raw = {}
            source_user_full_name = None

        name = _caller_name_from_missed_log(
            Log(), matched_call={"patient_name": "Alex Patient"}
        )
        self.assertEqual(name, "Alex Patient")


if __name__ == "__main__":
    unittest.main()
