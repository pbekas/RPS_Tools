from __future__ import annotations

import unittest

from src.qa_rules import (
    _normalize_ruleset,
    active_rules,
    compute_scores,
    load_rules_from_file,
    normalize_rule_results,
    rule_applies_to_topic,
    rules_for_prompt,
)


def _ruleset() -> dict:
    return _normalize_ruleset(
        {
            "version": "test",
            "empathy_pass_threshold": 7,
            "auto_fail_quality_cap": 4,
            "transfer_soft_limit": 1,
            "transfer_auto_fail_at": 3,
            "rules": [
                {
                    "id": "empathy",
                    "label": "Empathy",
                    "weight": 1,
                    "active": True,
                    "pass_criteria": "Warm tone",
                },
                {
                    "id": "scheduling_accuracy",
                    "label": "Scheduling accuracy",
                    "weight": 1,
                    "active": True,
                    "topic_ids": ["scheduling", "new_patient"],
                    "pass_criteria": "Confirm appointment details",
                },
                {
                    "id": "billing_balance",
                    "label": "Billing balance",
                    "weight": 1,
                    "active": True,
                    "topic_ids": ["billing"],
                    "pass_criteria": "Explain the balance",
                },
            ],
        }
    )


class QaRulesTopicScopeTest(unittest.TestCase):
    def test_empty_topic_ids_apply_everywhere(self) -> None:
        rule = {"id": "empathy", "topic_ids": []}
        self.assertTrue(rule_applies_to_topic(rule, "billing"))
        self.assertTrue(rule_applies_to_topic(rule, "scheduling"))
        self.assertTrue(rule_applies_to_topic(rule, None))

    def test_scoped_rule_matches_listed_topics_only(self) -> None:
        rule = {"id": "billing_balance", "topic_ids": ["billing"]}
        self.assertTrue(rule_applies_to_topic(rule, "billing"))
        self.assertFalse(rule_applies_to_topic(rule, "scheduling"))
        self.assertFalse(rule_applies_to_topic(rule, "new_patient"))

    def test_active_rules_filter_by_topic(self) -> None:
        rs = _ruleset()
        ids = {r["id"] for r in active_rules(rs, topic_id="billing")}
        self.assertEqual(ids, {"empathy", "billing_balance"})
        ids = {r["id"] for r in active_rules(rs, topic_id="new_patient")}
        self.assertEqual(ids, {"empathy", "scheduling_accuracy"})
        ids = {r["id"] for r in active_rules(rs, topic_id="clinical_question")}
        self.assertEqual(ids, {"empathy"})

    def test_normalize_drops_inapplicable_rules(self) -> None:
        rs = _ruleset()
        results = normalize_rule_results(
            [
                {"rule_id": "empathy", "passed": True, "score_1_to_10": 8},
                {"rule_id": "scheduling_accuracy", "passed": False},
                {"rule_id": "billing_balance", "passed": True},
            ],
            rs,
            topic_id="billing",
        )
        self.assertEqual(
            [r["rule_id"] for r in results],
            ["empathy", "billing_balance"],
        )
        self.assertTrue(all(r["passed"] for r in results))

    def test_quality_score_uses_only_applicable_rules(self) -> None:
        rs = _ruleset()
        results = normalize_rule_results(
            [
                {"rule_id": "empathy", "passed": True, "score_1_to_10": 8},
                {"rule_id": "billing_balance", "passed": False},
            ],
            rs,
            topic_id="billing",
        )
        scored = compute_scores(results, rs)
        self.assertEqual(len(scored["rule_results"]), 2)
        self.assertFalse(scored["auto_failed"])
        # one of two applicable rules passed → 1 + 9 * 0.5 = 6
        self.assertEqual(scored["quality_score"], 6)

    def test_prompt_includes_applies_to(self) -> None:
        text = rules_for_prompt(_ruleset())
        self.assertIn("applies_to=all topics", text)
        self.assertIn("applies_to=scheduling, new_patient", text)
        self.assertIn("applies_to=billing", text)
        self.assertIn("Omit rules that do not apply", text)

    def test_shipped_json_loads_with_topic_ids(self) -> None:
        rs = load_rules_from_file()
        by_id = {r["id"]: r for r in rs["all_rules"]}
        self.assertEqual(by_id["scheduling_accuracy"]["topic_ids"], ["scheduling"])
        self.assertEqual(by_id["insurance_auth_clarity"]["topic_ids"], ["insurance"])
        self.assertEqual(
            by_id["medication_refill_process"]["topic_ids"],
            ["prescription_refill"],
        )
        self.assertEqual(by_id["empathy"]["topic_ids"], [])


if __name__ == "__main__":
    unittest.main()
