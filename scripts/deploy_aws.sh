#!/usr/bin/env bash
# Deploy Call QA (Next.js + Vonage poller) to AWS ECS.
#
# Prereqs: AWS CLI, Docker, Node (for cdk), Python cdk deps
# Usage:
#   AWS_PROFILE=claude_account ./scripts/deploy_aws.sh
#   CERT_ARN=arn:aws:acm:...:certificate/... ./scripts/deploy_aws.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
DOMAIN="${DOMAIN:-tool.releviumpain.com}"
BUCKET="${RECORDINGS_BUCKET:-rps-call-qa-recordings-013908492747}"
STACK="${STACK_NAME:-RpsCallQaStack}"

need() { command -v "$1" >/dev/null || { echo "Missing dependency: $1" >&2; exit 1; }; }
need aws
need docker
need npm
need python3

echo "==> AWS identity"
aws sts get-caller-identity
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

echo "==> Pushing Secrets Manager secret"
"$ROOT/scripts/push_aws_secret.sh"

CERT_ARN="${CERT_ARN:-}"
if [[ -z "$CERT_ARN" ]]; then
  echo "==> Looking up ACM certificate for $DOMAIN"
  CERT_ARN="$(aws acm list-certificates --region "$REGION" \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN' && Status=='ISSUED'].CertificateArn | [0]" \
    --output text)"
  if [[ "$CERT_ARN" == "None" || -z "$CERT_ARN" ]]; then
    echo "No ISSUED ACM cert for $DOMAIN."
    echo "Requesting a DNS-validated certificate…"
    CERT_ARN="$(aws acm request-certificate \
      --domain-name "$DOMAIN" \
      --validation-method DNS \
      --region "$REGION" \
      --query CertificateArn --output text)"
    echo "Certificate requested: $CERT_ARN"
    echo
    echo "Add these Cloudflare DNS validation CNAMEs (DNS only / grey cloud):"
    sleep 3
    aws acm describe-certificate --certificate-arn "$CERT_ARN" --region "$REGION" \
      --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output table
    echo
    echo "After Cloudflare records propagate and ACM status is ISSUED, re-run:"
    echo "  CERT_ARN=$CERT_ARN ./scripts/deploy_aws.sh"
    exit 2
  fi
fi

echo "Using certificate: $CERT_ARN"

echo "==> Installing CDK deps"
python3 -m pip install -q -r "$ROOT/infra/aws/requirements.txt"
if ! command -v cdk >/dev/null; then
  npm install -g aws-cdk
fi

echo "==> CDK bootstrap (idempotent)"
cd "$ROOT/infra/aws"
npx cdk bootstrap "aws://$ACCOUNT/$REGION"

echo "==> CDK deploy $STACK"
npx cdk deploy "$STACK" --require-approval never \
  -c "account=$ACCOUNT" \
  -c "region=$REGION" \
  -c "domainName=$DOMAIN" \
  -c "recordingsBucketName=$BUCKET" \
  -c "certificateArn=$CERT_ARN"

echo
echo "==> Done. Point Cloudflare DNS:"
echo "  CNAME  tool  →  <LoadBalancerDNS from outputs>   (SSL Full/Strict if orange-cloud)"
echo "Add Google OAuth redirect:"
echo "  https://$DOMAIN/api/auth/callback/google"
echo "Open: https://$DOMAIN"
