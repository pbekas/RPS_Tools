#!/usr/bin/env bash
# Create or update Secrets Manager secret rps-call-qa/app from local env files.
# Never commit the generated JSON.
#
# Usage (from repo root, with AWS credentials):
#   ./scripts/push_aws_secret.sh
#   AWS_PROFILE=claude_account ./scripts/push_aws_secret.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRET_NAME="${SECRET_NAME:-rps-call-qa/app}"
REGION="${AWS_REGION:-us-east-1}"

load_dotenv() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      # Do not override the shell's AWS auth from app .env files
      # (web/.env.local often has AWS_PROFILE=claude_account).
      case "$key" in
        AWS_PROFILE|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_DEFAULT_PROFILE)
          continue
          ;;
      esac
      val="${val%\"}"; val="${val#\"}"
      val="${val%\'}"; val="${val#\'}"
      if [[ -z "${!key:-}" ]]; then
        export "$key=$val"
      fi
    fi
  done < "$file"
}

load_dotenv "$ROOT/.env"
load_dotenv "$ROOT/web/.env.local"

FIREBASE_JSON="${FIREBASE_SERVICE_ACCOUNT:-}"
# If FIREBASE_SERVICE_ACCOUNT is a filesystem path, read the JSON file.
if [[ -n "$FIREBASE_JSON" && -f "$FIREBASE_JSON" ]]; then
  FIREBASE_JSON="$(cat "$FIREBASE_JSON")"
fi
if [[ -z "$FIREBASE_JSON" && -n "${FIREBASE_SERVICE_ACCOUNT_PATH:-}" && -f "${FIREBASE_SERVICE_ACCOUNT_PATH}" ]]; then
  FIREBASE_JSON="$(cat "$FIREBASE_SERVICE_ACCOUNT_PATH")"
fi
if [[ -z "$FIREBASE_JSON" && -f "$ROOT/secrets/firebase-service-account.json" ]]; then
  FIREBASE_JSON="$(cat "$ROOT/secrets/firebase-service-account.json")"
fi
export FIREBASE_JSON

# Guard against accidentally storing a local path in Secrets Manager.
if [[ -n "$FIREBASE_JSON" && -f "$FIREBASE_JSON" ]]; then
  echo "FIREBASE_SERVICE_ACCOUNT still looks like a path after load: $FIREBASE_JSON" >&2
  exit 1
fi
if [[ -n "$FIREBASE_JSON" && "$FIREBASE_JSON" != \{* ]]; then
  echo "FIREBASE_SERVICE_ACCOUNT does not look like JSON (must start with '{')." >&2
  exit 1
fi

missing=()
for key in NEXTAUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done
[[ -n "$FIREBASE_JSON" ]] || missing+=("FIREBASE_SERVICE_ACCOUNT")
for key in VBC_CLIENT_ID VBC_CLIENT_SECRET VBC_USERNAME VBC_PASSWORD; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done

if ((${#missing[@]})); then
  echo "Missing required values: ${missing[*]}" >&2
  echo "Set them in .env / web/.env.local or the environment." >&2
  exit 1
fi

if [[ -z "${OPS_INTERNAL_TOKEN:-}" ]]; then
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
    OPS_INTERNAL_TOKEN="$(
      aws secretsmanager get-secret-value \
        --secret-id "$SECRET_NAME" \
        --region "$REGION" \
        --query SecretString \
        --output text |
      python3 -c 'import json, sys; print(json.load(sys.stdin).get("OPS_INTERNAL_TOKEN", ""))'
    )"
  fi
  if [[ -z "$OPS_INTERNAL_TOKEN" ]]; then
    OPS_INTERNAL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  fi
  export OPS_INTERNAL_TOKEN
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

python3 - <<'PY' >"$TMP"
import json, os
payload = {
    "NEXTAUTH_SECRET": os.environ["NEXTAUTH_SECRET"],
    "GOOGLE_CLIENT_ID": os.environ["GOOGLE_CLIENT_ID"],
    "GOOGLE_CLIENT_SECRET": os.environ["GOOGLE_CLIENT_SECRET"],
    "FIREBASE_SERVICE_ACCOUNT": os.environ["FIREBASE_JSON"],
    "VBC_CLIENT_ID": os.environ["VBC_CLIENT_ID"],
    "VBC_CLIENT_SECRET": os.environ["VBC_CLIENT_SECRET"],
    "VBC_USERNAME": os.environ["VBC_USERNAME"],
    "VBC_PASSWORD": os.environ["VBC_PASSWORD"],
    "VBC_ACCOUNT_ID": os.environ.get("VBC_ACCOUNT_ID") or "self",
    "APP_URL": os.environ.get("APP_URL") or "https://tool.releviumpain.com",
    "GCHAT_WEBHOOK_URL": os.environ.get("GCHAT_WEBHOOK_URL")
        or os.environ.get("GOOGLE_CHAT_WEBHOOK_URL")
        or "",
    "GCHAT_MISSED_CALLS_WEBHOOK_URL": os.environ.get("GCHAT_MISSED_CALLS_WEBHOOK_URL")
        or os.environ.get("GCHAT_MISSED_WEBHOOK_URL")
        or "",
    "GCHAT_TIME_CLOCK_WEBHOOK_URL": os.environ.get("GCHAT_TIME_CLOCK_WEBHOOK_URL") or "",
    "TIME_CLOCK_ALERTS_ENABLED": os.environ.get("TIME_CLOCK_ALERTS_ENABLED") or "1",
    "ALERTS_ENABLED": os.environ.get("ALERTS_ENABLED") or "1",
    "MISSED_ALERT_WINDOW_MINUTES": os.environ.get("MISSED_ALERT_WINDOW_MINUTES") or "30",
    "MISSED_ALERT_THRESHOLD": os.environ.get("MISSED_ALERT_THRESHOLD") or "8",
    "OPS_INTERNAL_TOKEN": os.environ.get("OPS_INTERNAL_TOKEN") or "",
    "TWILIO_ACCOUNT_SID": os.environ.get("TWILIO_ACCOUNT_SID") or "",
    "TWILIO_AUTH_TOKEN": os.environ.get("TWILIO_AUTH_TOKEN") or "",
    "TWILIO_FROM_NUMBER": os.environ.get("TWILIO_FROM_NUMBER") or "",
    "TWILIO_MISSED_SMS_ENABLED": os.environ.get("TWILIO_MISSED_SMS_ENABLED") or "0",
    "TWILIO_MISSED_SMS_MESSAGE": os.environ.get("TWILIO_MISSED_SMS_MESSAGE") or "",
    "TWILIO_MISSED_SMS_MAIN_LINE": os.environ.get("TWILIO_MISSED_SMS_MAIN_LINE") or "",
    "TWILIO_MISSED_SMS_COOLDOWN_MINUTES": os.environ.get(
        "TWILIO_MISSED_SMS_COOLDOWN_MINUTES"
    )
    or "90",
    "TWILIO_MISSED_SMS_MAX_AGE_MINUTES": os.environ.get(
        "TWILIO_MISSED_SMS_MAX_AGE_MINUTES"
    )
    or "120",
    "TWILIO_STATUS_CALLBACK_URL": os.environ.get("TWILIO_STATUS_CALLBACK_URL") or "",
}
print(json.dumps(payload))
PY

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "file://$TMP" \
    --region "$REGION" >/dev/null
  echo "Updated secret $SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "RPS Call QA production env (Next.js + poller)" \
    --secret-string "file://$TMP" \
    --region "$REGION" >/dev/null
  echo "Created secret $SECRET_NAME"
fi
