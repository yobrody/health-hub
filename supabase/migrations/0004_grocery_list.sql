-- 0004_grocery_list.sql — the Cart grocery-list table (last P1 sync gap).
-- ============================================================================
-- Per-user cloud sync for the Cart notepad. Until now the grocery list was the
-- ONLY domain that lived local-only (SharedPreferences); every other aggregate
-- (pantry, food log, workouts, weigh-ins, goals, profile) already syncs through
-- the offline Outbox → Supabase. This table closes that gap, following the EXACT
-- conventions of 0001/0002/0003:
--
--   • MANY per user (a list of lines). Client-generated text PK = the grocery
--     item id (`grocery-<micros>-<seq>`), so an Outbox replay is a clean
--     `insert ... on conflict (id) do update` upsert.
--   • `user_id uuid not null references auth.users(id) on delete cascade` —
--     deleting the auth user cascades away their whole list.
--   • Flat, queryable columns worth lifting (`name`, `checked`) + `created_at` /
--     `updated_at`, PLUS a `data jsonb` holding the full GroceryItem.toJson()
--     (the source of truth for the aggregate; the flat columns exist purely for
--     indexing/querying). `name`/`checked` are always emitted by the model, so
--     they are NOT NULL (`checked` defaults to false = an honest unchecked line).
--     Nothing is fabricated: a line exists only because the user added it.
--   • RLS ENABLED + FORCED, exactly four self-owned policies
--     (`auth.uid() = user_id`; INSERT/UPDATE carry a `with check`).
--   • SELECT/INSERT/UPDATE/DELETE granted to `authenticated` (anon: none) — the
--     0003 lesson: tables created via the Management API as postgres get NO
--     default DML grants, so without this an authenticated user hits 42501
--     ("permission denied for table") on every real read/write.
--
-- DELETE STRATEGY (no ghost rows): the grocery list has a genuine delete
-- (remove an item, clearDone removes every checked line). The Outbox already
-- carries a `DELETE /grocery/{id}` path that [SupabaseSyncSender] maps to a REAL
-- row delete (`deleteById`), exactly like `DELETE /pantry/{id}`. So a removed
-- item genuinely disappears cross-device — a real DELETE, NOT a soft-delete /
-- tombstone column. This keeps the table honest (a row exists iff the line is on
-- the list) and needs no extra column here.
--
-- Idempotent: `create table if not exists`, `create index if not exists`,
-- `drop policy if exists ... ; create policy ...`, and idempotent grants — safe
-- to re-apply.
-- ============================================================================

-- ── grocery_list ─────────────────────────────────────────────────────────────
create table if not exists public.grocery_list (
  id           text primary key,                                       -- GroceryItem.id = `grocery-<micros>-<seq>`
  user_id      uuid not null references auth.users(id) on delete cascade,

  name         text not null,            -- GroceryItem.name    (required, always emitted)
  checked      boolean not null default false,  -- GroceryItem.done (real bool; default = honest unchecked)

  -- Full serialized GroceryItem.toJson() — source of truth for the aggregate,
  -- keeps forward-compat if the model gains fields before this schema does.
  data         jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- RLS predicate + list-by-user lookups.
create index if not exists idx_grocery_list_user on public.grocery_list (user_id);

-- ── Row-Level Security (enable + FORCE, four self-owned policies) ─────────────
alter table public.grocery_list enable row level security;
alter table public.grocery_list force row level security;

drop policy if exists grocery_list_select on public.grocery_list;
create policy grocery_list_select on public.grocery_list
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists grocery_list_insert on public.grocery_list;
create policy grocery_list_insert on public.grocery_list
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists grocery_list_update on public.grocery_list;
create policy grocery_list_update on public.grocery_list
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists grocery_list_delete on public.grocery_list;
create policy grocery_list_delete on public.grocery_list
  for delete to authenticated
  using (auth.uid() = user_id);

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Same lesson as 0003: the authenticated role needs explicit DML grants (RLS
-- still restricts rows to `auth.uid() = user_id`). `anon` gets nothing — this is
-- a private, account-only app.
grant select, insert, update, delete on public.grocery_list to authenticated;
