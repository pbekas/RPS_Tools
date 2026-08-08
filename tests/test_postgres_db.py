from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime, timezone

from src import postgres_db as db
from src.config import get_settings


@unittest.skipUnless(
    os.getenv("TEST_DATABASE_URL"),
    "Set TEST_DATABASE_URL to run PostgreSQL integration tests",
)
class PostgresRepositoryIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["DB_BACKEND"] = "postgres"
        os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
        get_settings.cache_clear()
        cls.suffix = uuid.uuid4().hex[:10]
        cls.agent_email = f"agent-{cls.suffix}@example.com"
        cls.manager_email = f"manager-{cls.suffix}@example.com"
        cls.call_id: str | None = None
        cls.feedback_id: str | None = None
        cls.metric_id = f"{cls.agent_email}_2026_W32"
        cls.call_log_id = f"log-{cls.suffix}"
        cls.rules_version = f"test-{cls.suffix}"

    @classmethod
    def tearDownClass(cls) -> None:
        with db.get_connection() as conn:
            conn.execute("DELETE FROM call_logs WHERE id = %s", (cls.call_log_id,))
            if cls.call_id:
                conn.execute("DELETE FROM calls WHERE id = %s", (cls.call_id,))
            conn.execute("DELETE FROM weekly_metrics WHERE id = %s", (cls.metric_id,))
            conn.execute(
                "DELETE FROM config_sets WHERE kind = 'qa_rules' AND version = %s",
                (cls.rules_version,),
            )
            conn.execute(
                "DELETE FROM alert_state WHERE alert_key = %s",
                (f"test-{cls.suffix}",),
            )
            conn.execute(
                "DELETE FROM users WHERE email IN (%s, %s)",
                (cls.agent_email, cls.manager_email),
            )

    def test_repository_contract(self) -> None:
        agent = db.upsert_user(
            self.agent_email,
            "Test Agent",
            role="Agent",
            provisional=True,
        )
        manager = db.upsert_user(self.manager_email, "Test Manager", role="Admin")
        self.assertEqual(agent["email"], self.agent_email)
        self.assertTrue(agent["provisional"])
        self.assertEqual(manager["role"], "Admin")
        preserved = db.upsert_user(self.agent_email, "Test Agent Updated", role="")
        self.assertEqual(preserved["role"], "Agent")
        self.assertTrue(preserved["provisional"])
        self.assertIn(
            self.agent_email,
            {user["email"] for user in db.list_users(role="Agent")},
        )

        now = datetime.now(timezone.utc)
        self.call_id = db.create_call(
            {
                "agent_email": self.agent_email,
                "agent_name": "Test Agent",
                "patient_name": "Repository Test",
                "call_date": now,
                "duration_seconds": 180,
                "status": "complete",
                "vonage_recording_id": f"recording-{self.suffix}",
                "rule_results": [
                    {
                        "id": "patient_identity",
                        "label": "Patient identity",
                        "passed": True,
                        "score_1_to_10": 9,
                    }
                ],
                "critical_flags": [
                    {
                        "id": "medical_emergency",
                        "label": "Medical emergency",
                        "severity": "critical",
                        "triggered": True,
                    }
                ],
            }
        )
        call = db.get_call(self.call_id)
        self.assertIsNotNone(call)
        self.assertEqual(call["agent_email"], self.agent_email)
        self.assertEqual(call["rule_results"][0]["rule_id"], "patient_identity")
        self.assertEqual(
            db.find_call_by_vonage_recording_id(f"recording-{self.suffix}")["id"],
            self.call_id,
        )
        self.assertEqual(
            db.list_calls(agent_email=self.agent_email, status="complete")[0]["id"],
            self.call_id,
        )

        db.update_call(
            self.call_id,
            {"quality_score": 92.5, "custom_analysis_field": {"source": "test"}},
        )
        updated = db.get_call(self.call_id)
        self.assertEqual(updated["quality_score"], 92.5)
        self.assertEqual(updated["custom_analysis_field"]["source"], "test")

        db.save_manager_review(
            self.call_id,
            manager_feedback="Strong verification.",
            manager_notes="No follow-up required.",
            reviewer_email=self.manager_email,
            reviewer_name="Test Manager",
        )
        feedback = db.list_feedback(agent_email=self.agent_email)
        self.assertEqual(feedback[0]["text"], "Strong verification.")

        db.upsert_weekly_metrics(
            self.metric_id,
            {
                "agent_email": self.agent_email,
                "agent_name": "Test Agent",
                "week_start": "2026-08-03",
                "week_end": "2026-08-09",
                "year": 2026,
                "week": 32,
                "call_count": 1,
                "total_talk_time_seconds": 180,
                "avg_talk_time_seconds": 180,
                "avg_empathy_score": 8.5,
                "avg_quality_score": 92.5,
                "fcr_rate": 1,
                "avg_transfers": 0,
            },
        )
        metrics = db.list_metrics(agent_email=self.agent_email)
        self.assertEqual(metrics[0]["id"], self.metric_id)
        db.upsert_weekly_metrics(self.metric_id, {"call_count": 2})
        metrics = db.list_metrics(agent_email=self.agent_email)
        self.assertEqual(metrics[0]["call_count"], 2)
        self.assertEqual(metrics[0]["total_talk_time_seconds"], 180)

        ruleset = {
            "version": self.rules_version,
            "name": "Integration test rules",
            "description": "Temporary repository contract fixture",
            "rules": [],
        }
        db.seed_qa_rules(ruleset, force=True)
        self.assertEqual(db.get_qa_rules_current()["version"], self.rules_version)

        alert_key = f"test-{self.suffix}"
        self.assertFalse(db.alert_recently_sent(alert_key, cooldown_minutes=30))
        db.mark_alert_sent(alert_key)
        self.assertTrue(db.alert_recently_sent(alert_key, cooldown_minutes=30))

        db.upsert_call_log(
            {
                "id": self.call_log_id,
                "direction": "Inbound",
                "from_number": "+15555550100",
                "to_number": "+15555550101",
                "result": "Missed",
                "recorded": False,
                "length_seconds": 0,
                "start": now,
                "end": now,
                "is_missed": True,
                "is_unrecorded": True,
                "matched_call_id": self.call_id,
                "raw": {"provider_field": "preserved"},
            }
        )
        log = db.get_call_log(self.call_log_id)
        self.assertEqual(log["start"], now)
        self.assertEqual(log["raw"]["provider_field"], "preserved")
        self.assertEqual(
            db.list_call_logs(missed_only=True, unrecorded_only=True)[0]["id"],
            self.call_log_id,
        )


if __name__ == "__main__":
    unittest.main()
