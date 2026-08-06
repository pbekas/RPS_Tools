"""Audio recording storage — prefer AWS S3 when configured, else GCS, else local."""

from __future__ import annotations

import mimetypes
from datetime import timedelta
from pathlib import Path
from typing import BinaryIO

from src.config import get_settings


def upload_recording(
    *,
    local_path: str | Path,
    destination_blob: str,
    content_type: str | None = None,
) -> tuple[str, str]:
    """
    Upload a recording.
    Returns (storage_uri, playable_url).
    """
    settings = get_settings()
    path = Path(local_path)
    mime = content_type or mimetypes.guess_type(str(path))[0] or "audio/mpeg"

    if settings.s3_configured:
        return _upload_s3(path, destination_blob, mime)
    if settings.gcs_bucket and settings.firebase_service_account:
        return _upload_gcs(path, destination_blob, mime)
    return "", ""


def upload_fileobj(
    *,
    fileobj: BinaryIO,
    destination_blob: str,
    content_type: str = "audio/mpeg",
) -> tuple[str, str]:
    settings = get_settings()
    if settings.s3_configured:
        import boto3

        client = boto3.client("s3", region_name=settings.aws_region)
        fileobj.seek(0)
        client.upload_fileobj(
            fileobj,
            settings.s3_bucket,
            destination_blob,
            ExtraArgs={"ContentType": content_type},
        )
        uri = f"s3://{settings.s3_bucket}/{destination_blob}"
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": destination_blob},
            ExpiresIn=7 * 24 * 3600,
        )
        return uri, url

    if settings.gcs_bucket and settings.firebase_service_account:
        from google.cloud import storage
        from google.oauth2 import service_account

        creds = service_account.Credentials.from_service_account_info(
            settings.firebase_service_account
        )
        gcs = storage.Client(
            project=settings.firebase_service_account.get("project_id"),
            credentials=creds,
        )
        blob = gcs.bucket(settings.gcs_bucket).blob(destination_blob)
        fileobj.seek(0)
        blob.upload_from_file(fileobj, content_type=content_type)
        uri = f"gs://{settings.gcs_bucket}/{destination_blob}"
        try:
            url = blob.generate_signed_url(
                version="v4", expiration=timedelta(days=7), method="GET"
            )
        except Exception:
            url = blob.public_url
        return uri, url

    return "", ""


def _upload_s3(path: Path, key: str, content_type: str) -> tuple[str, str]:
    import boto3

    settings = get_settings()
    client = boto3.client("s3", region_name=settings.aws_region)
    client.upload_file(
        str(path),
        settings.s3_bucket,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    uri = f"s3://{settings.s3_bucket}/{key}"
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=7 * 24 * 3600,
    )
    return uri, url


def _upload_gcs(path: Path, destination_blob: str, content_type: str) -> tuple[str, str]:
    from google.cloud import storage
    from google.oauth2 import service_account

    settings = get_settings()
    creds = service_account.Credentials.from_service_account_info(
        settings.firebase_service_account
    )
    client = storage.Client(
        project=settings.firebase_service_account.get("project_id"),
        credentials=creds,
    )
    blob = client.bucket(settings.gcs_bucket).blob(destination_blob)
    blob.upload_from_filename(str(path), content_type=content_type)
    uri = f"gs://{settings.gcs_bucket}/{destination_blob}"
    try:
        url = blob.generate_signed_url(
            version="v4", expiration=timedelta(days=7), method="GET"
        )
    except Exception:
        url = blob.public_url
    return uri, url
