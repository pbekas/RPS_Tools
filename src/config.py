"""Application configuration loaded from environment / .env."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


class Settings:
    database_backend: str
    database_url: str
    db_dual_write: bool
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    pg_sslmode: str
    pg_sslrootcert: str
    google_client_id: str
    google_client_secret: str
    session_secret: str
    app_url: str
    firebase_service_account: dict[str, Any] | None
    gcs_bucket: str
    s3_bucket: str
    aws_region: str
    bedrock_model_id: str
    transcribe_language_code: str
    transcribe_language_options: list[str]
    vonage_api_key: str
    vonage_api_secret: str
    vonage_signature_secret: str
    vbc_client_id: str
    vbc_client_secret: str
    vbc_username: str
    vbc_password: str
    vbc_account_id: str
    webhook_port: int
    allowed_email_domain: str
    gchat_webhook_url: str
    gchat_missed_calls_webhook_url: str
    alerts_enabled: bool
    alerts_master_enabled: bool
    missed_alert_window_minutes: int
    missed_alert_threshold: int
    ops_internal_token: str
    poller_internal_url: str
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_number: str
    twilio_from_number_customedico: str
    twilio_missed_sms_enabled: bool
    twilio_missed_sms_message: str
    twilio_missed_sms_message_customedico: str
    twilio_missed_sms_main_line: str
    twilio_missed_sms_cooldown_minutes: int
    twilio_missed_sms_max_age_minutes: int
    twilio_status_callback_url: str

    def __init__(self) -> None:
        self.database_backend = (
            os.getenv("DB_BACKEND", "firestore").strip().lower() or "firestore"
        )
        if self.database_backend not in {"firestore", "postgres"}:
            raise ValueError("DB_BACKEND must be 'firestore' or 'postgres'")
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.pg_host = os.getenv("PGHOST", "").strip()
        self.pg_port = int(os.getenv("PGPORT", "5432"))
        self.pg_database = os.getenv("PGDATABASE", "rps_call_qa").strip()
        self.pg_user = os.getenv("PGUSER", "").strip()
        self.pg_password = os.getenv("PGPASSWORD", "")
        self.pg_sslmode = os.getenv("PGSSLMODE", "require").strip() or "require"
        self.pg_sslrootcert = os.getenv("PGSSLROOTCERT", "").strip()
        self.db_dual_write = os.getenv("DB_DUAL_WRITE", "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        self.google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
        self.session_secret = os.getenv("SESSION_SECRET", "dev-insecure-session").strip()
        self.app_url = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
        self.gcs_bucket = os.getenv("GCS_BUCKET", "").strip()
        self.s3_bucket = os.getenv("S3_BUCKET", "").strip()
        self.aws_region = os.getenv("AWS_REGION", "us-west-2").strip()
        # Call QA audit model (cheap/fast). Enable access in Bedrock console.
        self.bedrock_model_id = os.getenv(
            "BEDROCK_MODEL_ID",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ).strip()
        # Optional stronger model for weekly coaching narratives
        self.bedrock_coaching_model_id = os.getenv(
            "BEDROCK_COACHING_MODEL_ID",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        ).strip() or self.bedrock_model_id
        self.transcribe_language_code = os.getenv(
            "TRANSCRIBE_LANGUAGE_CODE", "en-US"
        ).strip()
        # Comma-separated codes for Amazon Transcribe IdentifyLanguage (en + es default).
        # Set to a single code (or empty) to force LanguageCode instead.
        raw_opts = os.getenv("TRANSCRIBE_LANGUAGE_OPTIONS", "en-US,es-US").strip()
        self.transcribe_language_options = [
            part.strip() for part in raw_opts.split(",") if part.strip()
        ]
        # Legacy Voice API (optional)
        self.vonage_api_key = os.getenv("VONAGE_API_KEY", "").strip()
        self.vonage_api_secret = os.getenv("VONAGE_API_SECRET", "").strip()
        self.vonage_signature_secret = os.getenv("VONAGE_SIGNATURE_SECRET", "").strip()
        # Vonage Business Communications (UC) — apimanager.uc.vonage.com
        self.vbc_client_id = os.getenv("VBC_CLIENT_ID", "").strip()
        self.vbc_client_secret = os.getenv("VBC_CLIENT_SECRET", "").strip()
        self.vbc_username = os.getenv("VBC_USERNAME", "").strip()
        self.vbc_password = os.getenv("VBC_PASSWORD", "").strip()
        self.vbc_account_id = os.getenv("VBC_ACCOUNT_ID", "self").strip() or "self"
        self.webhook_port = int(os.getenv("WEBHOOK_PORT", "8080"))
        self.allowed_email_domain = os.getenv(
            "ALLOWED_EMAIL_DOMAIN", "releviumpain.com"
        ).strip().lower()
        self.firebase_service_account = self._parse_service_account(
            os.getenv("FIREBASE_SERVICE_ACCOUNT", "")
        )
        # Outbound alerts (Google Chat incoming webhook)
        self.gchat_webhook_url = (
            os.getenv("GCHAT_WEBHOOK_URL", "").strip()
            or os.getenv("GOOGLE_CHAT_WEBHOOK_URL", "").strip()
        )
        # Optional separate Space for per-call missed-call alerts; falls back to main webhook.
        self.gchat_missed_calls_webhook_url = os.getenv(
            "GCHAT_MISSED_CALLS_WEBHOOK_URL", ""
        ).strip()
        self.alerts_master_enabled = os.getenv("ALERTS_ENABLED", "1").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.alerts_enabled = self.alerts_master_enabled and bool(self.gchat_webhook_url)
        self.missed_alert_window_minutes = int(
            os.getenv("MISSED_ALERT_WINDOW_MINUTES", "30")
        )
        self.missed_alert_threshold = int(os.getenv("MISSED_ALERT_THRESHOLD", "8"))
        # Shared secret for Next.js → poller ops endpoints (reanalyze / upload)
        self.ops_internal_token = os.getenv("OPS_INTERNAL_TOKEN", "").strip()
        self.poller_internal_url = os.getenv(
            "POLLER_INTERNAL_URL", "http://127.0.0.1:8080"
        ).strip().rstrip("/")
        # Twilio — optional SMS to caller on missed inbound CDRs (poller / CDR sync)
        self.twilio_account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
        self.twilio_auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        self.twilio_from_number = os.getenv("TWILIO_FROM_NUMBER", "").strip()
        # Default Customedico SMS sender; override with TWILIO_FROM_NUMBER_CUSTOMEDICO.
        self.twilio_from_number_customedico = os.getenv(
            "TWILIO_FROM_NUMBER_CUSTOMEDICO", "+17028197515"
        ).strip()
        self.twilio_missed_sms_enabled = os.getenv(
            "TWILIO_MISSED_SMS_ENABLED", "0"
        ).strip().lower() in {"1", "true", "yes", "on"}
        self.twilio_missed_sms_message = os.getenv("TWILIO_MISSED_SMS_MESSAGE", "").strip()
        self.twilio_missed_sms_message_customedico = os.getenv(
            "TWILIO_MISSED_SMS_MESSAGE_CUSTOMEDICO", ""
        ).strip()
        self.twilio_missed_sms_main_line = os.getenv(
            "TWILIO_MISSED_SMS_MAIN_LINE", ""
        ).strip()
        self.twilio_missed_sms_cooldown_minutes = int(
            os.getenv("TWILIO_MISSED_SMS_COOLDOWN_MINUTES", "90")
        )
        self.twilio_missed_sms_max_age_minutes = int(
            os.getenv("TWILIO_MISSED_SMS_MAX_AGE_MINUTES", "120")
        )
        self.twilio_status_callback_url = os.getenv(
            "TWILIO_STATUS_CALLBACK_URL", ""
        ).strip()

    @staticmethod
    def _parse_service_account(raw: str) -> dict[str, Any] | None:
        raw = (raw or "").strip()
        if not raw:
            return None
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("type") == "service_account":
                return data
        except json.JSONDecodeError:
            path = Path(raw).expanduser()
            if path.is_file():
                return json.loads(path.read_text())
        return None

    @property
    def oauth_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def firestore_configured(self) -> bool:
        return self.firebase_service_account is not None

    @property
    def postgres_configured(self) -> bool:
        return bool(
            self.database_url
            or (self.pg_host and self.pg_database and self.pg_user and self.pg_password)
        )

    @property
    def database_configured(self) -> bool:
        if self.database_backend == "postgres":
            return self.postgres_configured
        return self.firestore_configured

    @property
    def bedrock_configured(self) -> bool:
        return bool(self.bedrock_model_id)

    @property
    def ai_configured(self) -> bool:
        """Ready to run QA analysis (Bedrock model + S3 for Transcribe)."""
        return self.bedrock_configured and self.s3_configured

    @property
    def vbc_configured(self) -> bool:
        return bool(self.vbc_client_id and self.vbc_client_secret)

    @property
    def s3_configured(self) -> bool:
        return bool(self.s3_bucket)

    @property
    def twilio_configured(self) -> bool:
        return bool(
            self.twilio_account_sid
            and self.twilio_auth_token
            and self.twilio_from_number
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
