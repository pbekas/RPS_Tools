# RPS Call QA — Bedrock analyst system instruction

Used by `src/bedrock_analyst.py` with the active ruleset from `docs/qa_rules_v1.json`
(or Firestore `qa_rules/current`).

The model must return JSON including `rule_results` for every active rule id, plus
summary, transcript, transfer_count, timing fields, `sentiment`, and any triggered
`critical_flags` from `call_flags/current` (see `docs/call_flags_v1.json`).

See `src/bedrock_analyst.py` (`BASE_SYSTEM`) and `src/qa_rules.rules_for_prompt()` /
`src/call_flags.flags_for_prompt()` for the live prompt text.
