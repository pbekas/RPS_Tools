# Hosting RPS Call QA on AWS

Target architecture for Relevium’s AWS account.

## Architecture

```
                    ┌──────────────────────┐
  Managers/Agents → │ CloudFront (optional)│
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ ALB (HTTPS + sticky) │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ ECS Fargate service  │
                    │  Streamlit (app.py)  │
                    └──────────┬───────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    ┌─────────────┐    ┌──────────────┐    ┌────────────────┐
    │ S3 recordings│    │ Secrets Mgr  │    │ EventBridge    │
    │ (PHI audio)  │    │ env secrets  │    │ schedule       │
    └─────────────┘    └──────────────┘    └───────┬────────┘
                                                   ▼
                                          ┌────────────────┐
                                          │ ECS scheduled  │
                                          │ sync task OR   │
                                          │ Lambda runner  │
                                          │ vonage sync    │
                                          └────────────────┘
                               ▲
                               │ HTTPS
                    ┌──────────┴───────────┐
                    │ Vonage VBC APIs      │
                    │ api.vonage.com       │
                    │ Call Recording suite │
                    └──────────────────────┘
```

AI analysis uses **Amazon Transcribe → Amazon Bedrock (Claude)** inside your AWS account. Firestore can remain on Google temporarily for metadata, or move to DynamoDB later.

## Vonage setup (required for pull sync)

Admin portal login ≠ API credentials. Use the UC API Manager:

1. Open [https://apimanager.uc.vonage.com](https://apimanager.uc.vonage.com) and sign in with your VBC admin/user.
2. Create an **Application**.
3. Generate **Production Keys** (Consumer Key / Consumer Secret).
4. Subscribe the app to the **Call Recording** API suite (and any other suites you need).
5. For production OAuth, prefer **Authorization Code** + refresh tokens. For a trusted server sync job, **Password grant** is simpler (use your VBC *user* password, username sent as `user@vbc.prod` — not the `*.api` developer login).

Put into Secrets Manager / `.env`:

| Secret | Purpose |
|--------|---------|
| `VBC_CLIENT_ID` | Consumer Key |
| `VBC_CLIENT_SECRET` | Consumer Secret |
| `VBC_USERNAME` | VBC user (office admin) |
| `VBC_PASSWORD` | That user’s password |
| `VBC_ACCOUNT_ID` | `self` or numeric account id |

Test:

```bash
python scripts/sync_vonage_recordings.py --test
python scripts/sync_vonage_recordings.py --days 3 --max 20
```

Or use **Upload & process → Sync recordings** in the Streamlit UI.

API references:

- [Call Recording overview](https://developer.vonage.com/en/vonage-business-cloud/call-recording/overview)
- [Create access token](https://developer.vonage.com/en/vonage-business-cloud/getting-started/create-an-access-token)
- List: `GET /t/vbc.prod/call_recording/api/accounts/{account_id}/company_call_recordings`
- Download: `GET /t/vbc.prod/call_recording/api/audio/recording/{recording_id}`

## AWS resources (minimum viable)

| Resource | Use |
|----------|-----|
| ECR | Docker image for Streamlit |
| ECS Fargate + ALB | Run `streamlit run app.py` (enable target-group stickiness) |
| S3 bucket (private) | Call recordings + Transcribe input; app uses presigned URLs |
| Bedrock | Claude model for QA + coaching (enable model access) |
| Transcribe | Speech-to-text with speaker labels |
| Secrets Manager | All `.env` secrets |
| EventBridge rule | Hourly/daily: run `scripts/sync_vonage_recordings.py` |
| IAM task role | `s3:*` on recordings bucket; `transcribe:*`; `bedrock:InvokeModel` / `Converse`; read secrets |

Optional: ACM certificate + Route 53 for `callqa.releviumpain.com`.

## Deploy steps (high level)

```bash
# 1. Build & push
aws ecr create-repository --repository-name rps-call-qa --region us-west-2
docker build -t rps-call-qa .
docker tag rps-call-qa:latest <account>.dkr.ecr.us-west-2.amazonaws.com/rps-call-qa:latest
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com
docker push <account>.dkr.ecr.us-west-2.amazonaws.com/rps-call-qa:latest

# 2. Create S3 bucket (block public access)
aws s3 mb s3://rps-call-qa-recordings-<account> --region us-west-2

# 3. Create secret with JSON of env vars, wire ECS task definition
# 4. Create ALB + Fargate service (sticky sessions ON)
# 5. Set APP_URL to https://your-alb-or-domain/
# 6. Add Google OAuth redirect URI for that APP_URL
```

A starter CDK stack lives in [`infra/aws/`](../infra/aws/).

## Security (PHI)

- Private S3, encryption (SSE-S3 or KMS), no public ACLs
- ALB HTTPS only; restrict SSO to `@releviumpain.com`
- Secrets never in the image — inject from Secrets Manager
- VPC: Fargate in private subnets with egress for Vonage + Bedrock + Transcribe (+ Firestore if still used)
- Enable Bedrock model access for `BEDROCK_MODEL_ID` in the target region
- Rotate any credentials pasted into chat history
