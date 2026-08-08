#!/usr/bin/env python3
"""Apply ordered SQL migrations to PostgreSQL.

Migrations are immutable after application. The runner records a SHA-256 checksum
and refuses to continue if an already-applied migration was edited.

Usage:
  DATABASE_URL=postgresql://... python scripts/migrate_postgres.py
  python scripts/migrate_postgres.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MIGRATIONS_DIR = ROOT / "db" / "migrations"


def _migration_files() -> list[Path]:
    return sorted(
        path
        for path in MIGRATIONS_DIR.glob("*.sql")
        if path.is_file() and path.name[:1].isdigit()
    )


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply PostgreSQL schema migrations")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List migrations without connecting or applying them",
    )
    args = parser.parse_args()

    migrations = _migration_files()
    if not migrations:
        raise SystemExit(f"No migrations found in {MIGRATIONS_DIR}")

    if args.dry_run:
        for path in migrations:
            sql = path.read_text()
            print(f"{path.name} sha256={_checksum(sql)}")
        return

    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit(
            "psycopg is required; install project requirements first"
        ) from exc

    from src.postgres_db import connection_config

    conninfo, kwargs = connection_config()
    with psycopg.connect(conninfo, **kwargs, autocommit=True) as conn:
        # The first migration creates this table; create it defensively so every
        # migration, including 001, can be tracked consistently.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )

        applied = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT version, checksum FROM schema_migrations"
            ).fetchall()
        }

        for path in migrations:
            version = path.stem
            sql = path.read_text()
            checksum = _checksum(sql)
            previous = applied.get(version)
            if previous:
                if previous != checksum:
                    raise SystemExit(
                        f"Refusing to run: {path.name} changed after application"
                    )
                print(f"skip {path.name} (already applied)")
                continue

            print(f"apply {path.name}")
            with conn.transaction():
                conn.execute(sql)
                conn.execute(
                    """
                    INSERT INTO schema_migrations (version, checksum)
                    VALUES (%s, %s)
                    """,
                    (version, checksum),
                )
            print(f"done  {path.name}")


if __name__ == "__main__":
    main()
