# Health Hub — Supabase migrations (Phase D / Task 2)

Postgres schema + Row-Level Security for the Health Hub Supabase backend
(project ref `eazwtlqieizvsqvbbknj`). These are **not applied yet** — this
directory is the reviewable source of truth. Apply order:

1. `0001_init.sql` — extensions, tables, columns, indexes.
2. `0002_rls.sql` — enable RLS + per-operation policies on every table.

Both files are **idempotent** (`create table if not exists`,
`create index if not exists`, `drop policy if exists … ; create policy …`,
`create extension if not exists`, `enable/force row level security`), so
re-applying either is safe.

---

## Applying via the Supabase Management API (no CLI needed)

The Management API runs arbitrary SQL against the project database. You need a
**Supabase personal access token** (create one at
https://supabase.com/dashboard/account/tokens — store it in the SOPS vault,
never commit it).

```bash
# 0001_init.sql
curl -sS -X POST \
  "https://api.supabase.com/v1/projects/eazwtlqieizvsqvbbknj/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @<(jq -Rs '{query: .}' supabase/migrations/0001_init.sql)

# 0002_rls.sql  (apply AFTER 0001)
curl -sS -X POST \
  "https://api.supabase.com/v1/projects/eazwtlqieizvsqvbbknj/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @<(jq -Rs '{query: .}' supabase/migrations/0002_rls.sql)
```

The request body is JSON `{"query": "<entire file contents>"}`. The `jq -Rs`
trick reads the whole file and JSON-escapes it into that field — safer than
pasting SQL by hand (handles the em-dashes, quotes and newlines in the
comments). A `200` with an empty/`[]` body means success.

If you prefer not to use process substitution (e.g. plain `sh`), write the body
to a temp file first:

```bash
jq -Rs '{query: .}' supabase/migrations/0001_init.sql > /tmp/q.json
curl -sS -X POST \
  "https://api.supabase.com/v1/projects/eazwtlqieizvsqvbbknj/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/q.json
```

---

## Verifying it worked

### 1. RLS is enabled on every table

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

`rowsecurity` must be `true` for **all** of:
`food_log_entries`, `nutrition_goals`, `pantry_items`, `profile`,
`weigh_ins`, `workouts`.

### 2. The four policies exist per table

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

Expect 4 rows per table (SELECT / INSERT / UPDATE / DELETE) — 24 policies total.

### 3. FORCE RLS is on (owner is also subject to policies)

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
order by relname;
```

Both `relrowsecurity` and `relforcerowsecurity` should be `true`.

Run any of these verification queries the same way — POST the SQL string as
`{"query": "…"}` to the `/database/query` endpoint; the response is the rows as
JSON.

---

## What the migration creates (quick map)

| Table | Rows/user | PK | Client id scheme | Storage |
|---|---|---|---|---|
| `profile` | 1 (singleton) | `user_id` | — (no client id) | flat cols + `data` jsonb |
| `nutrition_goals` | 1 (singleton, `unique(user_id)`) | `id` text | `goal-<micros>` | 4 nullable target cols + `data` |
| `weigh_ins` | many | `id` text | `weigh-<micros>` | `weight_kg`, `at` + `data` |
| `pantry_items` | many | `id` text | `item-<micros>` | flat cols + `data` |
| `food_log_entries` | many | `id` text | `food-<micros>` | flat cols + `data` (micros live in `data`) |
| `workouts` | many | `id` text | `w-<micros>` | `at`/`finished` + `exercises` jsonb + `data` |

Every table: `user_id uuid not null references auth.users(id) on delete
cascade`, `created_at`/`updated_at timestamptz not null default now()`, RLS
enabled with all four ops restricted to `auth.uid() = user_id` (INSERT/UPDATE
guarded by `with check`). Text PKs match the ids the Flutter client already
generates, so the full-object Outbox sync (next task) replays as a clean
`insert … on conflict (id) do update` upsert. Nullability mirrors the Dart
models exactly — an unprovided value stays `NULL` (the honesty rule), never a
fabricated default.
