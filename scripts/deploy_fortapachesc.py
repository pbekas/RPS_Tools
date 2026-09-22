#!/usr/bin/env python3
"""Deploy the Fort Apache Surgery Center static site to S3 + CloudFront."""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
ACCOUNT = "013908492747"
BUCKET = f"fortapachesc-site-{ACCOUNT}"
COMMENT = "Fort Apache Surgery Center"
DOMAIN = "fortapachesc.com"
SITE_ROOT = Path(__file__).resolve().parents[1] / "fortapachesc"
SKIP = {"README.md"}

s3 = boto3.client("s3", region_name=REGION)
cf = boto3.client("cloudfront")
acm = boto3.client("acm", region_name=REGION)
sts = boto3.client("sts")


def ensure_bucket() -> None:
    try:
        s3.head_bucket(Bucket=BUCKET)
        print(f"Bucket exists: {BUCKET}")
    except ClientError:
        s3.create_bucket(Bucket=BUCKET)
        print(f"Created bucket: {BUCKET}")
    s3.put_public_access_block(
        Bucket=BUCKET,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )


def upload_site() -> None:
    extra_types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    uploaded = 0
    for path in SITE_ROOT.rglob("*"):
        if not path.is_file() or path.name in SKIP:
            continue
        key = path.relative_to(SITE_ROOT).as_posix()
        content_type = extra_types.get(path.suffix.lower())
        if not content_type:
            guessed, _ = mimetypes.guess_type(path.name)
            content_type = guessed or "application/octet-stream"
        cache = (
            "no-cache"
            if path.suffix.lower() in {".html", ".js", ".css"}
            else "public, max-age=86400"
        )
        s3.upload_file(
            str(path),
            BUCKET,
            key,
            ExtraArgs={"ContentType": content_type, "CacheControl": cache},
        )
        uploaded += 1
    print(f"Uploaded {uploaded} files to s3://{BUCKET}")


def ensure_oac() -> str:
    for page in cf.get_paginator("list_origin_access_controls").paginate():
        for item in page.get("OriginAccessControlList", {}).get("Items", []):
            if item.get("Name") == "fortapachesc-oac":
                print(f"OAC exists: {item['Id']}")
                return item["Id"]
    resp = cf.create_origin_access_control(
        OriginAccessControlConfig={
            "Name": "fortapachesc-oac",
            "Description": COMMENT,
            "SigningProtocol": "sigv4",
            "SigningBehavior": "always",
            "OriginAccessControlOriginType": "s3",
        }
    )
    oac_id = resp["OriginAccessControl"]["Id"]
    print(f"Created OAC: {oac_id}")
    return oac_id


def find_distribution() -> dict | None:
    paginator = cf.get_paginator("list_distributions")
    for page in paginator.paginate():
        items = page.get("DistributionList", {}).get("Items") or []
        for item in items:
            if item.get("Comment") == COMMENT:
                return item
            origins = item.get("Origins", {}).get("Items") or []
            if any(BUCKET in (o.get("DomainName") or "") for o in origins):
                return item
    return None


