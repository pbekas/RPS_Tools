# Hosting RPS Call QA on AWS

Production target: **https://tool.releviumpain.com**

- **Review UI:** Next.js (`web/`) on ECS Fargate behind an HTTPS ALB
- **Ingest:** Vonage poller (`Dockerfile.poller` → `webhook.py`) as a private Fargate service
- **Audio:** existing S3 bucket `rps-call-qa-recordings-013908492747`
- **DNS:** Cloudflare zone `releviumpain.com` (not Route 53)

## Architecture

```
  Managers  →  Cloudflare (tool.releviumpain.com)
                     ↓
              ALB HTTPS (ACM)
                     ↓
              ECS Fargate  Next.js :3000
                     
  ECS Fargate poller  →  Vonage VBC → S3 → Transcribe → Bedrock → Firestore
```

## One-command deploy (from a machine with AWS + Docker + local secrets)

```bash
# Requires .env + web/.env.local (OAuth, VBC, Firebase JSON) and AWS credentials
chmod +x scripts/push_aws_secret.sh scripts/deploy_aws.sh
AWS_PROFILE=claude_account ./scripts/deploy_aws.sh
```

First run may **exit after requesting an ACM certificate**. Add the printed DNS CNAMEs in Cloudflare (DNS-only), wait until ACM status is `ISSUED`, then re-run with:

```bash
CERT_ARN=arn:aws:acm:us-east-1:ACCOUNT:certificate/ID AWS_PROFILE=claude_account ./scripts/deploy_aws.sh
```

After deploy:

1. Cloudflare: `CNAME tool → <LoadBalancerDNS>` (SSL mode Full/Strict if proxied)
2. Google Cloud OAuth client: add  
   `https://tool.releviumpain.com/api/auth/callback/google`  
   and JS origin `https://tool.releviumpain.com`
3. Open https://tool.releviumpain.com

## CDK (manual)

```bash
cd infra/aws
pip install -r requirements.txt
npm i -g aws-cdk
cdk bootstrap
cdk deploy \
  -c account=013908492747 \
  -c region=us-east-1 \
  -c domainName=tool.releviumpain.com \
  -c recordingsBucketName=rps-call-qa-recordings-013908492747 \
  -c certificateArn=arn:aws:acm:us-east-1:...:certificate/...
```

Secret name: `rps-call-qa/app` (JSON keys listed in `scripts/push_aws_secret.sh`).

## Images

| File | Role |
|------|------|
| [`web/Dockerfile`](../web/Dockerfile) | Next.js standalone |
| [`Dockerfile.poller`](../Dockerfile.poller) | Uvicorn + VBC poller |

## Vonage setup

Admin portal login ≠ API credentials. Use the UC API Manager:

1. Open [https://apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)
2. Create an Application → Production Keys
3. Subscribe to **Call Recording** and **Reports** (same app / OAuth credentials)
4. Put `VBC_*` into the Secrets Manager secret (via `push_aws_secret.sh`)

Company recordings are pull-based. The poller service runs every 5 minutes and also
syncs Reports **call-logs** (CDRs) into Firestore `call_logs` for missed / unrecorded
visibility on the admin **Call ops** page (`/ops`).

Manual CDR sync:

```bash
python scripts/sync_vonage_call_logs.py --test          # verify Reports API access
python scripts/sync_vonage_call_logs.py --minutes 60
python scripts/sync_vonage_call_logs.py --days 7 --max 500
```

Optional env: `VBC_POLLER_MAX_CALL_LOGS` (default `200`) caps CDRs per poller cycle.

## Security (PHI)

- Private S3, encryption, no public ACLs
- ALB HTTPS only; Workspace SSO `@releviumpain.com`
- Secrets never in the image — Secrets Manager injection
- Fargate tasks in private subnets with NAT egress
- Enable Bedrock model access for `BEDROCK_MODEL_ID` in `us-east-1`
