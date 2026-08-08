"""Unit tests for missed-call Twilio SMS gating (no network)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from src.twilio_sms import (
    is_customedico_dialed_number,
    is_qualifying_missed_inbound,
    is_smsable_number,
    normalize_e164,
    render_missed_sms_body,
    resolve_missed_sms_from_number,
    resolve_missed_sms_template,
    should_send_missed_call_sms,
)


class NormalizeE164Test(unittest.TestCase):
    def test_nanp_10_digit(self) -> None:
        self.assertEqual(normalize_e164("(310) 555-1212"), "+13105551212")

    def test_already_e164(self) -> None:
        self.assertEqual(normalize_e164("+13105551212"), "+13105551212")

    def test_extension_rejected(self) -> None:
        self.assertIsNone(normalize_e164("1234"))
        self.assertFalse(is_smsable_number(normalize_e164("1234")))


class QualifyingMissedInboundTest(unittest.TestCase):
    def test_inbound_missed(self) -> None:
        self.assertTrue(
            is_qualifying_missed_inbound(
                direction="Inbound", result="Missed", is_missed=True
            )
        )

    def test_inbound_voicemail(self) -> None:
        self.assertTrue(
            is_qualifying_missed_inbound(direction="inbound", result="Voicemail")
        )

    def test_inbound_abandoned(self) -> None:
        self.assertTrue(
            is_qualifying_missed_inbound(direction="inbound", result="Abandoned")
        )

    def test_answered_skipped(self) -> None:
        self.assertFalse(
            is_qualifying_missed_inbound(direction="inbound", result="Answered")
        )

    def test_outbound_missed_skipped(self) -> None:
        self.assertFalse(
            is_qualifying_missed_inbound(
                direction="Outbound", result="Missed", is_missed=True
            )
        )


class ShouldSendMissedCallSmsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 8, 7, 20, 0, tzinfo=timezone.utc)
        self.recent = self.now - timedelta(minutes=15)

    def test_sends_for_recent_inbound_missed(self) -> None:
        ok, reason = should_send_missed_call_sms(
            direction="inbound",
            result="No Answer",
            from_number="3105551212",
            start=self.recent,
            is_missed=True,
            enabled=True,
            credentials_ready=True,
            max_age_minutes=120,
            now=self.now,
        )
        self.assertTrue(ok)
        self.assertEqual(reason, "ok")

    def test_disabled(self) -> None:
        ok, reason = should_send_missed_call_sms(
            direction="inbound",
            result="Missed",
            from_number="+13105551212",
            start=self.recent,
            enabled=False,
            credentials_ready=True,
            now=self.now,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "disabled")

    def test_too_old(self) -> None:
        old = self.now - timedelta(hours=5)
        ok, reason = should_send_missed_call_sms(
            direction="inbound",
            result="Missed",
            from_number="+13105551212",
            start=old,
            enabled=True,
            credentials_ready=True,
            max_age_minutes=120,
            now=self.now,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "too_old_or_missing_start")

    def test_invalid_number(self) -> None:
        ok, reason = should_send_missed_call_sms(
            direction="inbound",
            result="Missed",
            from_number="101",
            start=self.recent,
            enabled=True,
            credentials_ready=True,
            now=self.now,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "invalid_from_number")


class RenderBodyTest(unittest.TestCase):
    def test_main_line_placeholder(self) -> None:
        body = render_missed_sms_body(
            "Call us at {main_line}.",
            main_line="(800) 555-0100",
        )
        self.assertIn("(800) 555-0100", body)

    def test_default_message(self) -> None:
        body = render_missed_sms_body(None)
        self.assertIn("Thanks for calling Relevium Pain Specialists", body)
        self.assertIn("reply here", body)


class CustomedicoLineTest(unittest.TestCase):
    def test_detects_did_formats(self) -> None:
        self.assertTrue(is_customedico_dialed_number("(480) 626-4810"))
        self.assertTrue(is_customedico_dialed_number("+14806264810"))
        self.assertTrue(is_customedico_dialed_number("4806264810"))
        self.assertTrue(is_customedico_dialed_number("45000"))
        self.assertFalse(is_customedico_dialed_number("17029049704"))
        self.assertFalse(is_customedico_dialed_number("10001"))

    def test_resolves_customedico_template(self) -> None:
        body = resolve_missed_sms_template(to_number="4806264810")
        self.assertIn("Customedico", body)
        self.assertNotIn("Relevium", body)

    def test_resolves_customedico_via_extension(self) -> None:
        body = resolve_missed_sms_template(destination_extension="45000")
        self.assertIn("Customedico", body)

    def test_resolves_relevium_default(self) -> None:
        body = resolve_missed_sms_template(to_number="17029049704")
        self.assertIn("Relevium Pain Specialists", body)

    def test_customedico_from_number(self) -> None:
        self.assertEqual(
            resolve_missed_sms_from_number(
                to_number="4806264810",
                default_from="+15555550100",
            ),
            "+17028197515",
        )
        self.assertEqual(
            resolve_missed_sms_from_number(
                destination_extension="45000",
                default_from="+15555550100",
            ),
            "+17028197515",
        )

    def test_relevium_from_number(self) -> None:
        self.assertEqual(
            resolve_missed_sms_from_number(
                to_number="17029049704",
                default_from="+15555550100",
            ),
            "+15555550100",
        )


if __name__ == "__main__":
    unittest.main()
