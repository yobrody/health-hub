-- Health Hub — Supabase schema (Phase D / Task 2)
-- ============================================================================
-- Multi-tenant health-tracking database. Every row is owned by exactly one
-- Supabase auth user; Row-Level Security (see 0002_rls.sql) restricts every
-- operation to `auth.uid() = user_id`. This file only creates the tables,
-- columns and indexes — RLS lives in 0002 so the security layer is reviewable
-- on its own.
--
-- DESIGN PRINCIPLES (must hold for every table):
--
--  1. TENANCY. Every table has `user_id uuid not null references auth.users(id)
--     on delete cascade`. Deleting the auth user cascades away all their data.
--
--  2. HONESTY = NULLABILITY. The Dart models make almost every field nullable on
--     purpose: a value the user (or a scan/AI) never provided stays `null`, is
--     omitted from `toJson()`, and renders as `—` in the UI. The old React app's
--     fabricated defaults (2200 kcal, 140 g protein, 80 kg, 72 kg goal) are the
--     exact bug this schema refuses to reintroduce. So: any model field that is
--     nullable is a NULLABLE column here — NEVER a NOT-NULL-with-default that
--     would invent data. A genuine `0` the user entered is a real value and is
--     stored as `0`; "unknown" is `null`. Only true structural fields
--     (id, user_id, timestamps, real boolean states, provenance strings that the
--     model always emits) are NOT NULL.
--
--  3. CLIENT-AUTHORITATIVE IDS + FULL-OBJECT SYNC. The app already syncs each
--     aggregate as a whole-object snapshot through an offline Outbox
--     (`PUT /workouts/{id}`, `PUT /pantry/{id}`, `PUT /nutrition/{id}` carrying
--     the entire `toJson()`), and it generates the ids itself:
--       • pantry items   -> `item-<micros>`
--       • food log        -> `food-<micros>`
--       • workouts        -> `w-<micros>`
--     Those aggregates therefore use a `text` primary key = the client's id, so
--     an Outbox replay is a clean `insert ... on conflict (id) do update`
--     upsert. The two brand-new tables the dashboard needs (nutrition_goals,
--     weigh_ins) also take client-generated ids for consistency; the singletons
--     (profile, nutrition_goals) are additionally unique on user_id (one row per
--     user).
--
--  4. STORAGE SHAPE (pragmatic v1). Each row carries the flat, queryable columns
--     that the dashboard/day-queries actually need PLUS a `data jsonb` column
--     holding the full serialized aggregate, faithful to that model's
--     `toJson()`. This mirrors the full-object Outbox sync exactly (the whole
--     object is what gets PUT), keeps the next task's repo migration trivial
--     (write body -> `data`, lift the few flat cols), and avoids
--     over-normalizing the deeply nested workout (exercises -> sets) for v1.
--     Where a column duplicates a value inside `data`, `data` is the source of
--     truth for the aggregate; the flat column exists for indexing/querying.
--
-- Idempotent: `create table if not exists` / `create index if not exists`, so
-- re-applying this file is safe. Policies are (re)created idempotently in 0002.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto; on Supabase it is available in the
-- default search path, but enable it defensively so this file is portable.
create extension if not exists pgcrypto;

