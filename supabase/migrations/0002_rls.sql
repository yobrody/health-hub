-- Health Hub — Row-Level Security (Phase D / Task 2)
-- ============================================================================
-- SECURITY-CRITICAL. This is the ENTIRE multi-tenant isolation model: a user
-- may only ever see and mutate rows where `user_id = auth.uid()`. Every table
-- created in 0001_init.sql gets RLS ENABLED and one policy per operation
-- (SELECT / INSERT / UPDATE / DELETE), all keyed on `auth.uid() = user_id`.
--
-- Notes on correctness:
--  • `auth.uid()` returns the authenticated user's uuid (NULL for an
--    unauthenticated/anon request), so an anonymous request matches no row and
--    is denied by default. NULL = user_id is never true.
--  • SELECT/UPDATE/DELETE use a `using` predicate (which existing rows are
--    visible/affectable). INSERT uses `with check` (what a NEW row is allowed to
--    contain) — this is what stops a user from inserting a row owned by someone
--    else. UPDATE gets BOTH `using` (may only target own rows) AND `with check`
--    (may not re-assign the row to another user_id).
--  • Policies are scoped `to authenticated` so anon/service traffic is handled
--    explicitly (the service_role key bypasses RLS entirely by design — used
--    only by trusted server code, never shipped to the client).
--  • RLS with NO permissive policy = deny-all. Enabling RLS then adding exactly
--    the four self-owned policies is the whole allowlist.
--
-- Idempotent: every policy is `drop policy if exists ... ; create policy ...`
-- so re-applying is safe. `enable row level security` is idempotent in Postgres.
--
-- `profile` is keyed on user_id (it has no separate `id` column), but the RLS
-- predicate is identical — `auth.uid() = user_id`.
-- ============================================================================

-- Force RLS on for the table owner too (defence in depth): even a superuser/
-- owner connection is subject to the policies unless it is BYPASSRLS. The
-- Supabase `service_role` is BYPASSRLS, so trusted server code still works.
-- (enable + force are both idempotent.)

-- ─────────────────────────────────────────────────────────────────────────────
-- profile (singleton, PK = user_id)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profile enable row level security;
alter table public.profile force row level security;

drop policy if exists profile_select on public.profile;
create policy profile_select on public.profile
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists profile_insert on public.profile;
create policy profile_insert on public.profile
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists profile_update on public.profile;
create policy profile_update on public.profile
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists profile_delete on public.profile;
create policy profile_delete on public.profile
  for delete to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- nutrition_goals (singleton via unique(user_id))
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.nutrition_goals enable row level security;
alter table public.nutrition_goals force row level security;

drop policy if exists nutrition_goals_select on public.nutrition_goals;
create policy nutrition_goals_select on public.nutrition_goals
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists nutrition_goals_insert on public.nutrition_goals;
create policy nutrition_goals_insert on public.nutrition_goals
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists nutrition_goals_update on public.nutrition_goals;
create policy nutrition_goals_update on public.nutrition_goals
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists nutrition_goals_delete on public.nutrition_goals;
create policy nutrition_goals_delete on public.nutrition_goals
  for delete to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- weigh_ins
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.weigh_ins enable row level security;
alter table public.weigh_ins force row level security;

drop policy if exists weigh_ins_select on public.weigh_ins;
create policy weigh_ins_select on public.weigh_ins
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists weigh_ins_insert on public.weigh_ins;
create policy weigh_ins_insert on public.weigh_ins
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists weigh_ins_update on public.weigh_ins;
create policy weigh_ins_update on public.weigh_ins
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists weigh_ins_delete on public.weigh_ins;
create policy weigh_ins_delete on public.weigh_ins
  for delete to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- pantry_items
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pantry_items enable row level security;
alter table public.pantry_items force row level security;

drop policy if exists pantry_items_select on public.pantry_items;
create policy pantry_items_select on public.pantry_items
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists pantry_items_insert on public.pantry_items;
create policy pantry_items_insert on public.pantry_items
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists pantry_items_update on public.pantry_items;
create policy pantry_items_update on public.pantry_items
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists pantry_items_delete on public.pantry_items;
create policy pantry_items_delete on public.pantry_items
  for delete to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- food_log_entries
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.food_log_entries enable row level security;
alter table public.food_log_entries force row level security;

drop policy if exists food_log_entries_select on public.food_log_entries;
create policy food_log_entries_select on public.food_log_entries
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists food_log_entries_insert on public.food_log_entries;
create policy food_log_entries_insert on public.food_log_entries
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists food_log_entries_update on public.food_log_entries;
create policy food_log_entries_update on public.food_log_entries
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists food_log_entries_delete on public.food_log_entries;
create policy food_log_entries_delete on public.food_log_entries
  for delete to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- workouts
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.workouts enable row level security;
alter table public.workouts force row level security;

drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists workouts_insert on public.workouts;
create policy workouts_insert on public.workouts
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists workouts_update on public.workouts;
create policy workouts_update on public.workouts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists workouts_delete on public.workouts;
create policy workouts_delete on public.workouts
  for delete to authenticated
  using (auth.uid() = user_id);
