#!/usr/bin/env python3
"""Copy application tables from a source Postgres into a destination Postgres.

Used to promote the staging Firestore backfill into production RDS. Contract
catalog tables are left untouched. Credentials come from SRC_PG* and DST_PG*
environment variables (same shape as libpq).
"""

from __future__ import annotations

import os
import sys

import psycopg
from psycopg.rows import dict_row

TABLES = (
    "users",
    "config_sets",
    "calls",
    "call_rule_results",
    "call_flag_results",
    "call_logs",
    "feedback",
    "weekly_metrics",
    "alert_state",
    "access_audit",
)

TRUNCATE_ORDER = tuple(reversed(TABLES))


def connect(prefix: str) -> psycopg.Connection:
    kwargs: dict[str, object] = {
        "host": os.environ[f"{prefix}HOST"],
        "port": os.environ.get(f"{prefix}PORT", "5432"),
        "dbname": os.environ[f"{prefix}DATABASE"],
        "user": os.environ[f"{prefix}USER"],
        "password": os.environ[f"{prefix}PASSWORD"],
        "sslmode": os.environ.get("PGSSLMODE", "verify-full"),
        "row_factory": dict_row,
        "connect_timeout": 30,
    }
    cert = os.environ.get("PGSSLROOTCERT", "").strip()
    if cert:
        kwargs["sslrootcert"] = cert
    return psycopg.connect(**kwargs)


def columns(conn: psycopg.Connection, table: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return [str(row["column_name"]) for row in rows]


def copy_table(
    src: psycopg.Connection,
    dst: psycopg.Connection,
    table: str,
    cols: list[str],
) -> int:
    col_sql = ", ".join(f'"{name}"' for name in cols)
    with src.cursor() as source_cur, dst.cursor() as dest_cur:
        with source_cur.copy(
            f'COPY "{table}" ({col_sql}) TO STDOUT WITH (FORMAT binary)'
        ) as reader, dest_cur.copy(
            f'COPY "{table}" ({col_sql}) FROM STDIN WITH (FORMAT binary)'
        ) as writer:
            for chunk in reader:
                writer.write(chunk)
        count = dest_cur.execute(f'SELECT count(*) AS n FROM "{table}"').fetchone()
    return int(count["n"] if count else 0)


def main() -> int:
    src = connect("SRC_PG")
    dst = connect("DST_PG")
    src.autocommit = False
    dst.autocommit = False
    print("connected", flush=True)
    try:
        dst.execute("SET CONSTRAINTS ALL DEFERRED")
        dst.execute(
            "TRUNCATE {} RESTART IDENTITY CASCADE".format(
                ", ".join(f'"{name}"' for name in TRUNCATE_ORDER)
            )
        )
        print("truncated destination application tables", flush=True)
        for table in TABLES:
            src_cols = columns(src, table)
            dst_cols = columns(dst, table)
            if not src_cols:
                print(f"SKIP {table} missing on source", flush=True)
                continue
            if not dst_cols:
                print(f"SKIP {table} missing on destination", flush=True)
                continue
            cols = [name for name in src_cols if name in dst_cols]
            copied = copy_table(src, dst, table, cols)
            print(f"COPIED {table} rows={copied} cols={len(cols)}", flush=True)
        dst.commit()
        print("COPY_DONE", flush=True)
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