def ensure_distribution(oac_id: str) -> tuple[str, str]:
    existing = find_distribution()
    origin_domain = f"{BUCKET}.s3.{REGION}.amazonaws.com"
    if existing:
        dist_id = existing["Id"]
        domain = existing["DomainName"]
        print(f"Distribution exists: {dist_id} -> https://{domain}")
        return dist_id, domain

    resp = cf.create_distribution(
        DistributionConfig={
            "CallerReference": f"fortapachesc-{int(time.time())}",
            "Comment": COMMENT,
            "Enabled": True,
            "DefaultRootObject": "index.html",
            "Origins": {
                "Quantity": 1,
                "Items": [
                    {
                        "Id": "s3-fortapachesc",
                        "DomainName": origin_domain,
                        "S3OriginConfig": {"OriginAccessIdentity": ""},
                        "OriginAccessControlId": oac_id,
                    }
                ],
            },
            "DefaultCacheBehavior": {
                "TargetOriginId": "s3-fortapachesc",
                "ViewerProtocolPolicy": "redirect-to-https",
                "AllowedMethods": {
                    "Quantity": 2,
                    "Items": ["GET", "HEAD"],
                    "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
                },
                "Compress": True,
                "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            },
            "CustomErrorResponses": {
                "Quantity": 1,
                "Items": [
                    {
                        "ErrorCode": 403,
                        "ResponsePagePath": "/index.html",
                        "ResponseCode": "200",
                        "ErrorCachingMinTTL": 60,
                    }
                ],
            },
            "PriceClass": "PriceClass_100",
            "HttpVersion": "http2",
            "ViewerCertificate": {"CloudFrontDefaultCertificate": True},
        }
    )
    dist = resp["Distribution"]
    print(f"Created distribution: {dist['Id']} -> https://{dist['DomainName']}")
    return dist["Id"], dist["DomainName"]


def attach_bucket_policy(distribution_id: str) -> None:
    account = sts.get_caller_identity()["Account"]
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowCloudFrontRead",
                "Effect": "Allow",
                "Principal": {"Service": "cloudfront.amazonaws.com"},
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{BUCKET}/*",
                "Condition": {
                    "StringEquals": {
                        "AWS:SourceArn": f"arn:aws:cloudfront::{account}:distribution/{distribution_id}"
                    }
                },
            }
        ],
    }
    s3.put_bucket_policy(Bucket=BUCKET, Policy=__import__("json").dumps(policy))
    print("Attached CloudFront bucket policy")


def invalidate(distribution_id: str) -> None:
    cf.create_invalidation(
        DistributionId=distribution_id,
        InvalidationBatch={
            "CallerReference": str(int(time.time())),
            "Paths": {"Quantity": 1, "Items": ["/*"]},
        },
    )
    print("Created CloudFront invalidation for /*")


def ensure_certificate() -> dict:
    certs = acm.list_certificates(CertificateStatuses=["PENDING_VALIDATION", "ISSUED"])
    for item in certs.get("CertificateSummaryList", []):
        if item.get("DomainName") == DOMAIN:
            detail = acm.describe_certificate(CertificateArn=item["CertificateArn"])[
                "Certificate"
            ]
            print(f"ACM cert {detail['Status']}: {detail['CertificateArn']}")
            return detail
    arn = acm.request_certificate(
        DomainName=DOMAIN,
        ValidationMethod="DNS",
        SubjectAlternativeNames=[f"www.{DOMAIN}"],
        Options={"CertificateTransparencyLoggingPreference": "ENABLED"},
    )["CertificateArn"]
    print(f"Requested ACM cert: {arn}")
    for _ in range(12):
        detail = acm.describe_certificate(CertificateArn=arn)["Certificate"]
        records = detail.get("DomainValidationOptions") or []
        if records and records[0].get("ResourceRecord"):
            return detail
        time.sleep(2)
    return acm.describe_certificate(CertificateArn=arn)["Certificate"]


def print_dns_steps(cert: dict, cloudfront_domain: str) -> None:
    print("\n=== Cloudflare steps remaining ===")
    if cert.get("Status") != "ISSUED":
        print("1) ACM is still validating. Keep these DNS-only (grey cloud):")
        seen = set()
        for option in cert.get("DomainValidationOptions") or []:
            rec = option.get("ResourceRecord") or {}
            name, value = rec.get("Name"), rec.get("Value")
            if not name or not value or name in seen:
                continue
            seen.add(name)
            print(f"   CNAME  {name}  ->  {value}")
    print("2) Point the site at CloudFront (orange cloud is fine):")
    print(f"   CNAME  {DOMAIN}      ->  {cloudfront_domain}")
    print(f"   CNAME  www           ->  {cloudfront_domain}")
    print("   Remove any leftover IONOS A/AAAA records on www.")
    print("3) SSL/TLS mode: Full (strict).")


def attach_custom_domain(distribution_id: str, cert: dict) -> bool:
    if cert.get("Status") != "ISSUED":
        print(f"ACM still {cert.get('Status')}; not attaching custom domain yet.")
        return False
    arn = cert["CertificateArn"]
    current = cf.get_distribution_config(Id=distribution_id)
    etag = current["ETag"]
    config = current["DistributionConfig"]
    aliases = set(config.get("Aliases", {}).get("Items") or [])
    wanted = {DOMAIN, f"www.{DOMAIN}"}
    viewer = config.get("ViewerCertificate") or {}
    if wanted <= aliases and viewer.get("ACMCertificateArn") == arn:
        print("Custom domain already attached to CloudFront.")
        return True
    config["Aliases"] = {"Quantity": 2, "Items": sorted(wanted)}
    config["ViewerCertificate"] = {
        "ACMCertificateArn": arn,
        "SSLSupportMethod": "sni-only",
        "MinimumProtocolVersion": "TLSv1.2_2021",
    }
    cf.update_distribution(
        Id=distribution_id, IfMatch=etag, DistributionConfig=config
    )
    print(f"Attached {DOMAIN} and www.{DOMAIN} to CloudFront.")
    return True


def main() -> None:
    identity = sts.get_caller_identity()
    print(f"AWS {identity['Account']} as {identity['Arn']}")
    ensure_bucket()
    upload_site()
    oac_id = ensure_oac()
    dist_id, cf_domain = ensure_distribution(oac_id)
    attach_bucket_policy(dist_id)
    invalidate(dist_id)
    cert = ensure_certificate()
    attach_custom_domain(dist_id, cert)
    print(f"\nLive origin: https://{cf_domain}")
    print_dns_steps(cert, cf_domain)


if __name__ == "__main__":
    main()
