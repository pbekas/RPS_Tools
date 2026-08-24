#!/usr/bin/env python3
"""Replace the users table with a Google Workspace user export.

Keeps bootstrap admin emails even if they are missing from the CSV.
Existing roles/modules are preserved for emails that already exist.

Usage:
  python scripts/sync_directory_users.py --csv path/to/export.csv
  python scripts/sync_directory_users.py --s3 s3://bucket/key.csv
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from pathlib import Path

def _app_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here.parent.parent, Path("/app"), Path.cwd()):
        if (candidate / "src" / "postgres_db.py").is_file():
            return candidate
    return here.parent.parent


ROOT = _app_root()
sys.path.insert(0, str(ROOT))

BOOTSTRAP_ADMINS = {
    "pb@octanesolutiongroup.com",
    "pb@releviumpain.com",
    "pete@releviumpain.com",
    "pete.bekas@releviumpain.com",
}


def _load_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for raw in reader:
        email = (raw.get("Email Address [Required]") or "").strip().lower()
        if not email or "@" not in email:
            continue
        first = (raw.get("First Name [Required]") or "").strip()
        last = (raw.get("Last Name [Required]") or "").strip()
        name = " ".join(part for part in (first, last) if part) or email
        status = (raw.get("Status [READ ONLY]") or "Active").strip()
        rows.append(
            {
                "email": email,
                "name": name,
                "active": "true" if status.lower() == "active" else "false",
            }
        )
    return rows


def _read_source(csv_path: str | None, s3_uri: str | None) -> str:
    if csv_path:
        return Path(csv_path).read_text(encoding="utf-8-sig")
    if not s3_uri or not s3_uri.startswith("s3://"):
        raise SystemExit("Provide --csv or --s3 s3://bucket/key")
    import boto3

    _, _, rest = s3_uri.partition("s3://")
    bucket, _, key = rest.partition("/")
    body = boto3.client("s3").get_object(Bucket=bucket, Key=key)["Body"].read()
    return body.decode("utf-8-sig")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync users from a Workspace CSV")
    parser.add_argument("--csv", help="Local CSV path")
    parser.add_argument("--s3", help="s3://bucket/key CSV")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing",
    )
    args = parser.parse_args()

    directory = _load_csv(_read_source(args.csv, args.s3))
    if not directory:
        raise SystemExit("No users found in CSV")

    keep = {row["email"] for row in directory} | BOOTSTRAP_ADMINS
    from src.postgres_db import get_connection

    with get_connection() as conn:
        existing = {
            str(row["email"]).lower(): row
            for row in conn.execute("SELECT email, name, role, active FROM users").fetchall()
        }
        to_delete = sorted(set(existing) - keep)
        to_insert = [row for row in directory if row["email"] not in existing]
        print(f"csv={len(directory)} existing={len(existing)} insert={len(to_insert)} delete={len(to_delete)}")
        if to_delete:
            print("delete:", ", ".join(to_delete[:30]), ("…" if len(to_delete) > 30 else ""))
        if args.dry_run:
            return

        for row in directory:
            role = "Admin" if row["email"] in BOOTSTRAP_ADMINS else None
            conn.execute(
                """
                INSERT INTO users (email, name, role, active, provisional)
                VALUES (%s, %s, COALESCE(%s, 'Agent'), %s, false)
                ON CONFLICT (email) DO UPDATE SET
                    name = EXCLUDED.name,
                    active = EXCLUDED.active,
                    role = CASE
                        WHEN EXCLUDED.email = ANY(%s::citext[]) THEN 'Admin'
                        ELSE users.role
                    END,
                    provisional = false,
                    updated_at = now()
                """,
                (
                    row["email"],
                    row["name"],
                    role,
                    row["active"] == "true",
                    sorted(BOOTSTRAP_ADMINS),
                ),
            )

        for email in BOOTSTRAP_ADMINS:
            if email in existing or email in keep:
                conn.execute(
                    """
                    UPDATE users
                    SET role = 'Admin', active = true, updated_at = now()
                    WHERE email = %s
                    """,
                    (email,),
                )

        if to_delete:
            conn.execute(
                """
                UPDATE users
                SET linked_to = NULL
                WHERE linked_to = ANY(%s::citext[])
                """,
                (to_delete,),
            )
            conn.execute(
                "DELETE FROM users WHERE email = ANY(%s::citext[])",
                (to_delete,),
            )

        remaining = conn.execute("SELECT count(*) AS n FROM users").fetchone()
        admins = conn.execute(
            "SELECT email FROM users WHERE role = 'Admin' ORDER BY email"
        ).fetchall()
        conn.commit()
        print(f"users_now={remaining['n']}")
        print("admins:", ", ".join(str(r["email"]) for r in admins))


if __name__ == "__main__":
    main()
