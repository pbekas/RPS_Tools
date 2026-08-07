"""Vonage Business Communications Reports API — call logs (CDRs).

Requires the Reports API suite subscription on the VBC application.
Docs: https://developer.vonage.com/en/api/vonage-business-cloud/reports

Endpoint:
  GET https://api.vonage.com/t/vbc.prod/reports/v1/accounts/{account_id}/call-logs
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterator

from src.vonage_vbc import VonageVBCClient, VonageVBCError

# Official snippets use /reports/v1/; OpenAPI omits v1 — try v1 first.
REPORTS_API = "https://api.vonage.com/t/vbc.prod/reports/v1"


@dataclass
class VBCCallLog:
    log_id: str
    direction: str | None
    from_number: str | None
    to_number: str | None
    result: str | None
    recorded: bool | None
    length_seconds: int
    start: datetime | None
    end: datetime | None
    source_user: str | None
    source_user_full_name: str | None
    source_extension: str | None
    destination_user: str | None
    destination_user_full_name: str | None
    destination_extension: str | None
    custom_tag: str | None
    in_network: bool | None
    international: bool | None
    raw: dict[str, Any]

    @property
    def is_missed(self) -> bool:
        result = (self.result or "").strip().lower()
        if not result:
            return False
        if result in {"answered", "connected"}:
            return False
        # Missed, Abandoned, Voicemail, Busy, No Answer, etc.
        return True

    @property
    def is_unrecorded(self) -> bool:
        return self.recorded is False


class VonageReportsClient:
    """Call-log client that reuses VBC OAuth from VonageVBCClient."""

    def __init__(self, vbc: VonageVBCClient | None = None) -> None:
        self.vbc = vbc or VonageVBCClient()

    def list_call_logs(
        self,
        *,
        start_gte: datetime | None = None,
        start_lte: datetime | None = None,
        end_gte: datetime | None = None,
        end_lte: datetime | None = None,
        page: int = 1,
        page_size: int = 50,
        direction: str | None = None,
        from_number: str | None = None,
        to_number: str | None = None,
        source_user: str | None = None,
        destination_user: str | None = None,
    ) -> tuple[list[VBCCallLog], dict[str, Any]]:
        params: dict[str, Any] = {
            "page": page,
            "page_size": page_size,
        }
        if start_gte:
            params["start:gte"] = _reports_dt(start_gte)
        if start_lte:
            params["start:lte"] = _reports_dt(start_lte)
        if end_gte:
            params["end:gte"] = _reports_dt(end_gte)
        if end_lte:
            params["end:lte"] = _reports_dt(end_lte)
        if direction:
            # API expects Inbound / Outbound
            params["direction"] = direction
        if from_number:
            params["from"] = from_number
        if to_number:
            params["to"] = to_number
        if source_user:
            params["source_user"] = source_user
        if destination_user:
            params["destination_user"] = destination_user

        url = f"{REPORTS_API}/accounts/{self.vbc.reports_account_id()}/call-logs"
        data = self.vbc._get_json(url, params=params)
        logs = [_parse_call_log(item) for item in _embedded_call_logs(data)]
        return logs, data

    def iter_call_logs(
        self,
        *,
        start_gte: datetime | None = None,
        start_lte: datetime | None = None,
        page_size: int = 50,
        max_pages: int = 100,
        **kwargs: Any,
    ) -> Iterator[VBCCallLog]:
        for page in range(1, max_pages + 1):
            rows, _meta = self.list_call_logs(
                start_gte=start_gte,
                start_lte=start_lte,
                page=page,
                page_size=page_size,
                **kwargs,
            )
            if not rows:
                break
            yield from rows
            if len(rows) < page_size:
                break


def _reports_dt(dt: datetime) -> str:
    """Reports API wants yyyy-MM-dd HH:mm:ss in UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _embedded_call_logs(data: dict[str, Any]) -> list[dict[str, Any]]:
    embedded = data.get("_embedded") or {}
    rows = embedded.get("call_logs") or data.get("call_logs") or []
    return rows if isinstance(rows, list) else []


def _parse_call_log(item: dict[str, Any]) -> VBCCallLog:
    return VBCCallLog(
        log_id=str(item.get("id") or "").strip(),
        direction=_str_or_none(item.get("direction")),
        from_number=_str_or_none(item.get("from")),
        to_number=_str_or_none(item.get("to")),
        result=_str_or_none(item.get("result")),
        recorded=_bool_or_none(item.get("recorded")),
        length_seconds=_int_seconds(item.get("length")),
        start=_parse_reports_dt(item.get("start")),
        end=_parse_reports_dt(item.get("end")),
        source_user=_str_or_none(item.get("source_user")),
        source_user_full_name=_str_or_none(item.get("source_user_full_name")),
        source_extension=_str_or_none(item.get("source_extension")),
        destination_user=_str_or_none(item.get("destination_user")),
        destination_user_full_name=_str_or_none(item.get("destination_user_full_name")),
        destination_extension=_str_or_none(item.get("destination_extension")),
        custom_tag=_str_or_none(item.get("custom_tag")),
        in_network=_bool_or_none(item.get("in_network")),
        international=_bool_or_none(item.get("international")),
        raw=item,
    )


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _bool_or_none(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value).strip().lower()
    if s in {"true", "1", "yes"}:
        return True
    if s in {"false", "0", "no"}:
        return False
    return None


def _int_seconds(value: Any) -> int:
    try:
        return max(0, int(round(float(value or 0))))
    except (TypeError, ValueError):
        return 0


def _parse_reports_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            cleaned = text.replace("+0000", "+00:00")
            dt = datetime.strptime(
                cleaned if "%z" not in fmt else text.replace("Z", "+0000"),
                fmt,
            )
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise VonageVBCError(f"Unparseable call-log datetime: {value!r}") from exc