-- ── profile ─────────────────────────────────────────────────────────────────
-- SINGLETON: exactly one row per user (enforced by user_id primary key). Maps
-- `Profile` (app/lib/profile/profile_model.dart). EVERY Profile field is
-- nullable in the model ("no fabricated default anywhere"), so every column here
-- is nullable. Synced via `PUT /tdee/profile` with the whole object; there is no
-- client id for the profile, so user_id IS the primary key (one per user).
create table if not exists public.profile (
  user_id         uuid primary key references auth.users(id) on delete cascade,

  -- Flat, queryable mirrors of the model fields (all nullable = honest).
  height_cm       numeric,          -- Profile.heightCm      (double?)
  age_years       integer,          -- Profile.ageYears       (int?)
  sex             text,             -- Profile.sex            (String?, free)
  weight_kg       numeric,          -- Profile.weightKg       (double?), never defaulted
  goal_direction  text,             -- Profile.goalDirection  ('gain'|'cut'|'maintain')
  target_weight_kg numeric,         -- Profile.targetWeightKg (double?), never defaulted
  primary_gym     text,             -- Profile.primaryGym     (String?)

  -- Full serialized Profile.toJson() — source of truth for the aggregate, keeps
  -- forward-compat if the model gains fields before this schema does.
  data            jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── nutrition_goals ─────────────────────────────────────────────────────────
-- NEW DOMAIN. SINGLETON: one row per user (unique on user_id) holding the daily
-- targets. ALL FOUR TARGETS ARE NULLABLE by design — an unset target must stay
-- NULL so the dashboard shows its honest empty state and never a fabricated
-- 0/2200/140. Client id kept for consistency with the other aggregates + clean
-- upsert replay, but user_id uniqueness is what enforces the singleton.
create table if not exists public.nutrition_goals (
  id              text primary key,                                    -- client-generated (e.g. `goal-<micros>`)
  user_id         uuid not null references auth.users(id) on delete cascade,

  calories_kcal   numeric,          -- daily calorie target,  NULL when unset (honest empty state)
  protein_g       numeric,          -- daily protein target,  NULL when unset
  carbs_g         numeric,          -- daily carbs target,    NULL when unset
  fat_g           numeric,          -- daily fat target,      NULL when unset

  data            jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One goals row per user (the singleton guarantee).
  constraint nutrition_goals_user_unique unique (user_id)
);

-- ── weigh_ins ───────────────────────────────────────────────────────────────
-- NEW DOMAIN. MANY per user — the weight history that powers the dashboard's
-- real trend. `weight_kg` nullable (honesty: a missing weight is `null`, never a
-- guessed number); `at` is the timestamp of the reading. Client-generated text
-- id so an offline-logged weigh-in upserts cleanly on replay.
create table if not exists public.weigh_ins (
  id              text primary key,                                    -- client-generated (e.g. `weigh-<micros>`)
  user_id         uuid not null references auth.users(id) on delete cascade,

  weight_kg       numeric,          -- the reading in kg, NULL if unknown — never fabricated
  at              timestamptz,      -- when the weight was taken (NULL only if the client couldn't stamp it)

  data            jsonb not null default '{}'::jsonb,                  -- full snapshot (source, note, etc. later)

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── pantry_items ────────────────────────────────────────────────────────────
-- MANY per user. Maps `PantryItem` (app/lib/pantry/pantry_item.dart), synced via
-- `PUT /pantry/{id}` with the whole item. Client id `item-<micros>` -> text PK.
-- Only id/name/zone/source/shared are NOT NULL in the model (always emitted);
-- everything else is nullable (honest "unknown"). Flat cols = the ones worth
-- querying (zone filter, expiry sort); `data` holds the faithful full toJson().
create table if not exists public.pantry_items (
  id                  text primary key,                                -- PantryItem.id = `item-<micros>`
  user_id             uuid not null references auth.users(id) on delete cascade,

  name                text not null,      -- PantryItem.name  (required)
  zone                text not null,      -- PantryItem.zone  ('fridge'|'pantry'|'freezer'|'condiments')
  qty                 numeric,            -- PantryItem.qty            (double?), 0 is real (out of stock)
  unit                text,               -- PantryItem.unit           (String?)
  expiry              timestamptz,        -- PantryItem.expiry         (DateTime?)
  price_gbp           numeric,            -- PantryItem.priceGbp       (double?)
  store               text,               -- PantryItem.store          (String?)
  purchased_at        timestamptz,        -- PantryItem.purchasedAt    (DateTime?)
  reorder_cadence_days integer,           -- PantryItem.reorderCadenceDays (int?)
  last_bought         timestamptz,        -- PantryItem.lastBought     (DateTime?)
  source              text not null,      -- PantryItem.source ('manual'|'scan'|'receipt'), always emitted
  owner_id            text,               -- PantryItem.ownerId        (String?, social seam)
  shared              boolean not null default false,  -- PantryItem.shared (real bool, always emitted)

  data                jsonb not null default '{}'::jsonb,              -- full PantryItem.toJson()

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── food_log_entries ────────────────────────────────────────────────────────
-- MANY per user. Maps `FoodLogEntry` (app/lib/nutrition/food_log_entry.dart),
-- synced via `PUT /nutrition/{id}`. Client id `food-<micros>` -> text PK.
-- Macros/micros nullable (never fabricated 0); a real 0 (0 kcal cola) is kept.
-- Micros are a variable-key map -> stored inside `data` (and the full jsonb),
-- not a fixed column. `at` is the LOCAL-time timestamp used for the day filter,
-- so it gets a (user_id, at) index.
create table if not exists public.food_log_entries (
  id              text primary key,                                    -- FoodLogEntry.id = `food-<micros>`
  user_id         uuid not null references auth.users(id) on delete cascade,

  name            text not null,          -- FoodLogEntry.name (required)
  at              timestamptz not null,   -- FoodLogEntry.at   (required; drives day queries)
  kcal            numeric,                -- FoodLogEntry.kcal      (double?), 0 is real
  protein_g       numeric,                -- FoodLogEntry.proteinG  (double?)
  carbs_g         numeric,                -- FoodLogEntry.carbsG    (double?)
  fat_g           numeric,                -- FoodLogEntry.fatG      (double?)
  grams           numeric,                -- FoodLogEntry.grams     (double?)
  tier            text not null,          -- FoodLogEntry.tier ('exact'|'estimate'), always emitted
  ate_out         boolean not null default false,  -- FoodLogEntry.ateOut (real bool)
  restaurant      text,                   -- FoodLogEntry.restaurant (String?)
  spend_gbp       numeric,                -- FoodLogEntry.spendGbp   (double?)
  barcode         text,                   -- FoodLogEntry.barcode    (String?)
  source          text not null,          -- FoodLogEntry.source ('manual'|'barcode'|'ai'|'off'), always emitted
  owner_id        text,                   -- FoodLogEntry.ownerId    (String?, social seam)
  shared          boolean not null default false,  -- FoodLogEntry.shared (real bool)

  -- Micros (variable-key map, only-when-measured) live inside the full snapshot.
  data            jsonb not null default '{}'::jsonb,                  -- full FoodLogEntry.toJson()

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── workouts ────────────────────────────────────────────────────────────────
-- MANY per user. Maps `WorkoutSession` (app/lib/gym/workout_session.dart),
-- synced via `PUT /workouts/{id}` with the whole session. Client id `w-<micros>`
-- -> text PK. The nested exercises -> sets structure is deliberately NOT
-- normalized for v1: the whole session is what the Outbox PUTs, so `exercises`
-- is stored as jsonb (faithful to WorkoutSession.toJson()) alongside the full
-- `data` snapshot. Flat cols: `at` (session start) + `finished` (real bool) for
-- listing/active-session queries.
create table if not exists public.workouts (
  id              text primary key,                                    -- WorkoutSession.id = `w-<micros>`
  user_id         uuid not null references auth.users(id) on delete cascade,

  at              timestamptz not null,   -- WorkoutSession.at (session start, required)
  finished        boolean not null default false,  -- WorkoutSession.finished (real bool, always emitted)
  owner_id        text,                   -- WorkoutSession.ownerId (String?, social seam)
  shared          boolean not null default false,  -- WorkoutSession.shared (real bool)

  -- Nested exercises -> sets, stored as jsonb rather than over-normalized (v1).
  exercises       jsonb not null default '[]'::jsonb,                  -- WorkoutSession.exercises
  data            jsonb not null default '{}'::jsonb,                  -- full WorkoutSession.toJson()

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- user_id on every multi-row table (RLS predicate + list-by-user); composite
-- (user_id, at) on weigh_ins and the food log for day/trend queries.
create index if not exists idx_nutrition_goals_user   on public.nutrition_goals (user_id);
create index if not exists idx_weigh_ins_user         on public.weigh_ins (user_id);
create index if not exists idx_weigh_ins_user_at      on public.weigh_ins (user_id, at);
create index if not exists idx_pantry_items_user      on public.pantry_items (user_id);
create index if not exists idx_food_log_user          on public.food_log_entries (user_id);
create index if not exists idx_food_log_user_at       on public.food_log_entries (user_id, at);
create index if not exists idx_workouts_user          on public.workouts (user_id);
create index if not exists idx_workouts_user_at       on public.workouts (user_id, at);

-- (profile is a singleton keyed on user_id — its PK already covers user lookups.)
