-- 0005_profile_activity_level.sql — add the activity_level flat column.
-- ============================================================================
-- The Flutter app gained a per-user activity level (Profile.activityLevel), used
-- to derive TDEE for honest goal suggestions (Mifflin–St Jeor × activity factor).
--
-- Like every other profile field it is NULLABLE — a missing activity level is an
-- honest `null` that blocks a goal suggestion rather than fabricating a
-- multiplier. It's stored as the ActivityLevel enum's name
-- (`sedentary`/`light`/`moderate`/`active`/`veryActive`).
--
-- The value already round-trips through the profile row's `data` jsonb (the full
-- toJson() snapshot). This flat column is what the app's hydrator reads back
-- (`Profile.fromJson(rows.first)` reads the flat columns), so it's required for
-- the value to survive a cloud pull — mirroring `primary_gym` / `target_weight_kg`.
--
-- Idempotent: `if not exists` so a re-run is a no-op. No RLS change needed — the
-- profile table's existing self-owned policies already cover every column.

alter table public.profile
  add column if not exists activity_level text; -- Profile.activityLevel (String?)
