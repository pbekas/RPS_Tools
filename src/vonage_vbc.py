"""Vonage Business Communications (VBC) Call Recording API client.

Portal for creating API apps / keys: https://apimanager.uc.vonage.com
API docs: https://developer.vonage.com/en/vonage-business-cloud/call-recording/overview

Auth token endpoint: https://api.vonage.com/token
Recording base: https://api.vonage.com/t/vbc.prod/call_recording/
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import httpx

from src.config import get_settings

TOKEN_URL = "https://api.vonage.com/token"
RECORDING_API = "https://api.vonage.com/t/vbc.prod/call_recording"
AUTHORIZE_URL = "https://api.vonage.com/authorize"

_TOKEN_CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "vbc_token.json"


@dataclass
class VBCRecording:
    recording_id: str
    call_id: str | None
    call_direction: str | None
    caller_id: str | None
    cnam: str | None
    dnis: str | None
    extension: str | None
    duration_ms: int
    start: datetime | None
    end: datetime | None
    download_url: str
    raw: dict[str, Any]

    @property
    def duration_seconds(self) -> int:
        return max(0, int(round(self.duration_ms / 1000)))


class VonageVBCError(RuntimeError):
    pass


class VonageVBCClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.client_id = settings.vbc_client_id
        self.client_secret = settings.vbc_client_secret
        self.username = settings.vbc_username
        self.password = settings.vbc_password
        self.account_id = settings.vbc_account_id or "self"
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at: float = 0.0

        if not (self.client_id and self.client_secret):
            raise VonageVBCError(
                "VBC_CLIENT_ID and VBC_CLIENT_SECRET are required. "
                "Create an application at https://apimanager.uc.vonage.com "
                "and subscribe it to the Call Recording API."
            )

    # ── OAuth ──────────────────────────────────────────────────────────

    def get_access_token(self, force: bool = False) -> str:
        self._load_cached_token()
        if not force and self._access_token and time.time() < self._expires_at - 60:
            return self._access_token

        if self._refresh_token:
            try:
                return self._token_from_refresh()
            except VonageVBCError:
                pass

        if self.username and self.password:
            return self._token_from_password()

        raise VonageVBCError(
            "No valid VBC token. Set VBC_USERNAME + VBC_PASSWORD for password grant "
            "(server sync), or complete authorization_code flow and store a refresh token."
        )

    def _token_from_password(self) -> str:
        # Password grant requires username@vbc.prod
        username = self.username.strip()
        if not username.endswith("@vbc.prod"):
            username = f"{username}@vbc.prod"

        data = {
            "grant_type": "password",
            "scope": "openid",
            "username": username,
            "password": self.password,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        return self._post_token(data)

    def _token_from_refresh(self) -> str:
        data = {
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self._refresh_token or "",
        }
        return self._post_token(data)

    def exchange_authorization_code(self, code: str, redirect_uri: str) -> str:
        basic = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
        }
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(TOKEN_URL, data=data, headers=headers)
        return self._store_token_response(resp)

    def authorization_url(self, redirect_uri: str) -> str:
        from urllib.parse import urlencode

        params = {
            "scope": "openid",
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "client_id": self.client_id,
        }
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    def _post_token(self, data: dict[str, str]) -> str:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        return self._store_token_response(resp)

    def _store_token_response(self, resp: httpx.Response) -> str:
        if resp.status_code >= 400:
            raise VonageVBCError(
                f"Token request failed ({resp.status_code}): {resp.text[:500]}"
            )
        payload = resp.json()
        access = payload.get("access_token")
        if not access:
            raise VonageVBCError(f"No access_token in response: {payload}")
        self._access_token = access
        self._refresh_token = payload.get("refresh_token") or self._refresh_token
        expires_in = int(payload.get("expires_in") or 86400)
        self._expires_at = time.time() + expires_in
        self._save_cached_token()
        return access

    def _save_cached_token(self) -> None:
        _TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _TOKEN_CACHE_PATH.write_text(
            json.dumps(
                {
                    "access_token": self._access_token,
                    "refresh_token": self._refresh_token,
                    "expires_at": self._expires_at,
                }
            )
        )

    def _load_cached_token(self) -> None:
        if self._access_token:
            return
        if not _TOKEN_CACHE_PATH.exists():
            return
        try:
            data = json.loads(_TOKEN_CACHE_PATH.read_text())
            self._access_token = data.get("access_token")
            self._refresh_token = data.get("refresh_token")
            self._expires_at = float(data.get("expires_at") or 0)
        except Exception:
            pass

    # ── Recordings ─────────────────────────────────────────────────────

    def list_company_recordings(
        self,
        *,
        start_gte: datetime | None = None,
        start_lte: datetime | None = None,
        page: int = 0,
        page_size: int = 50,
        extension: str | None = None,
        call_direction: str | None = None,
        extra_params: dict[str, Any] | None = None,
    ) -> tuple[list[VBCRecording], dict[str, Any]]:
        params: dict[str, Any] = {
            "page": page,
            "page_size": page_size,
            "order": "start:DESC",
        }
        if start_gte:
            params["start:gte"] = _iso(start_gte)
        if start_lte:
            params["start:lte"] = _iso(start_lte)
        if extension:
            params["extension"] = extension
        if call_direction:
            params["call_direction"] = call_direction
        if extra_params:
            params.update(extra_params)

        url = f"{RECORDING_API}/api/accounts/{self.account_id}/company_call_recordings"
        data = self._get_json(url, params=params)
        recordings = [_parse_recording(item) for item in _embedded_recordings(data)]
        return recordings, data

    def iter_company_recordings(
        self,
        *,
        start_gte: datetime | None = None,
        start_lte: datetime | None = None,
        page_size: int = 50,
        max_pages: int = 100,
        **kwargs: Any,
    ) -> Iterator[VBCRecording]:
        for page in range(max_pages):
            rows, meta = self.list_company_recordings(
                start_gte=start_gte,
                start_lte=start_lte,
                page=page,
                page_size=page_size,
                **kwargs,
            )
            if not rows:
                break
            yield from rows
            # Stop if fewer than a full page
            if len(rows) < page_size:
                break
            # Some responses use 1-based page; if page 0 returns same as page 1, break on id set
            _ = meta

    def get_company_recording(self, recording_id: str) -> VBCRecording:
        url = (
            f"{RECORDING_API}/api/accounts/{self.account_id}/"
            f"company_call_recordings/{recording_id}"
        )
        data = self._get_json(url)
        return _parse_recording(data)

    def download_recording(self, recording: VBCRecording | str) -> bytes:
        if isinstance(recording, VBCRecording):
            url = recording.download_url or (
                f"{RECORDING_API}/api/audio/recording/{recording.recording_id}"
            )
            recording_id = recording.recording_id
        else:
            recording_id = recording
            url = f"{RECORDING_API}/api/audio/recording/{recording_id}"
            # Newer docs also show /v1/ path — try primary first
        token = self.get_access_token()
        with httpx.Client(timeout=180.0, follow_redirects=True) as client:
            resp = client.get(url, headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 404:
                alt = f"{RECORDING_API}/v1/api/audio/recording/{recording_id}"
                resp = client.get(alt, headers={"Authorization": f"Bearer {token}"})
            if resp.status_code >= 400:
                raise VonageVBCError(
                    f"Download failed for {recording_id} ({resp.status_code}): "
                    f"{resp.text[:300]}"
                )
            return resp.content

    def _get_json(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        token = self.get_access_token()
        with httpx.Client(timeout=60.0) as client:
            resp = client.get(
                url,
                params=params,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )
        if resp.status_code == 401:
            token = self.get_access_token(force=True)
            with httpx.Client(timeout=60.0) as client:
                resp = client.get(
                    url,
                    params=params,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )
        if resp.status_code >= 400:
            raise VonageVBCError(
                f"GET {url} failed ({resp.status_code}): {resp.text[:500]}"
            )
        return resp.json()


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _embedded_recordings(data: dict[str, Any]) -> list[dict[str, Any]]:
    embedded = data.get("_embedded") or {}
    rows = embedded.get("recordings") or data.get("recordings") or []
    if isinstance(rows, dict):
        rows = [rows]
    return list(rows)


def _parse_recording(item: dict[str, Any]) -> VBCRecording:
    # id may be nested under _links or top-level
    recording_id = str(
        item.get("id")
        or item.get("recording_id")
        or _id_from_href(item)
        or ""
    )
    download = item.get("download_url") or (
        f"{RECORDING_API}/api/audio/recording/{recording_id}" if recording_id else ""
    )
    return VBCRecording(
        recording_id=recording_id,
        call_id=item.get("call_id"),
        call_direction=item.get("call_direction"),
        caller_id=item.get("caller_id"),
        cnam=item.get("cnam"),
        dnis=item.get("dnis"),
        extension=item.get("extension"),
        duration_ms=int(item.get("duration") or 0),
        start=_parse_dt(item.get("start")),
        end=_parse_dt(item.get("end")),
        download_url=download,
        raw=item,
    )


def _id_from_href(item: dict[str, Any]) -> str | None:
    href = ((item.get("_links") or {}).get("self") or {}).get("href") or ""
    if not href:
        return None
    return href.rstrip("/").split("/")[-1]


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None
