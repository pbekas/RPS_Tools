#!/usr/bin/env python3
"""Delete leftover call-import users (provisional / unmapped.*).

Directory people from Workspace are left alone, including bootstrap admins.

Usage:
  python scripts/purge_imported_users.py
  python scripts/purge_imported_users.py --dry-run
"""

from __future__ import annotations

import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge call-imported users")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from src.postgres_db import get_connection

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT email, name, provisional
            FROM users
            WHERE (
                coalesce(provisional, false) = true
                OR email::text ILIKE %s
            )
            AND NOT (email = ANY(%s::citext[]))
            ORDER BY email
            """,
            ("unmapped.%", sorted(BOOTSTRAP_ADMINS)),
        ).fetchall()
        to_delete = [str(r["email"]).lower() for r in rows]
        print(f"imported_users={len(to_delete)}")
        if to_delete:
            preview = ", ".join(to_delete[:40])
            print("delete:", preview, ("…" if len(to_delete) > 40 else ""))
        if args.dry_run or not to_delete:
            remaining = conn.execute("SELECT count(*) AS n FROM users").fetchone()
            print(f"users_now={remaining['n']}")
            return

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
        conn.commit()
        print(f"users_now={remaining['n']}")


if __name__ == "__main__":
    main()
