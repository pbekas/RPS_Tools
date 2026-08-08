"""Unit tests for missed-call Google Chat formatting (no network)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from src.notify import (
    _caller_name_from_missed_log,
    format_missed_call_gchat_text,
    is_voicemail_result,
    transcript_to_plain_text,
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
        self.assertIn("Voicemail: No VM Detected", text)
        self.assertIn("Patient SMS: sent", text)
        self.assertIn("Date / time:", text)

    def test_includes_voicemail_transcript(self) -> None:
        text = format_missed_call_gchat_text(
            from_number="+16303633316",
            caller_name="Jane Doe",
            start=datetime(2026, 8, 8, 15, 30, tzinfo=timezone.utc),
            result="Voicemail",
            voicemail_status="transcript",
            voicemail_transcript="Please call me back about my appointment.",
        )
        self.assertIn("Voicemail transcript:", text)
        self.assertIn("Please call me back about my appointment.", text)
        self.assertNotIn("No VM Detected", text)

    def test_voicemail_unavailable(self) -> None:
        text = format_missed_call_gchat_text(
            from_number="+16303633316",
            result="Voicemail",
            voicemail_status="unavailable",
        )
        self.assertIn("Voicemail: detected, but no transcript available", text)

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

    def test_is_voicemail_result(self) -> None:
        self.assertTrue(is_voicemail_result("Voicemail"))
        self.assertTrue(is_voicemail_result("Left Voice Mail"))
        self.assertFalse(is_voicemail_result("Missed"))

    def test_transcript_to_plain_text(self) -> None:
        text = transcript_to_plain_text(
            [
                {"speaker": "System", "text": "Thanks for calling"},
                {"speaker": "Caller", "text": "Please call me back"},
            ]
        )
        self.assertIn("Please call me back", text)
        self.assertNotIn("Thanks for calling", text)


if __name__ == "__main__":
    unittest.main()
