# RPS Call QA — Bedrock analyst system instruction

Used by `src/bedrock_analyst.py` with the active ruleset from `docs/qa_rules_v1.json`
(or Firestore `qa_rules/current`).

Default audit model: Claude **Haiku 4.5** (`BEDROCK_MODEL_ID`). Optional coaching
model: Claude **Sonnet 4.5** (`BEDROCK_COACHING_MODEL_ID`).

The model must return JSON including `rule_results` for every active rule id, plus
summary, transfer_count, timing fields, `sentiment`, and any triggered
`critical_flags` from `call_flags/current` (see `docs/call_flags_v1.json`).

**Do not regenerate the transcript** — Amazon Transcribe turns are passed in and stored
as-is (optional `speaker_roles` map only).

See `src/bedrock_analyst.py` (`BASE_SYSTEM`) and `src/qa_rules.rules_for_prompt()` /
`src/call_flags.flags_for_prompt()` for the live prompt text.
