#!/usr/bin/env python3
"""Fill users.extension from Vonage Business Communications.

Only updates directory emails that already exist. Users without a Vonage
extension are left blank. Existing different extensions are not overwritten.

Usage:
  PYTHONPATH=. python scripts/sync_vonage_extensions.py --list-only
  PYTHONPATH=. python scripts/sync_vonage_extensions.py --dry-run
  PYTHONPATH=. python scripts/sync_vonage_extensions.py
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def _app_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here.parent.parent, Path("/app"), Path.cwd()):
        if (candidate / "src" / "postgres_db.py").is_file():
            return candidate
    return here.parent.parent


ROOT = _app_root()
sys.path.insert(0, str(ROOT))

# Local .env historically used VBC_*; the app reads VBC_*.
_ALIAS = {
    "VBC_CLIENT_ID": "VBC_CLIENT_ID",
    "VBC_CLIENT_SECRET": "VBC_CLIENT_SECRET",
    "VBC_USERNAME": "VBC_USERNAME",
    "VBC_PASSWORD": "VBC_PASSWORD",
    "VBC_ACCOUNT_ID": "VBC_ACCOUNT_ID",
}
try:
    from dotenv import dotenv_values

    _vals = dotenv_values(ROOT / ".env")
except Exception:
    _vals = {}
for _src, _dest in _ALIAS.items():
    if os.environ.get(_dest):
        continue
    _val = (
        os.environ.get(_src)
        or (_vals.get(_dest) if _vals else "")
        or (_vals.get(_src) if _vals else "")
        or ""
    ).strip()
    if _val:
        os.environ[_dest] = _val

PROVISIONING_BASES = (
    "https://api.vonage.com/t/vbc.prod/provisioning/v1/api/accounts",
    "https://api.vonage.com/t/vbc.prod/provisioning/api/accounts",
)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _embedded_rows(payload: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    embedded = payload.get("_embedded") or {}
    for key in keys:
        rows = _as_list(embedded.get(key) if isinstance(embedded, dict) else None)
        if rows and all(isinstance(row, dict) for row in rows):
            return [row for row in rows if isinstance(row, dict)]
    for key in keys:
        rows = _as_list(payload.get(key))
        if rows and all(isinstance(row, dict) for row in rows):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _paginate(client: Any, url: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 1
    while page <= 200:
        payload = client._get_json(url, params={"page": page, "page_size": 100})
        if not isinstance(payload, dict):
            break
        chunk = _embedded_rows(payload, "data", "users", "extensions")
        if not chunk:
            break
        rows.extend(chunk)
        total_pages = int(payload.get("total_pages") or payload.get("total_pages") or page)
        if page >= total_pages:
            break
        page += 1
    return rows


def _best_extension(candidates: list[str]) -> str | None:
    from src.agent_identity import normalize_extension

    seen: list[str] = []
    for raw in candidates:
        ext = normalize_extension(raw)
        if ext and ext not in seen:
            seen.append(ext)
    if not seen:
        return None
    short = [ext for ext in seen if 3 <= len(ext) <= 5]
    return short[0] if short else seen[0]


def _display_name(first: str, last: str, fallback: str = "") -> str:
    name = " ".join(part for part in (first.strip(), last.strip()) if part)
    return name or fallback.strip()


def _login_of(obj: dict[str, Any]) -> str:
    return str(
        obj.get("login_name")
        or obj.get("login_name")
        or obj.get("loginName")
        or ""
    ).strip()


def _ext_of(obj: dict[str, Any]) -> str:
    return str(
        obj.get("extension_number")
        or obj.get("extension_number")
        or obj.get("extensionNumber")
        or ""
    )


def _collect_from_users(users: list[dict[str, Any]]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for user in users:
        email = str(user.get("email") or "").strip().lower()
        login = _login_of(user)
        first = str(user.get("first_name") or user.get("firstName") or "").strip()
        last = str(user.get("last_name") or user.get("lastName") or "").strip()
        exts = [
            _ext_of(item) if isinstance(item, dict) else str(item or "")
            for item in _as_list(user.get("extensions"))
        ]
        ext = _best_extension(exts)
        if not ext:
            continue
        records.append(
            {
                "email": email,
                "login": login.lower(),
                "name": _display_name(first, last, login or email),
                "extension": ext,
            }
        )
    return records


def _collect_from_extensions(extensions: list[dict[str, Any]]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for item in extensions:
        user = item.get("user") if isinstance(item.get("user"), dict) else {}
        email = str(user.get("email") or item.get("email") or "").strip().lower()
        login = _login_of(user) or _login_of(item)
        first = str(user.get("first_name") or item.get("first_name") or "").strip()
        last = str(user.get("last_name") or item.get("last_name") or "").strip()
        ext = _best_extension([_ext_of(item)])
        if not ext:
            continue
        records.append(
            {
                "email": email,
                "login": login.lower(),
                "name": _display_name(first, last, login or email),
                "extension": ext,
            }
        )
    return records


def fetch_vonage_records() -> tuple[str, list[dict[str, str]]]:
    from src.vonage_vbc import VonageVBCClient, VonageVBCError

    client = VonageVBCClient()
    account_id = client.reports_account_id()
    last_error = ""
    for base in PROVISIONING_BASES:
        try:
            users = _paginate(client, f"{base}/{account_id}/users")
            try:
                extensions = _paginate(client, f"{base}/{account_id}/extensions")
            except VonageVBCError as exc:
                print(f"extensions endpoint skipped ({exc})")
                extensions = []
            records = _collect_from_users(users) + _collect_from_extensions(extensions)
            if users or extensions:
                return f"provisioning:{base}", records
        except VonageVBCError as exc:
            last_error = str(exc)
            print(f"provisioning failed {base}: {exc}")
            continue
    if last_error:
        print(f"falling back to call_logs ({last_error})")
    return "call_logs", []


def fetch_call_log_records(conn: Any) -> list[dict[str, str]]:
    from src.agent_identity import normalize_extension

    rows = conn.execute(
        """
        SELECT
            lower(btrim(COALESCE(source_user, ''))) AS ident,
            COALESCE(source_user_full_name, '') AS full_name,
            source_extension AS ext,
            count(*)::int AS n
        FROM call_logs
        WHERE source_extension IS NOT NULL AND btrim(source_extension) <> ''
        GROUP BY 1, 2, 3
        UNION ALL
        SELECT
            lower(btrim(COALESCE(destination_user, ''))) AS ident,
            COALESCE(destination_user_full_name, '') AS full_name,
            destination_extension AS ext,
            count(*)::int AS n
        FROM call_logs
        WHERE destination_extension IS NOT NULL
          AND btrim(destination_extension) <> ''
        GROUP BY 1, 2, 3
        """
    ).fetchall()

    tallies: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in rows:
        ident = str(row["ident"] or "").strip().lower()
        name = str(row["full_name"] or "").strip()
        ext = normalize_extension(row["ext"])
        if not ext:
            continue
        tallies[(ident, name)][ext] += int(row["n"] or 0)

    records: list[dict[str, str]] = []
    for (ident, name), counts in tallies.items():
        ext = max(counts.items(), key=lambda item: item[1])[0]
        email = ident if "@" in ident else ""
        login = ident.split("@")[0] if ident else ""
        records.append(
            {
                "email": email,
                "login": login,
                "name": name,
                "extension": ext,
            }
        )
    return records


def _directory_match(
    record: dict[str, str],
    by_email: dict[str, dict[str, Any]],
    by_login: dict[str, list[dict[str, Any]]],
    directory: list[dict[str, Any]],
    domain: str,
) -> dict[str, Any] | None:
    from src.agent_identity import names_match_confident, suggested_agent_email

    email = record["email"].strip().lower()
    if email and email in by_email:
        return by_email[email]

    if email and "@" in email:
        local = email.split("@", 1)[0]
        guessed = f"{local}@{domain}"
        if guessed in by_email:
            return by_email[guessed]
        candidates = by_login.get(local, [])
        if len(candidates) == 1:
            return candidates[0]

    login = record["login"].strip().lower()
    if login:
        guessed = f"{login}@{domain}"
        if guessed in by_email:
            return by_email[guessed]
        candidates = by_login.get(login, [])
        if len(candidates) == 1:
            return candidates[0]

    name = record["name"].strip()
    if name:
        suggested = suggested_agent_email(name).lower()
        if suggested in by_email:
            return by_email[suggested]
        confident = [
            user
            for user in directory
            if names_match_confident(name, str(user.get("name") or ""))
        ]
        if len(confident) == 1:
            return confident[0]
    return None


def merge_records(records: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for record in records:
        key = (
            record["email"]
            or (f"login:{record['login']}" if record["login"] else "")
            or (f"name:{record['name'].lower()}" if record["name"] else "")
        )
        if not key:
            continue
        current = merged.get(key)
        if current is None:
            merged[key] = dict(record)
            continue
        if not current["email"] and record["email"]:
            current["email"] = record["email"]
        if not current["name"] and record["name"]:
            current["name"] = record["name"]
        if not current["login"] and record["login"]:
            current["login"] = record["login"]
        if current["extension"] != record["extension"]:
            current["extension"] = (
                _best_extension([current["extension"], record["extension"]])
                or current["extension"]
            )
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Fill user extensions from Vonage")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Print Vonage email/extension pairs and exit (no database)",
    )
    args = parser.parse_args()

    source, vonage_records = fetch_vonage_records()
    merged = merge_records(vonage_records)
    print(f"source={source} vonage_records={len(vonage_records)} unique={len(merged)}")

    if args.list_only:
        with_ext = [r for r in merged.values() if r.get("extension")]
        print(f"vonage_with_ext={len(with_ext)}")
        for record in sorted(with_ext, key=lambda r: r.get("email") or r.get("name") or ""):
            print(
                f"  {record.get('extension'):>6}  "
                f"{(record.get('email') or '-'):<40} "
                f"{record.get('name')}"
            )
        return

    from src.agent_identity import normalize_extension
    from src.config import get_settings
    from src.postgres_db import get_connection

    domain = (get_settings().allowed_email_domain or "releviumpain.com").lower()

    with get_connection() as conn:
        if source == "call_logs" or not vonage_records:
            extra = fetch_call_log_records(conn)
            if extra:
                vonage_records.extend(extra)
                merged = merge_records(vonage_records)
                print(f"after call_logs unique={len(merged)}")

        directory = [
            dict(row)
            for row in conn.execute("SELECT email, name, extension FROM users").fetchall()
        ]
        by_email = {str(row["email"]).lower(): row for row in directory}
        by_login: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in directory:
            local = str(row["email"]).lower().split("@")[0]
            by_login[local].append(row)

        claimed: dict[str, str] = {}
        for row in directory:
            ext = normalize_extension(row.get("extension"))
            if ext:
                claimed[ext] = str(row["email"]).lower()

        skipped_no_match = 0
        skipped_already = 0
        skipped_conflict = 0
        assigned: dict[str, str] = {}
        updates: list[tuple[str, str]] = []
        unmatched: list[str] = []

        for record in merged.values():
            if not record.get("extension"):
                continue
            user = _directory_match(record, by_email, by_login, directory, domain)
            if user is None:
                skipped_no_match += 1
                unmatched.append(
                    f"{record['extension']} {record['email'] or record['login']} ({record['name']})"
                )
                continue
            email = str(user["email"]).lower()
            ext = record["extension"]
            current = normalize_extension(user.get("extension"))
            if current == ext:
                skipped_already += 1
                continue
            if current:
                print(f"skip existing {email} has {current}, vonage {ext}")
                skipped_conflict += 1
                continue
            owner = claimed.get(ext) or assigned.get(ext)
            if owner and owner != email:
                print(f"skip conflict ext {ext}: {owner} vs {email}")
                skipped_conflict += 1
                continue
            assigned[ext] = email
            updates.append((email, ext))
            print(
                f"set {email} -> {ext} ({record['name'] or record['email'] or record['login']})"
            )

        print(
            f"would_update={len(updates)} already={skipped_already} "
            f"no_match={skipped_no_match} conflict={skipped_conflict}"
        )
        if unmatched:
            print("unmatched vonage users:")
            for line in unmatched:
                print(f"  {line}")

        if args.dry_run:
            return

        updated = 0
        for email, ext in updates:
            conn.execute(
                """
                UPDATE users
                SET extension = %s, updated_at = now()
                WHERE email = %s
                  AND (extension IS NULL OR btrim(extension) = '')
                """,
                (ext, email),
            )
            updated += 1
        conn.commit()

        remaining = conn.execute(
            """
            SELECT count(*)::int AS n
            FROM users
            WHERE extension IS NULL OR btrim(extension) = ''
            """
        ).fetchone()
        with_ext = conn.execute(
            """
            SELECT count(*)::int AS n
            FROM users
            WHERE extension IS NOT NULL AND btrim(extension) <> ''
            """
        ).fetchone()
        print(
            f"updated={updated} already={skipped_already} "
            f"no_match={skipped_no_match} conflict={skipped_conflict} "
            f"users_with_ext={with_ext['n']} users_without_ext={remaining['n']}"
        )


if __name__ == "__main__":
    main()
