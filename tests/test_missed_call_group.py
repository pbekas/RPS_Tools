"""Unit tests for Call Group blast false-miss suppression."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from src.missed_call_group import (
    build_answered_elsewhere_index,
    effective_is_missed,
    find_answered_elsewhere_sibling,
    phone_key,
)


class PhoneKeyTest(unittest.TestCase):
    def test_nanp_last_10(self) -> None:
        self.assertEqual(phone_key("+17752304697"), "7752304697")
        self.assertEqual(phone_key("(775) 230-4697"), "7752304697")


class AnsweredElsewhereTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t0 = datetime(2026, 8, 20, 21, 16, 10, tzinfo=timezone.utc)

    def _row(
        self,
        log_id: str,
        *,
        to: str,
        result: str,
        start: datetime | None = None,
        frm: str = "7752304697",
        direction: str = "Inbound",
    ) -> dict:
        return {
            "id": log_id,
            "direction": direction,
            "from_number": frm,
            "to_number": to,
            "result": result,
            "start": start or self.t0,
        }

    def test_finds_answered_sibling_in_blast_group(self) -> None:
        answered = self._row("ans-9004", to="9004", result="Answered")
        missed_3101 = self._row(
            "miss-3101",
            to="3101",
            result="Missed",
            start=self.t0 + timedelta(seconds=5),
        )
        missed_3100 = self._row(
            "miss-3100",
            to="3100",
            result="Missed",
            start=self.t0 + timedelta(seconds=8),
        )
        self.assertEqual(
            find_answered_elsewhere_sibling(missed_3101, [answered, missed_3100]),
            "ans-9004",
        )
        self.assertEqual(
            find_answered_elsewhere_sibling(missed_3100, [answered, missed_3101]),
            "ans-9004",
        )

    def test_batch_index(self) -> None:
        rows = [
            self._row("ans-9004", to="9004", result="Answered"),
            self._row(
                "miss-3101",
                to="3101",
                result="Missed",
                start=self.t0 + timedelta(seconds=5),
            ),
            self._row(
                "miss-3100",
                to="3100",
                result="Missed",
                start=self.t0 + timedelta(seconds=8),
            ),
        ]
        idx = build_answered_elsewhere_index(rows)
        self.assertEqual(idx.get("miss-3101"), "ans-9004")
        self.assertEqual(idx.get("miss-3100"), "ans-9004")
        self.assertNotIn("ans-9004", idx)

    def test_no_sibling_when_truly_missed(self) -> None:
        missed = self._row("miss-only", to="3101", result="Missed")
        other_missed = self._row(
            "miss-other",
            to="3100",
            result="Missed",
            start=self.t0 + timedelta(seconds=3),
        )
        self.assertIsNone(
            find_answered_elsewhere_sibling(missed, [other_missed])
        )

    def test_outside_window_not_matched(self) -> None:
        answered = self._row("ans", to="9004", result="Answered")
        late_miss = self._row(
            "late",
            to="3101",
            result="Missed",
            start=self.t0 + timedelta(minutes=5),
        )
        self.assertIsNone(
            find_answered_elsewhere_sibling(
                late_miss, [answered], window_seconds=90
            )
        )

    def test_different_caller_not_matched(self) -> None:
        answered = self._row("ans", to="9004", result="Answered", frm="7025551212")
        missed = self._row("miss", to="3101", result="Missed", frm="7752304697")
        self.assertIsNone(find_answered_elsewhere_sibling(missed, [answered]))

    def test_outbound_skipped(self) -> None:
        answered = self._row("ans", to="9004", result="Answered")
        missed = self._row(
            "miss", to="3101", result="Missed", direction="Outbound"
        )
        self.assertIsNone(find_answered_elsewhere_sibling(missed, [answered]))

    def test_effective_is_missed(self) -> None:
        self.assertFalse(
            effective_is_missed(
                result="Missed",
                is_missed=True,
                answered_elsewhere=True,
                answered_elsewhere_log_id="ans-1",
            )
        )
        self.assertTrue(effective_is_missed(result="Missed", is_missed=True))
        self.assertFalse(effective_is_missed(result="Answered", is_missed=False))


if __name__ == "__main__":
    unittest.main()
