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
| `VBC_POLLER_MAX_PER_CYCLE` | `25` | Cap per cycle |

**Scheduled HTTP kick (cron / EventBridge):** every 5 minutes `POST` to:

`http://localhost:8080/poller/sync-now`

```bash
# local cron example
*/5 * * * * curl -s -X POST http://127.0.0.1:8080/poller/sync-now
```

On AWS, EventBridge rule `rate(5 minutes)` → Lambda/ECS that hits `/poller/sync-now`, or run the poller script as a long-lived ECS task.

## Firestore schema

See [`docs/firestore_schema.json`](docs/firestore_schema.json).

Collections: `users`, `calls`, `metrics`, `feedback`.

| Role | Access |
|------|--------|
| **Admin** | Dashboard, upload, all calls, feedback hub, coaching, team setup |
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
2. `BEDROCK_MODEL_ID` — enable that model in the Bedrock console
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

Call review shows per-rule PASS/FAIL with evidence. Use **Re-analyze with current rules** to rescore existing transcripts after you edit the rubric.

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

See [`docs/AWS_HOSTING.md`](docs/AWS_HOSTING.md) and [`infra/aws/`](infra/aws/) (CDK starter: ECS Fargate + ALB + S3).

Set `S3_BUCKET` + `AWS_REGION` so processed recordings land in your account. Secrets Manager should include OAuth, VBC, and Firestore (if still used). Enable **Bedrock model access** for your Claude model ID.

## Security notes

- `.env` is gitignored — never commit service account JSON or OAuth secrets
- Call recordings may contain PHI — restrict GCP IAM, prefer private GCS + signed URLs, and treat this as an internal Workspace-only tool
- Rotate any credentials that were shared in chat history
