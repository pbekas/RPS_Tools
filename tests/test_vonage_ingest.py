"""Tests for Vonage recording ingest cap, CDR completeness matching, and backfill timing."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from src.vonage_poller import _backfill_is_due
from src.vonage_sync import (
    is_recorded_answered_unmatched,
    match_recording_for_cdr,
    sync_company_recordings,
)
from src.vonage_vbc import VBCRecording, _parse_recording
from src.vonage_reports import VBCCallLog
from src.cdr_sync import _match_call


def _rec(
    recording_id: str,
    *,
    call_id: str | None = None,
    duration_ms: int = 90_000,
    start: datetime | None = None,
    extension: str | None = "9004",
    caller_id: str | None = "7752304697",
    dnis: str | None = "17755550100",
) -> VBCRecording:
    return VBCRecording(
        recording_id=recording_id,
        call_id=call_id,
        call_direction="Inbound",
        caller_id=caller_id,
        cnam=None,
        dnis=dnis,
        extension=extension,
        duration_ms=duration_ms,
        start=start,
        end=None,
        download_url=f"https://example.test/{recording_id}",
        raw={},
    )


class RecordedAnsweredUnmatchedTest(unittest.TestCase):
    def test_requires_recorded_answered_unmatched_and_long_enough(self) -> None:
        self.assertTrue(
            is_recorded_answered_unmatched(
                {
                    "id": "cdr-1",
                    "recorded": True,
                    "result": "Answered",
                    "is_missed": False,
                    "length_seconds": 90,
                    "matched_call_id": None,
                }
            )
        )

    def test_skips_already_matched(self) -> None:
        self.assertFalse(
            is_recorded_answered_unmatched(
                {
                    "recorded": True,
                    "result": "Answered",
                    "length_seconds": 90,
                    "matched_call_id": "call-1",
                }
            )
        )

    def test_skips_unrecorded_or_short_or_missed(self) -> None:
        base = {
            "recorded": True,
            "result": "Answered",
            "is_missed": False,
            "length_seconds": 90,
        }
        self.assertFalse(is_recorded_answered_unmatched({**base, "recorded": False}))
        self.assertFalse(is_recorded_answered_unmatched({**base, "length_seconds": 20}))
        self.assertFalse(
            is_recorded_answered_unmatched({**base, "result": "Missed", "is_missed": True})
        )


class MatchRecordingForCdrTest(unittest.TestCase):
    def setUp(self) -> None:
        self.t0 = datetime(2026, 8, 27, 18, 0, tzinfo=timezone.utc)

    def test_prefers_call_id_match(self) -> None:
        recs = [
            _rec("r-other", call_id="other", start=self.t0),
            _rec("r-hit", call_id="cdr-1", start=self.t0 + timedelta(seconds=5)),
        ]
        matched = match_recording_for_cdr(
            {"id": "cdr-1", "start": self.t0, "from_number": "7752304697"},
            recs,
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched.recording_id, "r-hit")

    def test_falls_back_to_time_and_extension(self) -> None:
        recs = [
            _rec(
                "r-time",
                call_id=None,
                start=self.t0 + timedelta(seconds=8),
                extension="9004",
            )
        ]
        matched = match_recording_for_cdr(
            {
                "id": "cdr-1",
                "start": self.t0,
                "destination_extension": "9004",
                "from_number": "7752304697",
            },
            recs,
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched.recording_id, "r-time")

    def test_falls_back_to_time_and_extension_array(self) -> None:
        rec = _rec(
            "r-time",
            call_id=None,
            start=self.t0 + timedelta(seconds=8),
            extension=None,
        )
        rec.extensions = ["3101"]
        rec.extension = None
        matched = match_recording_for_cdr(
            {
                "id": "cdr-1",
                "start": self.t0,
                "destination_extension": "3101",
                "from_number": "5551112222",
            },
            [rec],
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched.recording_id, "r-time")

    def test_ignores_recordings_outside_window(self) -> None:
        recs = [
            _rec(
                "r-late",
                call_id=None,
                start=self.t0 + timedelta(minutes=10),
                extension="9004",
            )
        ]
        self.assertIsNone(
            match_recording_for_cdr(
                {
                    "id": "cdr-1",
                    "start": self.t0,
                    "destination_extension": "9004",
                },
                recs,
            )
        )


class IngestCapTest(unittest.TestCase):
    def test_existing_recordings_do_not_count_toward_cap(self) -> None:
        existing = [_rec(f"old-{i}") for i in range(8)]
        new = [_rec("new-1"), _rec("new-2"), _rec("new-3")]
        client = MagicMock()
        client.iter_company_recordings.return_value = iter(existing + new)

        def _existing(recording_id: str):
            if str(recording_id).startswith("old-"):
                return {"id": f"call-{recording_id}"}
            return None

        with (
            patch("src.vonage_sync.VonageVBCClient", return_value=client),
            patch(
                "src.vonage_sync.find_existing_by_vonage_recording_id",
                side_effect=_existing,
            ),
            patch("src.vonage_sync._attach_extension_to_existing"),
            patch("src.vonage_sync.ingest_recording", side_effect=["c1", "c2"]) as ingest,
        ):
            summary = sync_company_recordings(
                minutes_back=30,
                max_recordings=2,
                process_now=False,
            )

        self.assertEqual(summary["listed"], 11)
        self.assertEqual(summary["skipped_existing"], 8)
        self.assertEqual(summary["queued"], 2)
        self.assertTrue(summary["capped"])
        self.assertEqual(ingest.call_count, 2)
        self.assertEqual(summary["call_ids"], ["c1", "c2"])


class BackfillDueTest(unittest.TestCase):
    def test_due_when_never_run(self) -> None:
        self.assertTrue(
            _backfill_is_due(None, interval_hours=24, enabled=True, forced=None)
        )

    def test_respects_force_flags(self) -> None:
        self.assertFalse(
            _backfill_is_due(None, interval_hours=24, enabled=True, forced=False)
        )
        self.assertTrue(
            _backfill_is_due(
                datetime.now(timezone.utc).isoformat(),
                interval_hours=24,
                enabled=True,
                forced=True,
            )
        )

    def test_interval(self) -> None:
        recent = datetime.now(timezone.utc).isoformat()
        self.assertFalse(
            _backfill_is_due(recent, interval_hours=24, enabled=True, forced=None)
        )
        stale = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        self.assertTrue(
            _backfill_is_due(stale, interval_hours=24, enabled=True, forced=None)
        )


class CompletenessIngestTest(unittest.TestCase):
    def test_ingests_unmatched_recorded_cdr_and_stamps_match(self) -> None:
        start = datetime.now(timezone.utc) - timedelta(minutes=20)
        log = {
            "id": "cdr-9",
            "recorded": True,
            "result": "Answered",
            "is_missed": False,
            "length_seconds": 120,
            "matched_call_id": None,
            "start": start,
            "from_number": "7752304697",
            "destination_extension": "9004",
        }
        rec = _rec("r-9", call_id="cdr-9", start=start)
        client = MagicMock()
        client.iter_company_recordings.return_value = iter([rec])
        settings = MagicMock()
        settings.database_configured = True

        with (
            patch("src.vonage_sync.get_settings", return_value=settings),
            patch("src.vonage_sync.db") as mock_db,
            patch("src.vonage_sync.VonageVBCClient", return_value=client),
            patch(
                "src.vonage_sync.find_existing_by_vonage_recording_id",
                return_value=None,
            ),
            patch("src.vonage_sync.ingest_recording", return_value="qa-9") as ingest,
        ):
            mock_db.list_call_logs.return_value = [log]
            from src.vonage_sync import ingest_missing_recorded_cdrs

            summary = ingest_missing_recorded_cdrs(hours_back=6, max_recordings=10)

        self.assertEqual(summary["candidates"], 1)
        self.assertEqual(summary["queued"], 1)
        ingest.assert_called_once()
        mock_db.upsert_call_log.assert_called_once_with(
            {"id": "cdr-9", "matched_call_id": "qa-9"}
        )


class ParseRecordingExtensionsTest(unittest.TestCase):
    def test_reads_extensions_array_not_singular_field(self) -> None:
        rec = _parse_recording(
            {
                "id": "rec-1",
                "call_id": "uuid-1",
                "caller_id": "7752304697",
                "dnis": "17755550100",
                "extensions": [3101],
                "duration": 90_000,
                "start": "2026-08-27T18:00:00Z",
            }
        )
        self.assertEqual(rec.extension, "3101")
        self.assertEqual(rec.extensions, ["3101"])

    def test_reads_singular_extension_fallback(self) -> None:
        rec = _parse_recording(
            {
                "id": "rec-2",
                "extension": "9004",
                "duration": 60_000,
            }
        )
        self.assertEqual(rec.extension, "9004")
        self.assertEqual(rec.extensions, ["9004"])


class MatchCallByExtensionTest(unittest.TestCase):
    def test_matches_qa_call_on_vonage_extension(self) -> None:
        start = datetime(2026, 8, 27, 18, 0, tzinfo=timezone.utc)
        log = VBCCallLog(
            log_id="cdr-1",
            direction="Inbound",
            from_number="5550001111",
            to_number="17755550100",
            result="Answered",
            recorded=True,
            length_seconds=90,
            start=start,
            end=None,
            source_user=None,
            source_user_full_name=None,
            source_extension=None,
            destination_user=None,
            destination_user_full_name=None,
            destination_extension="3101",
            custom_tag=None,
            in_network=None,
            international=None,
            ring_seconds=None,
            wait_seconds=None,
            queue_seconds=None,
            answered_at=None,
            raw={},
        )
        hit = {
            "id": "qa-1",
            "call_date": start + timedelta(seconds=4),
            "vonage_extension": "3101",
            "vonage_caller_id": "9999999999",
            "vonage_dnis": "18885550100",
        }
        other = {
            "id": "qa-2",
            "call_date": start + timedelta(seconds=4),
            "vonage_extension": "9004",
            "vonage_caller_id": "9999999999",
            "vonage_dnis": "18885550100",
        }
        self.assertEqual(_match_call(log, [other, hit]), "qa-1")


if __name__ == "__main__":
    unittest.main()
