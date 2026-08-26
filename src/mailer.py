"""Outbound email via Amazon SES."""

from __future__ import annotations

import logging
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from src.config import get_settings

logger = logging.getLogger(__name__)


def send_email(
    *,
    to: str,
    subject: str,
    text: str,
    html: str | None = None,
    reply_to: str | None = None,
) -> bool:
    """Send a single email. Returns True if SES accepted the message."""
    settings = get_settings()
    source = (settings.ses_from_email or "").strip()
    recipient = (to or "").strip()
    if not source:
        logger.debug("SES_FROM_EMAIL not set — skip email")
        return False
    if not recipient or "@" not in recipient:
        logger.warning("Skip email with invalid recipient %r", to)
        return False

    body: dict[str, Any] = {
        "Text": {"Data": text, "Charset": "UTF-8"},
    }
    if html:
        body["Html"] = {"Data": html, "Charset": "UTF-8"}

    kwargs: dict[str, Any] = {
        "Source": source,
        "Destination": {"ToAddresses": [recipient]},
        "Message": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": body,
        },
    }
    reply = (reply_to or "").strip()
    if reply:
        kwargs["ReplyToAddresses"] = [reply]

    try:
        client = boto3.client("ses", region_name=settings.aws_region)
        client.send_email(**kwargs)
        return True
    except (BotoCoreError, ClientError):
        logger.exception("SES send failed to %s", recipient)
        return False
