"""Google Workspace SSO helpers for Streamlit."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx
import streamlit as st
from authlib.integrations.requests_client import OAuth2Session

from src.config import get_settings
from src import firestore_db as db

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = "openid email profile"


def _redirect_uri() -> str:
    settings = get_settings()
    return f"{settings.app_url}/"


def login_button() -> None:
    settings = get_settings()
    if not settings.oauth_configured:
        st.warning(
            "Google SSO is not fully configured. Set GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET in `.env`."
        )
        return

    params = {
        "client_id": settings.google_client_id,
        "response_type": "code",
        "scope": SCOPES,
        "redirect_uri": _redirect_uri(),
        "access_type": "online",
        "prompt": "select_account",
        "hd": settings.allowed_email_domain,
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    st.link_button("Sign in with Google", url, type="primary", use_container_width=True)


def handle_oauth_callback() -> dict[str, Any] | None:
    """If `?code=` is present, exchange for tokens and establish session user."""
    settings = get_settings()
    params = st.query_params
    code = params.get("code")
    if not code:
        return get_current_user()

    if not settings.oauth_configured:
        st.error("OAuth is not configured.")
        return None

    client = OAuth2Session(
        settings.google_client_id,
        settings.google_client_secret,
        scope=SCOPES,
        redirect_uri=_redirect_uri(),
    )
    try:
        token = client.fetch_token(
            GOOGLE_TOKEN_URL,
            code=code,
            grant_type="authorization_code",
        )
    except Exception as exc:  # noqa: BLE001
        st.error(f"Google sign-in failed: {exc}")
        st.query_params.clear()
        return None

    access_token = token.get("access_token")
    if not access_token:
        st.error("No access token returned from Google.")
        st.query_params.clear()
        return None

    resp = httpx.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if resp.status_code != 200:
        st.error("Could not fetch Google user profile.")
        st.query_params.clear()
        return None

    profile = resp.json()
    email = (profile.get("email") or "").strip().lower()
    name = profile.get("name") or email
    domain = settings.allowed_email_domain

    if not email.endswith(f"@{domain}"):
        st.error(f"Only @{domain} accounts are allowed.")
        st.query_params.clear()
        return None

    user = _resolve_app_user(email=email, name=name)
    st.session_state["user"] = user
    st.query_params.clear()
    st.rerun()
    return user


def _resolve_app_user(*, email: str, name: str) -> dict[str, Any]:
    """Load role from Firestore Users; bootstrap Agent if missing."""
    settings = get_settings()
    if settings.firestore_configured:
        try:
            existing = db.get_user(email)
            if existing:
                return {
                    "email": existing["email"],
                    "name": existing.get("name") or name,
                    "role": existing.get("role") or "Agent",
                    "rolling_ai_feedback": existing.get("rolling_ai_feedback") or "",
                }
            # First login: create as Agent (promote first Admin manually in Firestore)
            created = db.upsert_user(email=email, name=name, role="Agent")
            return {
                "email": created["email"],
                "name": created.get("name") or name,
                "role": created.get("role") or "Agent",
                "rolling_ai_feedback": "",
            }
        except Exception as exc:  # noqa: BLE001
            st.warning(f"Firestore user lookup failed ({exc}). Using session-only role.")

    # Dev fallback when Firestore is not ready
    return {
        "email": email,
        "name": name,
        "role": "Admin" if email.startswith("admin") or "bekas" in email else "Agent",
        "rolling_ai_feedback": "",
    }


def get_current_user() -> dict[str, Any] | None:
    return st.session_state.get("user")


def require_login() -> dict[str, Any] | None:
    user = handle_oauth_callback()
    if user:
        return user

    st.title("RPS Call QA")
    st.caption("Relevium Pain Specialists — phone quality review")
    st.info(
        f"Sign in with your @{get_settings().allowed_email_domain} Google account."
    )
    login_button()

    # Local/dev bypass when OAuth or Firestore still being wired
    with st.expander("Developer sign-in (local only)"):
        email = st.text_input("Email", value="pb@releviumpain.com")
        name = st.text_input("Name", value="Pete Bekas")
        role = st.selectbox("Role", ["Admin", "Agent"])
        if st.button("Continue as this user"):
            domain = get_settings().allowed_email_domain
            if not email.lower().endswith(f"@{domain}"):
                st.error(f"Email must end with @{domain}")
            else:
                st.session_state["user"] = {
                    "email": email.lower(),
                    "name": name,
                    "role": role,
                    "rolling_ai_feedback": "",
                }
                st.rerun()
    return None


def logout() -> None:
    st.session_state.pop("user", None)
    st.rerun()


def is_admin(user: dict[str, Any]) -> bool:
    return (user.get("role") or "").lower() == "admin"
