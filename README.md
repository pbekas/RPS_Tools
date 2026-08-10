# RPS_Tools — Call QA

Phone call quality review for Relevium Pain Specialists. Batch-upload (or pull via Vonage) call recordings, run Amazon Transcribe + Bedrock QA, review chat-style transcripts with audio, capture manager feedback, and generate rolling AI coaching per agent.

## Stack

- **Review UI:** Next.js (`web/`) — transcript-first call review + dashboard
- **Ops UI:** Streamlit (`app.py`) — upload, Vonage sync, team setup, re-analyze
- **Speech-to-text:** **Amazon Transcribe** (speaker diarization)
- **AI QA / coaching:** **Amazon Bedrock** (Claude)
- **DB:** Google Cloud Firestore
- **Audio storage:** **AWS S3** (presigned playback URLs)
- **Auth:** Google Workspace SSO (`@releviumpain.com` only)
- **Phones:** **Vonage Business Communications** Call Recording API via [apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)

## Near-real-time recording ingest

Vonage **VBC company call recordings are pull-based** (no “recording ready” push from
the Call Recording API). To process calls as they finish:

```bash
# Continuous poller (every 5 minutes, last 30 minutes)
python scripts/poll_vonage_recordings.py

# Or webhook service with poller enabled
VBC_POLLER_ENABLED=1 uvicorn webhook:app --host 0.0.0.0 --port 8080
```

Optional env:

| Var | Default | Purpose |
|-----|---------|---------|
| `VBC_POLLER_ENABLED` | off | Autostart poller inside `webhook.py` |
| `VBC_POLLER_INTERVAL_SECONDS` | `300` | Poll cadence (5 minutes) |
| `VBC_POLLER_LOOKBACK_MINUTES` | `30` | Sync window |
| `VBC_POLLER_MAX_PER_CYCLE` | `25` | Cap recordings per cycle |
| `VBC_POLLER_MAX_CALL_LOGS` | `200` | Cap CDRs (Reports call-logs) per cycle |
| `GCHAT_WEBHOOK_URL` | empty | Google Chat webhook for critical flags + each missed/abandoned/**voicemail** inbound CDR |
| `GCHAT_CONTRACTS_WEBHOOK_URL` | empty | Optional separate Chat webhook for contract expiry (never uses the call webhook) |
| `MISSED_ALERT_MAX_AGE_MINUTES` | `120` | Skip Chat alerts for older CDRs (avoids noise on backfill) |
| `MISSED_ALERT_THRESHOLD` | `8` | Optional spike summary: missed/non-answered CDRs in window |
| `MISSED_ALERT_WINDOW_MINUTES` | `30` | Rolling window for optional missed-call spike summary |
| `TWILIO_MISSED_SMS_ENABLED` | off | SMS the caller on missed **inbound** CDRs (needs Twilio creds) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | empty | Twilio REST credentials + From number (E.164) |
| `TWILIO_MISSED_SMS_COOLDOWN_MINUTES` | `90` | Per-number dedup window (`alert_state`) |
| `TWILIO_MISSED_SMS_MAX_AGE_MINUTES` | `120` | Ignore older CDRs (avoids SMS on backfill) |

Each poller cycle also upserts VBC **Reports** call-logs into Firestore (`call_logs`)
so admins can see missed / unrecorded traffic on **/ops**. Subscribe the VBC app to
the **Reports API** suite in [apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)
(same OAuth credentials as Call Recording).

**SLA / ASA note:** VBC Reports CDRs expose direction, result, talk `length`, and
start/end — **not** ring time, queue wait, or answered-at. Classic ASA and
service level (e.g. 80/20) are blocked until telephony provides wait timing.
`/ops` shows inbound offered/answered/abandon proxies plus an optional
AI-estimated speed-to-answer from matched QA (`time_to_answer_seconds`), labeled
as a proxy — never as telephony ASA. Sync persists nullable
`ring_seconds` / `wait_seconds` / `queue_seconds` / `answered_at` stubs for when
Vonage or an ACD adds those fields.

```bash
python scripts/sync_vonage_call_logs.py --test
python scripts/sync_vonage_call_logs.py --minutes 60
```

**Missed-call patient SMS (Twilio):** after each CDR upsert, the poller may text
the caller’s `from_number` when the log is **inbound** and the result is not
answered/connected (missed, abandoned, voicemail, no-answer, busy, etc.).
Off by default (`TWILIO_MISSED_SMS_ENABLED=0`). Dedup uses `alert_state` keyed by
normalized phone. Copy is configurable via `TWILIO_MISSED_SMS_MESSAGE` (optional
`{main_line}`). Optional delivery receipts: `POST /webhooks/twilio/sms-status`.

**Scheduled HTTP kick (cron / EventBridge):** every 5 minutes `POST` to:

`http://localhost:8080/poller/sync-now`

```bash
# local cron example
*/5 * * * * curl -s -X POST http://127.0.0.1:8080/poller/sync-now
```

On AWS, EventBridge rule `rate(5 minutes)` → Lambda/ECS that hits `/poller/sync-now`, or run the poller script as a long-lived ECS task.

