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

    def __init__(self) -> None:
        self.google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        self.google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
        self.session_secret = os.getenv("SESSION_SECRET", "dev-insecure-session").strip()
        self.app_url = os.getenv("APP_URL", "http://localhost:8501").rstrip("/")
        self.gcs_bucket = os.getenv("GCS_BUCKET", "").strip()
        self.s3_bucket = os.getenv("S3_BUCKET", "").strip()
        self.aws_region = os.getenv("AWS_REGION", "us-west-2").strip()
        # Claude on Bedrock — enable model access in AWS console for this region
        self.bedrock_model_id = os.getenv(
            "BEDROCK_MODEL_ID",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        ).strip()
        self.transcribe_language_code = os.getenv(
            "TRANSCRIBE_LANGUAGE_CODE", "en-US"
        ).strip()
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
