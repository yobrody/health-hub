# Health Hub — Release 1 Master Plan (everything to "fully working")

_Date: 2026-08-20. Drives all work until we resume branding decisions._

## Strategy (locked)

- **Two apps, shared codebase.** Release 1 = a **lean, luxury, mainstream Health Hub** (home + gym + nutrition + accounts). The avatar/shop/social/battles **game world is a separate, later app** (Release 2), reached from R1's home screen via a subtle "rift" seam. iOS cannot download native code post-install, so the game is a genuine second App Store product sharing the same Supabase account (progress carries over).
- **R1 launch scope = LEAN CORE** (user pick): home dashboard + gym + nutrition + accounts (Sign in with Apple / email / phone-OTP) + real Supabase sync + cross-links, all in the luxury design system. Deferred to fast-follows: AI meal/photo/receipt recognition, the proactive DayPlan brain, push notifications, grocery reorder — then Release 2 (the game).
- **Backend = Supabase-direct** (user pick): Flutter → Supabase for auth + Postgres (per-user Row-Level Security) + storage. The app's FastAPI on lucky-vps is **retired for the app's data** (kept only if a server-side job needs it later). Supabase handles Apple/email/phone-OTP natively.
- **Brand:** see `2026-08-20-brand-and-audience.md`. Build the luxury design system now under a **placeholder working name + generic produce icon**; final name/icon/exact palette swap in later with no rework.

## What already exists (merged to `main`)

P0 foundation · P1 pantry + ingredient graph + eating-in · P2 capture + nutrition · P3 full gym (live tracking, honest progression, rest/effort/confetti). ~328 tests green. All **client-side + offline-queued** via a shared `Outbox` (no live backend yet).

## Honest constraint on "fully working"

Every feature will be built and proven via `flutter test` + `flutter analyze` + a running preview (Chrome/Android). **True on-device iOS / TestFlight validation is gated on** the Apple Developer account (enrolling `career.brody@gmail.com`, ~48h) **+ Codemagic + a Mac**. Build-and-test complete is achievable now; the device pass happens the moment Apple is live. We never claim device-verified until it is.

## Inputs / blockers

| Need | From | Blocks | Status |
|---|---|---|---|
| Supabase **Project URL + anon/publishable key** | Brody (vault or chat; service_role stays server-side) | Phase D (accounts/backend) live testing | **PENDING** |
| **Apple Developer** active | Apple (~48h) | Sign-in-with-Apple live test, iOS builds, TestFlight, App Store | Pending |
| **Codemagic** + signing | Brody + Apple | iOS builds / TestFlight | Later |
| Final **name / icon / palette** | Branding (parked) | App Store **submission only** (not development) | Parked |

## Phases (each: subagent-driven, per-task model/effort sizing, two-stage + honesty review, branch → PR → merge on green CI)

### Phase A — Structure & design tokens _(no external deps)_
- Light structural discipline for the future two-app split **without** a premature melos multi-package split (YAGNI: do the real package split when Release 2 starts). Extract a clean `design_system` layer + keep feature/domain modules clean so they can become packages later.
- **Design tokens:** creamsicle (light) + obsidian (dark) color system, semantic tokens, type scale (serif display + geometric sans), spacing, radii, elevation, motion/spring constants, haptics. Light+dark only.
- Core components: buttons, cards, rings, list rows, sheets, nav — all luxury-grade, both modes. Golden/widget tests.

### Phase B — Luxury shell + navigation
- Re-skin the app shell and the existing gym/nutrition surfaces onto the design system (calm, warm, restrained). Placeholder wordmark/icon.
- The **hidden rift seam** on the home screen: a subtle, disabled-in-R1 element where the Release-2 entry will live (no game yet — just the reserved affordance + deep-link stub).

### Phase C — Home dashboard
- The **daily dashboard** (chosen design): readiness, weight trend, calorie/macro rings, next workout — glanceable, one tap into depth. Honest rendering throughout (— over guesses). Pure logic TDD'd; widget tests.

### Phase D — Accounts + Supabase-direct backend _(needs Supabase URL + anon key)_
- Supabase Auth: **Sign in with Apple / email / phone-OTP**. Session + secure token storage; first-run/auth gate.
- **Postgres schema + Row-Level Security** for every domain (profile, weigh-ins/metrics, pantry, nutrition log, workouts, goals) — per-user isolation.
- Repos move from Outbox-only to **Supabase-backed** reads/writes (keep offline-queue semantics: write locally + queue + reconcile).
- Optional: migrate Brody's existing lucky-vps JSON history into his account (nice-to-have).

### Phase E — Real sync + Outbox retry/reject
- Wire the shared `Outbox` flush to Supabase (replace the no-op backend). Implement **Outbox retry/reject** (the deferred "Task 11": bounded retries, reject/expire, surfaced state). Conflict handling. Offline→online reconciliation tests.

### Phase F — Cross-links
- Wire the interconnections the north-star promised: pantry ↔ nutrition (eating-in deduction already exists — surface it) ↔ gym ↔ home dashboard. Keep each honest and offline-safe.

### Phase G — Polish + verification
- End-to-end pass (the `optimal_day` flow, now against Supabase). Full suite green, analyze clean, performance/motion polish, accessibility, empty/error/offline states. Prepare (not submit) App Store metadata scaffolding. Device/TestFlight pass **when Apple is live**.

## Fast-follows (post-R1, not in launch)
AI meal/photo/receipt recognition (Gemini) → proactive **DayPlan brain** → **push notifications** (APNs via Supabase/FCM) → grocery **reorder** → then **Release 2: the game app** (avatar lobby, shop, clothes, social battles; the rift transition; shared monorepo — the real package split happens here).

## Sequencing note
Phases A→B→C need **no external input** — start immediately. Phase D onward needs the **Supabase key** (and Apple for the device/Apple-auth leg). So: build the luxury app + home now; slot in accounts/sync the moment the key lands.
