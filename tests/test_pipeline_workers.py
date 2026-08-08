"""Unit tests for QA worker pool sizing."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from src.pipeline import qa_worker_count


class QaWorkerCountTest(unittest.TestCase):
    def test_default_is_four(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QA_WORKER_COUNT", None)
            self.assertEqual(qa_worker_count(), 4)

    def test_respects_env(self) -> None:
        with mock.patch.dict(os.environ, {"QA_WORKER_COUNT": "6"}):
            self.assertEqual(qa_worker_count(), 6)

    def test_clamps_range(self) -> None:
        with mock.patch.dict(os.environ, {"QA_WORKER_COUNT": "0"}):
            self.assertEqual(qa_worker_count(), 1)
        with mock.patch.dict(os.environ, {"QA_WORKER_COUNT": "99"}):
            self.assertEqual(qa_worker_count(), 16)

    def test_invalid_falls_back(self) -> None:
        with mock.patch.dict(os.environ, {"QA_WORKER_COUNT": "nope"}):
            self.assertEqual(qa_worker_count(), 4)


if __name__ == "__main__":
    unittest.main()
