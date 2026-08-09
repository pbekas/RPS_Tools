"""Extract text from contract documents via Amazon Textract."""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlparse

import boto3

from src.config import get_settings

logger = logging.getLogger(__name__)


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValueError(f"Expected s3://bucket/key URI, got: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def extract_text_from_s3(
    *,
    s3_uri: str | None = None,
    bucket: str | None = None,
    key: str | None = None,
    max_wait_seconds: int = 180,
) -> str:
    """
    Run Textract on an S3 object and return plain text.

    Uses DetectDocumentText for single-page/sync-friendly images when possible,
    otherwise StartDocumentTextDetection for multi-page PDFs.
    """
    settings = get_settings()
    if s3_uri:
        bucket, key = _parse_s3_uri(s3_uri)
    if not bucket or not key:
        raise ValueError("bucket/key or s3_uri is required")

    client = boto3.client("textract", region_name=settings.aws_region)
    lower = key.lower()

    # Sync DetectDocumentText works for PNG/JPEG/TIFF (not multipage PDF).
    if lower.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff")):
        resp = client.detect_document_text(
            Document={"S3Object": {"Bucket": bucket, "Name": key}}
        )
        return _blocks_to_text(resp.get("Blocks") or [])

    # Async text detection for PDFs / larger docs.
    start = client.start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    job_id = start["JobId"]
    deadline = time.time() + max_wait_seconds
    next_token: str | None = None
    lines: list[str] = []

    while True:
        if time.time() > deadline:
            raise TimeoutError(f"Textract job timed out: {job_id}")
        kwargs: dict[str, Any] = {"JobId": job_id}
        if next_token:
            kwargs["NextToken"] = next_token
        status = client.get_document_text_detection(**kwargs)
        job_status = status.get("JobStatus")
        if job_status == "FAILED":
            raise RuntimeError(
                f"Textract failed: {status.get('StatusMessage') or 'unknown error'}"
            )
        if job_status == "IN_PROGRESS":
            time.sleep(2)
            continue
        lines.extend(_blocks_to_text_lines(status.get("Blocks") or []))
        next_token = status.get("NextToken")
        if not next_token:
            break

    text = "\n".join(lines).strip()
    if not text:
        logger.warning("Textract returned empty text for s3://%s/%s", bucket, key)
    return text


def _blocks_to_text(blocks: list[dict[str, Any]]) -> str:
    return "\n".join(_blocks_to_text_lines(blocks)).strip()


def _blocks_to_text_lines(blocks: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        if block.get("BlockType") == "LINE" and block.get("Text"):
            lines.append(str(block["Text"]))
    return lines
