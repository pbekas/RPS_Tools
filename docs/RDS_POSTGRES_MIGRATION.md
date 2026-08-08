# Firestore to RDS PostgreSQL migration

## Goal

Move application metadata and PHI-bearing transcripts from Firestore to a private,
encrypted Amazon RDS for PostgreSQL database without interrupting call ingestion,
reviews, or agent access.

Recordings remain in private S3. Google OAuth remains the identity provider.

## Target architecture

- Amazon RDS for PostgreSQL in private subnets
- KMS encryption at rest, TLS in transit, automated backups and point-in-time recovery
- Database credentials generated and stored in AWS Secrets Manager
- ECS web and poller services are the only network clients
- Relational columns for frequently filtered fields
- JSONB for transcripts and evolving AI payloads
- SQL child tables for rule and critical-flag results used by analytics

## Safety principles

1. Firestore remains the production source of truth until reconciliation passes.
2. RDS infrastructure is opt-in with CDK context `enableRds=true`.
3. Firestore document IDs are preserved as PostgreSQL text primary keys.
4. Migration exports and logs must not print or persist PHI outside encrypted storage.
5. Cutover must be reversible without deleting Firestore data.
6. No production cutover occurs in the same deployment that first creates RDS.

## Phases

### Phase 0 — foundation

- Add PostgreSQL schema and checksum-based migration runner.
- Add `DB_BACKEND` and `DATABASE_URL` configuration.
- Add an application database facade while Firestore remains selected.
- Add optional private RDS resources to CDK.
- Add local PostgreSQL development instructions.

Exit criteria:

- Existing app builds and runs with `DB_BACKEND=firestore`.
- Schema applies cleanly to an empty PostgreSQL database.
- CDK synthesizes both with and without `enableRds=true`.

### Phase 1 — repository implementation

- Implement the Python PostgreSQL repository for users, calls, CDRs, feedback,
  metrics, configuration catalogs, and alert state.
- Implement the Next.js PostgreSQL repository behind the existing server-side API
  contracts.
- Move filtering, ordering, pagination, uniqueness, and transactions into SQL.
- Add repository contract tests that run against PostgreSQL.

Exit criteria:

- Python and Next.js contract tests pass against both Firestore and PostgreSQL.
- PostgreSQL rejects duplicate Vonage recording IDs.
- Review + feedback and identity remapping are transactional.

### Phase 2 — backfill and reconciliation

- Export Firestore with unbounded pagination.
- Transform Firestore timestamps and nested analysis arrays.
- Load users/configuration first, then calls, results, CDRs, feedback, metrics,
  alerts, and access audit records.
- Reconcile counts, min/max timestamps, status distributions, agent distributions,
  nested result counts, orphaned references, and sampled document hashes.

Exit criteria:

- All reconciliation checks pass.
- Data anomalies are documented and resolved or explicitly accepted.
- Backfill is repeatable and idempotent.

### Phase 3 — shadow operation

- Enable PostgreSQL dual writes for new mutations.
- Continue all production reads from Firestore.
- Compare write outcomes and run scheduled reconciliation.
- Record and alert on dual-write failures without hiding primary-write failures.

Exit criteria:

- At least seven days of clean dual writes.
- No unexplained data drift.
- Connection, query latency, backup, and storage alarms are healthy.

### Phase 4 — read cutover

- Switch a small internal/admin cohort to PostgreSQL reads.
- Validate authentication roles, dashboard, call review, Ops, settings, alerts,
  and coaching.
- Switch all reads to PostgreSQL while retaining dual writes.

Exit criteria:

- Application and authorization smoke tests pass.
- Error rate and p95 latency remain acceptable.
- Rollback to Firestore reads is tested.

### Phase 5 — final cutover and retirement

- Stop Firestore writes after the rollback window.
- Keep Firestore read-only for at least 30 days.
- Remove Firebase credentials and dependencies only after final reconciliation.
- Apply approved retention policy to Firestore exports and the old project.

## Initial PostgreSQL model

- `users`
- `calls`
- `call_rule_results`
- `call_flag_results`
- `call_logs`
- `feedback`
- `weekly_metrics`
- `config_sets` for versioned rules, topics, and flags
- `alert_state`
- `access_audit`
- `schema_migrations`

Transcripts remain JSONB. Rule and flag results are normalized because they power
heatmaps, critical-alert reporting, and future calibration analytics.

## Local foundation check

```bash
docker compose -f docker-compose.postgres.yml up -d
export DATABASE_URL='postgresql://rps_app:local-dev-only@localhost:55432/rps_call_qa?sslmode=disable'
python scripts/migrate_postgres.py
```

Keep `DB_BACKEND=firestore` while running the existing application. PostgreSQL
selection intentionally fails for CRUD functions until the phase 1 repository is
implemented.

To preview the optional AWS resources without creating them:

```bash
cd infra/aws
npx cdk synth -c enableRds=true -c rdsMultiAz=false
```

For production, use `rdsMultiAz=true`. Enabling RDS creates billable resources;
do not deploy that context until the foundation review is approved.

CDK cutover controls (for later phases):

- `-c dbBackend=firestore|postgres`
- `-c dbDualWrite=true|false` (reserved; rejected until phase 3)

`dbBackend=postgres` is rejected unless `enableRds=true`.

## Cutover controls

- Feature flags:
  - `DB_BACKEND=firestore|postgres`
  - `DB_DUAL_WRITE=0|1`
- Rollback:
  - Set `DB_BACKEND=firestore`
  - Keep RDS available for diagnosis
  - Reconcile any PostgreSQL-only writes before retrying
- A maintenance window is still recommended for the final write cutover, even
  after dual-write validation.

## PHI and operational requirements

- Confirm the executed AWS BAA and service eligibility with compliance counsel.
- Require TLS database connections.
- Do not expose RDS publicly.
- Use least-privilege database roles for migration and runtime.
- Encrypt automated backups and snapshots.
- Disable SQL statement logging that could capture transcript or patient data.
- Add access audit events for call/transcript/audio views.
- Define separate retention periods for audio, transcripts, audit events, and
  database backups before final cutover.

## Estimated effort

- Foundation: 4–6 engineer-days
- Repositories and tests: 11–16 engineer-days
- Backfill/reconciliation: 4–6 engineer-days
- Shadow operation/cutover: 6–9 engineer-days
- Infrastructure, monitoring, documentation, and contingency: 8–12 engineer-days

Total production-grade estimate: 33–49 engineer-days.
