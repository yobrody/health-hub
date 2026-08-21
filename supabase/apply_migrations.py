#!/usr/bin/env python3
"""Apply Supabase SQL migrations via the Management API.

Secret-free: reads SUPABASE_ACCESS_TOKEN from the gitignored `.supabase-admin.local`
at the repo root (never printed). Applies every `NNNN_*.sql` in supabase/migrations
in sorted order, then verifies RLS + policy counts. Idempotent migrations → safe to
re-run.

Usage:  python supabase/apply_migrations.py [verify-only]
"""
import glob
import json
import os
import sys
import urllib.error
import urllib.request

REF = "eazwtlqieizvsqvbbknj"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRETS = os.path.join(REPO, ".supabase-admin.local")
MIGRATIONS = os.path.join(REPO, "supabase", "migrations")


def load_token() -> str:
    if not os.path.exists(SECRETS):
        sys.exit(f"missing {SECRETS}")
    with open(SECRETS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("SUPABASE_ACCESS_TOKEN="):
                tok = line.split("=", 1)[1].strip()
                if tok:
                    return tok
    sys.exit("SUPABASE_ACCESS_TOKEN not set in .supabase-admin.local")


def run_sql(token: str, sql: str, label: str) -> bool:
    url = f"https://api.supabase.com/v1/projects/{REF}/database/query"
    req = urllib.request.Request(
        url,
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare in front of api.supabase.com 1010-blocks the default
            # urllib UA; present a normal browser signature.
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode("utf-8")
            print(f"[{label}] HTTP {resp.status}: {body[:1000]}")
            return True
    except urllib.error.HTTPError as err:
        print(f"[{label}] HTTP {err.code}: {err.read().decode('utf-8')[:1500]}")
        return False
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] ERROR: {exc}")
        return False


def main() -> None:
    token = load_token()
    print(f"token loaded: {token[:7]}… (len {len(token)})")
    verify_only = len(sys.argv) > 1 and sys.argv[1] == "verify-only"

    if not verify_only:
        files = sorted(glob.glob(os.path.join(MIGRATIONS, "[0-9]*.sql")))
        if not files:
            sys.exit(f"no migrations found in {MIGRATIONS}")
        for path in files:
            name = os.path.basename(path)
            with open(path, encoding="utf-8") as fh:
                sql = fh.read()
            print(f"\n--- applying {name} ({len(sql)} chars) ---")
            if not run_sql(token, sql, name):
                sys.exit(f"FAILED applying {name}")

    print("\n--- verify: RLS per public table ---")
    run_sql(
        token,
        "select c.relname as tbl, c.relrowsecurity as rls_enabled, "
        "c.relforcerowsecurity as rls_forced from pg_class c "
        "join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname='public' and c.relkind='r' order by c.relname;",
        "rls",
    )
    print("\n--- verify: policy count per table ---")
    run_sql(
        token,
        "select tablename, count(*) as policies from pg_policies "
        "where schemaname='public' group by tablename order by tablename;",
        "policies",
    )


if __name__ == "__main__":
    main()