## Firestore schema

See [`docs/firestore_schema.json`](docs/firestore_schema.json).

The application is beginning a phased move to private RDS PostgreSQL. Firestore
remains the production source of truth until backfill and reconciliation are
complete. See [`docs/RDS_POSTGRES_MIGRATION.md`](docs/RDS_POSTGRES_MIGRATION.md).

Collections: `users`, `calls`, `call_logs`, `metrics`, `feedback`.

| Role | Access |
|------|--------|
| **Admin** | Dashboard, Call ops, upload, all calls, feedback hub, coaching, team setup |
| **Agent** | Own scores, own calls, own coaching report |

## Quick start

```bash
cd ~/Sites/RPS_Tools
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # if needed — secrets already scaffolded in .env (gitignored)
```

Fill in:

1. `AWS_REGION`, `S3_BUCKET` — recordings + Transcribe input
2. `BEDROCK_MODEL_ID` — Haiku for call audit (enable in Bedrock console); optional `BEDROCK_COACHING_MODEL_ID` for Sonnet coaching
3. AWS credentials (CLI profile, env keys, or ECS task role)
4. `FIREBASE_SERVICE_ACCOUNT` — until/unless you move metadata to DynamoDB
5. `APP_URL` — must match your OAuth redirect
6. `VBC_*` — Vonage UC API Manager credentials

In Google Cloud Console → OAuth client, add authorized redirect URIs:

- Streamlit: `http://localhost:8501/`
- Next.js review app: `http://localhost:3000/api/auth/callback/google`

Promote your user to Admin once after first login (Team setup page), or set `role: "Admin"` on your `users/{email}` doc in Firestore.

### Review app (Next.js)

```bash
cd web
# web/.env.local is scaffolded from parent secrets (gitignored)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Dashboard lists scored calls; **Review** opens the SMS-style transcript with audio scrubbing and rule deep-links. Admins can save manager notes/feedback.

### Streamlit ops

```bash
streamlit run app.py
```
Vonage webhook (separate terminal):

```bash
uvicorn webhook:app --host 0.0.0.0 --port 8080
```

Weekly coaching CLI:

```bash
python scripts/run_weekly_coaching.py --all
# or
python scripts/run_weekly_coaching.py --agent name@releviumpain.com
```

## Features (Phase 1–4)

1. **Schema** — calls, users, weekly metrics, feedback hub
2. **Core app** — batch upload + background worker, **Transcribe + Bedrock** analysis (agent, topic, empathy, transfers, FCR, transcript), chat-bubble transcript, audio playback, manager notes/feedback → Firestore
3. **SSO** — Google OAuth; domain lock to `@releviumpain.com`; Admin vs Agent views
4. **Rolling feedback** — aggregates manager notes + AI summaries → **Bedrock** coaching report on the user record

## QA rules

Starter rubric: [`docs/qa_rules_v1.json`](docs/qa_rules_v1.json). Seeded to Firestore as `qa_rules/current`.

```bash
python scripts/seed_qa_rules.py --force
```

Admins can edit rules and scoring thresholds in the Next.js app under **Settings → Audit rules**. Call review shows per-rule PASS/FAIL with evidence. Use **Re-analyze with current rules** to rescore existing transcripts after you edit the rubric.

## Call topics

Starter catalog: [`docs/call_topics_v1.json`](docs/call_topics_v1.json). Seeded to Firestore as `call_topics/current`.

```bash
python scripts/seed_call_topics.py --force
```

Each topic has an **id**, **label**, and **details** the AI uses to classify the call. Edit in Streamlit **Call topics**, or update Firestore / the JSON and re-seed.

## Critical call flags & sentiment

Starter catalog: [`docs/call_flags_v1.json`](docs/call_flags_v1.json). Seeded to Firestore as `call_flags/current`.

```bash
python scripts/seed_call_flags.py --force
```

Business alerts (not agent skill fails), currently:

- **New patient — no attorney** — new patient says they don’t have an attorney
- **Procedure declined** — patient declines a procedure the office called about

Each analyzed call also stores **sentiment** (`sentiment_label`, `sentiment_score` 1–10, `sentiment_notes`). Re-analyze existing calls to backfill:

```bash
python scripts/reanalyze_calls.py --limit 20
```

## Deploy (AWS)

Production URL: **https://tool.releviumpain.com** (Next.js + Vonage poller on ECS).

```bash
AWS_PROFILE=claude_account ./scripts/deploy_aws.sh
```

See [`docs/AWS_HOSTING.md`](docs/AWS_HOSTING.md) and [`infra/aws/`](infra/aws/). Reuses S3 bucket `rps-call-qa-recordings-013908492747`. After deploy, point Cloudflare `tool` at the ALB and add the Google OAuth redirect for that host.

## Security notes

- `.env` is gitignored — never commit service account JSON or OAuth secrets
- Call recordings may contain PHI — restrict GCP IAM, prefer private GCS + signed URLs, and treat this as an internal Workspace-only tool
- Rotate any credentials that were shared in chat history
