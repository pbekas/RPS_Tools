# RPS_Tools — Call QA

Phone call quality review for Relevium Pain Specialists. Batch-upload (or pull via Vonage) call recordings, run Amazon Transcribe + Bedrock QA, review chat-style transcripts with audio, capture manager feedback, and generate rolling AI coaching per agent.

## Stack

- **UI:** Streamlit (hosted on **AWS ECS Fargate**)
- **Speech-to-text:** **Amazon Transcribe** (speaker diarization)
- **AI QA / coaching:** **Amazon Bedrock** (Claude)
- **DB:** Google Cloud Firestore (optional while migrating; DynamoDB later)
- **Audio storage:** **AWS S3**
- **Auth:** Google Workspace SSO (`@releviumpain.com` only)
- **Phones:** **Vonage Business Communications** Call Recording API via [apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)

## Vonage recordings

This is **not** the classic Voice API key pair alone. Office phone recordings come from the **VBC Call Recording API**:

1. Sign in at [apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)
2. Create an application → Production Keys → subscribe to **Call Recording**
3. Set `VBC_CLIENT_ID`, `VBC_CLIENT_SECRET`, `VBC_USERNAME`, `VBC_PASSWORD` in `.env`
4. Sync:

```bash
python scripts/sync_vonage_recordings.py --test
python scripts/sync_vonage_recordings.py --days 7 --max 50
```

Or use **Upload & process → Sync recordings** in the app.

Details: [`docs/AWS_HOSTING.md`](docs/AWS_HOSTING.md)

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

In Google Cloud Console → OAuth client, add authorized redirect URI:

`http://localhost:8501/`

Promote your user to Admin once after first login (Team setup page), or set `role: "Admin"` on your `users/{email}` doc in Firestore.

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

## AI Studio prompt

Bedrock system instruction: [`docs/AI_ANALYST_SYSTEM_INSTRUCTION.md`](docs/AI_ANALYST_SYSTEM_INSTRUCTION.md)

## Deploy (AWS)

See [`docs/AWS_HOSTING.md`](docs/AWS_HOSTING.md) and [`infra/aws/`](infra/aws/) (CDK starter: ECS Fargate + ALB + S3).

Set `S3_BUCKET` + `AWS_REGION` so processed recordings land in your account. Secrets Manager should include OAuth, VBC, and Firestore (if still used). Enable **Bedrock model access** for your Claude model ID.

## Security notes

- `.env` is gitignored — never commit service account JSON or OAuth secrets
- Call recordings may contain PHI — restrict GCP IAM, prefer private GCS + signed URLs, and treat this as an internal Workspace-only tool
- Rotate any credentials that were shared in chat history
