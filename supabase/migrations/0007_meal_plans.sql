-- 0007_meal_plans.sql — the current weekly meal plan (agentic food loop).
-- ============================================================================
-- Per-user cloud sync for the "plan my week" output. SINGLETON: one active plan
-- per user (unique on user_id), holding the whole week as `data` jsonb — the
-- source of truth (days → meals → ingredients + nullable macros). Follows the
-- EXACT conventions of the nutrition_goals singleton (0001) + 0004's inline
-- RLS/grants:
--
--   • ONE per user (unique on user_id) → the SyncSender upserts on user_id and
--     mints a stable text PK `id` = `plan-<user_id>` (no default → NOT NULL is
--     satisfied; a re-flush replays idempotently, conflict on user_id updates).
--   • `user_id uuid not null references auth.users(id) on delete cascade`.
--   • `week_start` lifted for querying/ordering; the full plan lives in `data`.
--     Honesty: the model's nullable macros stay NULL inside `data`, never 0.
--   • RLS ENABLED + FORCED, exactly four self-owned policies
--     (`auth.uid() = user_id`; INSERT/UPDATE carry a `with check`).
--   • SELECT/INSERT/UPDATE/DELETE granted to `authenticated` (anon: none) — the
--     0003 lesson: Management-API-created tables get NO default DML grants, so
--     without this an authenticated user hits 42501 on every real read/write.
--
-- Idempotent: `create table if not exists`, `create index if not exists`,
-- `drop policy if exists ... ; create policy ...`, idempotent grants — safe to
-- re-apply.
-- ============================================================================

-- ── meal_plans ───────────────────────────────────────────────────────────────
create table if not exists public.meal_plans (
  id           text primary key,                                       -- minted `plan-<user_id>` (stable per user)
  user_id      uuid not null references auth.users(id) on delete cascade,

  week_start   timestamptz,             -- MealPlan.weekStart (lifted for querying)

  -- Full serialized MealPlan.toJson() — source of truth for the aggregate.
  data         jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One active plan row per user (the singleton guarantee).
  constraint meal_plans_user_unique unique (user_id)
);

-- RLS predicate + by-user lookups.
create index if not exists idx_meal_plans_user on public.meal_plans (user_id);

-- ── Row-Level Security (enable + FORCE, four self-owned policies) ─────────────
alter table public.meal_plans enable row level security;
alter table public.meal_plans force row level security;

drop policy if exists meal_plans_select on public.meal_plans;
create policy meal_plans_select on public.meal_plans
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists meal_plans_insert on public.meal_plans;
create policy meal_plans_insert on public.meal_plans
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists meal_plans_update on public.meal_plans;
create policy meal_plans_update on public.meal_plans
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists meal_plans_delete on public.meal_plans;
create policy meal_plans_delete on public.meal_plans
  for delete to authenticated
  using (auth.uid() = user_id);

-- ── Grants ───────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.meal_plans to authenticated;
