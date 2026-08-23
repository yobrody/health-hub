-- 0006_profile_body_fat.sql — add the body_fat_percent flat column.
-- ============================================================================
-- The Flutter app gained an optional per-user body-fat percentage
-- (Profile.bodyFatPercent). It drives the honest, weight-INDEPENDENT "visible
-- abs" milestone on the Transformation page: abs are a body-fat signal, not a
-- scale-weight one.
--
-- Like every other profile field it is NULLABLE — a missing body-fat reading is
-- an honest `null` that keeps the abs milestone in a `needs-data` state rather
-- than fabricating a value. It's stored as a plain numeric percentage (e.g. 16
-- for 16%).
--
-- The value already round-trips through the profile row's `data` jsonb (the full
-- toJson() snapshot). This flat column is what the app's hydrator reads back
-- (`Profile.fromJson(rows.first)` reads the flat columns), so it's required for
-- the value to survive a cloud pull — mirroring `target_weight_kg` /
-- `activity_level`.
--
-- Idempotent: `if not exists` so a re-run is a no-op. No RLS change needed — the
-- profile table's existing self-owned policies already cover every column.

alter table public.profile
  add column if not exists body_fat_percent numeric; -- Profile.bodyFatPercent (double?)
