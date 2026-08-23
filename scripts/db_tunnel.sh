#!/usr/bin/env bash
# Open an SSM port-forward tunnel from localhost to RPS Call QA Postgres.
#
# Prereqs: AWS CLI v2, Session Manager plugin
#   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Usage:
#   ./scripts/db_tunnel.sh                 # production on localhost:5432
#   ./scripts/db_tunnel.sh staging 15432   # staging on localhost:15432
#
# In another terminal (after downloading the RDS CA bundle):
#   curl -fsSL -o ~/aws-rds-global-bundle.pem \
#     https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
#   export PGHOST=127.0.0.1 PGPORT=5432 PGSSLMODE=verify-full \
#     PGSSLROOTCERT=$HOME/aws-rds-global-bundle.pem
#   eval "$(aws secretsmanager get-secret-value \
#     --secret-id rps-call-qa/production/database --region us-east-1 \
#     --query SecretString --output text | python3 -c '
# import json,sys
# s=json.load(sys.stdin)
# print(f\"export PGUSER={s[\"username\"]}\")
# print(f\"export PGPASSWORD={s[\"password\"]}\")
# print(f\"export PGDATABASE={s.get(\"dbname\",\"rps_call_qa\")}\")
# ')"
#   psql

set -euo pipefail

ENV="${1:-production}"
LOCAL_PORT="${2:-5432}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  PROFILE_ARGS=(--profile "$AWS_PROFILE")
fi

case "$ENV" in
  production|prod)
    SECRET_ID="rps-call-qa/production/database"
    HOST="rps-call-qa-production.ceelxclkk3aw.us-east-1.rds.amazonaws.com"
    ;;
  staging|stage)
    SECRET_ID="rps-call-qa/staging/database"
    HOST="rps-call-qa-staging.ceelxclkk3aw.us-east-1.rds.amazonaws.com"
    ;;
  *)
    echo "Unknown env: $ENV (use production|staging)" >&2
    exit 1
    ;;
esac

BASTION_ID="$(aws cloudformation describe-stacks \
  --stack-name RpsCallQaDbBastionStack \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue | [0]" \
  --output text)"

if [[ -z "$BASTION_ID" || "$BASTION_ID" == "None" ]]; then
  echo "Bastion stack/instance not found. Deploy infra/aws/db_bastion.yaml first." >&2
  exit 1
fi

# Ensure bastion is running (cheap to stop when unused).
STATE="$(aws ec2 describe-instances --instance-ids "$BASTION_ID" --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} --query 'Reservations[0].Instances[0].State.Name' --output text)"
if [[ "$STATE" == "stopped" ]]; then
  echo "==> Starting bastion $BASTION_ID"
  aws ec2 start-instances --instance-ids "$BASTION_ID" --region "$REGION" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} >/dev/null
  aws ec2 wait instance-running --instance-ids "$BASTION_ID" --region "$REGION" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"}
fi

echo "==> Waiting for SSM agent on $BASTION_ID"
for _ in $(seq 1 36); do
  PING="$(aws ssm describe-instance-information --region "$REGION" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
    --filters "Key=InstanceIds,Values=$BASTION_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
  if [[ "$PING" == "Online" ]]; then
    break
  fi
  sleep 5
done
if [[ "$PING" != "Online" ]]; then
  echo "Bastion is not Online in SSM yet (status=$PING). Retry in a minute." >&2
  exit 1
fi

echo "==> Tunnel ready: localhost:$LOCAL_PORT -> $HOST:5432 ($ENV)"
echo "    Secret: $SECRET_ID"
echo "    Keep this terminal open. Ctrl-C to close."
exec aws ssm start-session \
  --target "$BASTION_ID" \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
