from __future__ import annotations

import unittest
from datetime import date, datetime, timezone
from decimal import Decimal

from scripts.backfill_firestore_to_postgres import Report, email, json_value, utc


class FirestorePostgresBackfillUnitTest(unittest.TestCase):
    def test_json_value_preserves_nested_data_in_json_compatible_form(self) -> None:
        instant = datetime(2026, 8, 7, 12, 30, tzinfo=timezone.utc)
        self.assertEqual(
            json_value(
                {
                    "rule_results": [{"score": Decimal("8.5"), "at": instant}],
                    "day": date(2026, 8, 7),
                }
            ),
            {
                "rule_results": [{"score": 8.5, "at": instant.isoformat()}],
                "day": "2026-08-07",
            },
        )

    def test_reference_normalization(self) -> None:
        self.assertEqual(email(" Agent@Example.COM "), "agent@example.com")
        self.assertIsNone(email(""))
        self.assertIsNone(email(None))

    def test_timestamp_normalization(self) -> None:
        self.assertEqual(
            utc("2026-08-07T12:30:00Z"),
            datetime(2026, 8, 7, 12, 30, tzinfo=timezone.utc),
        )
        naive = datetime(2026, 8, 7, 12, 30)
        self.assertEqual(utc(naive), naive.replace(tzinfo=timezone.utc))

    def test_report_distinguishes_upserts_skips_and_errors(self) -> None:
        report = Report()
        report.done("calls")
        report.skip("feedback", "orphan")
        report.error("calls", "bad-call", ValueError("invalid"))
        self.assertEqual(report.counts["calls.upserted"], 1)
        self.assertEqual(report.counts["feedback.skipped"], 1)
        self.assertEqual(report.counts["calls.errors"], 1)
        self.assertEqual(len(report.errors), 2)


if __name__ == "__main__":
    unittest.main()
