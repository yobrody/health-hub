-- 0003_grants.sql — DML grants for the `authenticated` role.
--
-- The tables in 0001 were created via the Management API as the postgres
-- superuser, which did NOT apply Supabase's usual default DML grants. Result:
-- `authenticated` had only REFERENCES/TRIGGER/TRUNCATE, so a real signed-in
-- user hit "permission denied for table" on every read/write. Row-Level
-- Security still restricts rows to `auth.uid() = user_id`; these grants just
-- let the authenticated role reach the tables at all.
--
-- `anon` is deliberately left with NO table access (this is a private,
-- account-only health app). Idempotent — grants can be re-applied safely.

grant select, insert, update, delete on
  public.profile,
  public.nutrition_goals,
  public.weigh_ins,
  public.pantry_items,
  public.food_log_entries,
  public.workouts
to authenticated;

-- Sequences: none in use (all PKs are client-supplied text / user_id), so no
-- sequence grants are required. If a future table adds a serial/identity PK,
-- grant usage on its sequence to authenticated here.
