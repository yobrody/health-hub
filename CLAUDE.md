# CLAUDE.md — Health Hub (handoff / current state)

Read **AGENTS.md** first for repo conventions, where the code lives, deploy targets, and the vault/secret rules. This file is the live handoff: where things stand and what's next. Fuller detail (decisions, per-commit notes) is in the claude.ai Project docs `claude/health-hub-status-and-backlog.md` and `claude/health-hub-feedback-2026-08-04b.md` — the key bits are duplicated below in case those aren't loaded here.

## Stack / deploy (quick)
- Frontend: React 19 + TS + Vite PWA → Cloudflare Pages, auto-deploys on push to `main` (github.com/yobrody/health-hub). Live: health-hub-dwz.pages.dev.
- Cloudflare Pages Functions: `functions/api/[[path]].js` proxies `/api/*` → VPS; `functions/_middleware.js` gates it; `functions/api/ai/*` are Gemini endpoints. **These auto-deploy — no VPS step.**
- Backend: FastAPI single `api/main.py` in Docker on `lucky-vps` (ssh alias; user lucky@128.140.33.150 port 2222). Data: JSON under `~/.openclaw/workspace/health`. **Backend changes need a manual redeploy** (scp main.py + docker rebuild — block at bottom of the status doc).
- Verification harness in-repo: `scripts/e2e-smoke/` (Playwright + mock server). Run after UI changes.

## Status (as of 2026-08-17, latest commit `37ecec4`)
**Honesty/correctness audit batch SHIPPED + DEPLOYED** (`6b5f2a0` batch, `37ecec4` middleware fix). A full-codebase scan (5 parallel review agents + the `health-hub-reviewer`) surfaced bugs that passed the suite but were still wrong; all fixed test-first. Frontend + Functions pushed to `main` (CF auto-deployed, verified live); backend `main.py` manually redeployed on lucky-vps + verified.
- **Nutrition honesty** — calorie/protein/carbs/fat rings + meal targets now render `—` when goals didn't load instead of dividing by `?? 2200 / ?? 140` (new tested `lib/ring.ts` `ringProgress`). DB-search results **scale per-100g → serving size** (a 500 g pot no longer logs as 59 kcal) and never prefill a fake `0` kcal; photo→OFF path got the relevance guard. `parseServingGrams` + `isRelevantMatch` extracted into shared, tested `lib/packaged-food.ts` (SmartScanner reuses them).
- **Gym confetti** — the "next notch" is now derived from the weight ACTUALLY lifted (via `effectiveStack` passed into `evaluateProgressionFeedback`), not a value seeded at session start that went stale on a mid-session weight change; `recalibrating` threaded through. A test documents the old bug + proves the fix.
- **Transformation** — removed the auto-seed of a hardcoded 72 kg goal (it wrote a guess to the profile as if saved); de-hardcoded the `12% BF` label; milestones beyond the goal are flagged (`beyondGoal`) + shown as a disclosed stub, not a forever-"approaching" bar.
- **streaks.ts** — day keys now built from LOCAL date components (UTC `toISOString` was an off-by-one for non-UTC users). Stats/WeeklyReport(hydration)/Today coach-solve: placeholder goals gated.
- **Infra/offline** — `probeBackend` reports `degraded` on a 5xx (was faking `online`); `saveProfile`/`updateGoals`/`updateTdeeProfile` queue offline; SmartScanner shows "saved offline" not "failed" for queued writes.
- **Backend (`main.py`)** — daily kcal unified via `_day_intake_kcal` (3 sites) so `/tdee`, `/tdee/adaptive`, `/timeline` agree with `/today` (meal-plan lines were counted as 0); `_all_weighins` now folds in **HealthKit** weights (were invisible to TDEE/roadmap); barcode AI-estimate + `/food/smart` no longer fabricate micros/macros (→ `null`, not `0`); barcode `code` validated; `/sleep` validates time (`_parse_hhmm`, **400 not 500**); `atomic_write_text` fsyncs + uses a unique tmp.
- Tests: **+14 frontend (396 green), +16 backend logic (26 green)**; tsc/eslint/build clean; `health-hub-reviewer` pass (its 2 findings — a `?? 0` kcal prefill and barcode `0`-macro fallback — fixed pre-deploy).
- **Backend redeploy DONE 2026-08-17** via `~/health-hub/api/deploy.sh`. Data backed up to `~/health-hub-backups/20260817-110529/` first; verified after: container up + `unless-stopped` + both mounts, weight 62.0/63.0 intact, `/sleep` bad-time → 400, `/barcode/abc` → 400, `/tdee` reads real logged weight.
- ⚠️ **Regression caught + fixed same session:** the first middleware change dropped `Sec-Fetch-Site: none` from the allowlist while `_middleware.js` still gated EVERY route — so a fresh page load / PWA launch (a top-level nav sends `Sec-Fetch-Site: none`) got a 403 `{"error":"forbidden"}`. Live-verification caught it; `37ecec4` scopes the gate to `/api/*` only (static shell always loads; API still blocks `none`/unauth — app→API calls are same-origin). Verified live: `root(none)→200`, `api/today(none)→403`, `api/today(same-origin)→200`. **Lesson for next time: `functions/_middleware.js` runs on ALL routes, not just `/api/*` — never gate the static shell.**

### Still worth doing (deferred from this batch, low/medium value)
SW cache staleness signal (`X-SW-Cache`) so month-old workout/weight data isn't shown as live; planned-vs-eaten separation for `/ai/meal-plan/use` (planned meals currently count as eaten); queue `addMetric`/`logSleep` offline; per-file write locks in the backend; `/food/search` sodium-from-salt fallback.

## Status (as of 2026-08-05, latest commit `0c0066b`)
**Transformation system SHIPPED + DEPLOYED (`0c0066b`, branch `feat/transformation-system` merged).** New "Transformation" tab (reachable from the Workout page 🎯 card) ties the gym to Brody's 72kg goal:
- **Auto-progression confetti** — `evaluateProgressionFeedback` (in `lib/workout-progression.ts`) reuses the existing `predictNextWeight` verdict; confetti fires ONLY on a genuine earned weight jump (`bump-*`), never a topped-but-soft set. Wired into `Workout.tsx` `applySetFeedback` (per-exercise, once each) + a finish-of-session safety-net summary. This was the headline ask ("top of rep range on all sets → auto-increase + confetti"), done engine-honestly.
- **Goal-aware per-exercise targets** — `lib/strength-targets.ts`: compounds get a bodyweight-ratio benchmark scaled to the goal; isolations scale from the user's own best; `null` when nothing honest to ground on. Shown as progress bars on the Transformation page.
- **Roadmap** — `lib/transformation.ts` `projectRoadmap`: 62→72kg from the real weekly trend when reliable (≥14d) else a healthy default rate; ETA to month precision only.
- **Physique milestones** — same file `physiqueMilestones`: weight-anchored for size, **body-fat-anchored for abs** (honest "a bulk raises body fat" caveat), `needs-data` when no BF reading.
- **Monthly tape measurements** — shoulders/chest/arm/hips/thigh/neck on the Body page (`Metrics.tsx`) with a monthly-cadence nudge + trends. Backend `BodyMetricIn` extended.
- **Goal weight** persisted to the profile (`target_weight_kg`, PUT `/tdee/profile`); **set to 72 on the VPS during deploy** (verified `profile.target_weight_kg = 72.0`).
- New pure logic fully TDD'd (21 new tests); suite 382 green, tsc/eslint/build clean, health-hub-reviewer pass (its one blocker — unsaved-goal fallback — fixed: page now shows a "set your goal" prompt rather than projecting against a guess).
- **Backend redeploy DONE 2026-08-05** via the fixed `~/health-hub/api/deploy.sh` (on-disk Dockerfile + BOTH mounts + `--env-file`). Data backed up to `~/health-hub-backups/20260805-122816/` first; verified after: container up + `unless-stopped` + both mounts, weight 62.0 intact, new metric fields (`shoulders_cm`/`hips_cm`/`thigh_cm`/`neck_cm`) + `target_weight_kg` param live in OpenAPI, VAPID key (`BBOWVHT…`) + push cron unaffected.

### Earlier — 2026-08-04 batch (shipped + deployed)
Everything from the big 2026-08-04 feedback batch is shipped + deployed (backend redeploy done). Recent commits:
- `e019d49` **scan-honesty fix** — packaged food no longer guesses (→ Open Food Facts lookup, else honest `~` + "snap the label"); micronutrients only shown when measured, else `—`. Backend `/scan/smart` on lucky-vps redeployed + verified (front-of-pack rule + per-item `source`/`needs_label` + real-grams rule live; both `-v` mounts intact, data intact, pywebpush + VAPID unaffected; added `--restart unless-stopped`). `982ac28` fix stale repo `api/Dockerfile` (drop unused `anthropic`, add `pywebpush`).
- `71f53f2` workout persistence (no more lost sessions). `be5d89d` real machine weights + cardio no-weight + prone-leg-curl swap. `bf86111` warm-ups removed + rep-shortfall-as-miss. `579ed2a` weight logging via Today tile. `f4026d3` **new Progress/stats page** (`src/pages/Stats.tsx`). `b9dee04` + `15d7266` food label per-100g→pack scaling + branded front-of-pack names + graceful barcode failures.
- Earlier: `e84c0e7` scan self-improvement telemetry + nightly review job (`trig_...`); `0692165` coach-insights + hydration; `a3d95c2` on-device gym fixes.
- Health key rotated. Nightly backup installed. Skill block already matches Brody's routine.

### ⚠️ VPS deploy tooling was drifted — fixed 2026-08-05 (during the `e019d49` deploy)
Two landmines found on lucky-vps and defused; the on-disk (correct) Dockerfile was used for the deploy so nothing was at risk during it:
1. **VPS `deploy.sh` was dangerous** — it overwrote the good Dockerfile with a stale inline one (no `pywebpush`), mounted `$API_DIR/data:/app/data` instead of `/data` (so `HEALTH_DATA_DIR=/data` was **unmounted → data loss on next rebuild**), and skipped `--env-file`. Fixed in place (stale backed up as `deploy.sh.bak-stale-*`); now uses the on-disk Dockerfile + correct BOTH mounts + `--env-file`.
2. **Repo `api/Dockerfile` was stale** — listed unused `anthropic`, missing `pywebpush`. Fixed + pushed (`982ac28`).

## Web-push notifications — SHIPPED + DEPLOYED 2026-08-04 (commit `cf81f1a`)
Real server→device push (readiness / weekly check-in / hydration), on top of the local-only `lib/notifications.ts`.
- **Frontend (live via CF):** `lib/push.ts`, `components/PushSettings.tsx` (on the Goals page — Enable + 3 per-type toggles, **all default OFF**, opt-in per type; surfaces the iOS "Add to Home Screen" caveat). `public/sw-push.js` push/notificationclick handlers pulled into the Workbox `generateSW` build via `vite.config` `importScripts`.
- **Backend (deployed on lucky-vps):** `push_subscriptions.json` store (upsert, per-type prefs, 404/410 pruning). Endpoints `/push/{vapid_public,subscribe,unsubscribe,prefs,run}` + `/readiness`. Server ports of readiness (mirrors `lib/readiness.ts`) and weekly trend (mirrors `lib/calorie-target.ts`), parity-locked by `api/tests/test_readiness.py` (10 tests). Honesty gates: each job is a no-op unless the signal is real (readiness=recent sleep, weekly=actionable trend vs a REAL goal via `_all_weighins`, hydration=genuinely low). health-hub-reviewer's 2 findings fixed pre-deploy.
- **VAPID keys:** in `~/health-hub/api/.env` on lucky-vps (`VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`; public = `BBOWVHT…jheI`). Also snapshotted at `~/health-hub-backups/20260804-194559/env.with-vapid.bak`. **NOT yet in the SOPS vault** (regenerable if lost → devices just re-subscribe). Dockerfile now installs `pywebpush`.
- **Scheduler:** cron on lucky-vps (`CRON_TZ=Europe/London`) → `~/health-hub/push-cron.sh <job>`: 07:00 readiness, 09:00 Sun weekly, 14:00 hydration. Logs to `~/health-hub/push-cron.log`.
- **Verified live:** container up with both mounts, data intact (weight 62.0, goal_direction gain), `/push/vapid_public` returns the key, jobs no-op honestly with 0 subs. **Untested until a real device subscribes:** actual phone delivery — install the PWA to the Home Screen, open Goals → enable push → toggle a type, then `~/health-hub/push-cron.sh readiness` (after a sleep entry exists) should deliver.

## Open / pending
1. **Optional CF env var:** `SCAN_SAMPLES_TOKEN = hh_scan_431NLxeqrWM790HmkC3pB7qIKZP9RWWY` in Cloudflare Pages (Production) + retry deploy, to activate the nightly scan self-improvement review reads. No-ops harmlessly until set.
2. **(Optional) VAPID keys → SOPS vault** — currently VPS-only (+ backup snapshot). Add via the normal vault flow if you want them off-box; regenerable otherwise.

## ⚠️ DEPLOY CHANGED (2026-08-04) — backend now needs a SECOND volume mount
`DATA_DIR` used to live in the image's ephemeral layer (only WORKSPACE was mounted), so **every rebuild wiped workouts/weight/metrics/profile/lists/routines**, and profile.json never persisted. Fixed: `main.py` reads `HEALTH_DATA_DIR` (set to `/data` in the VPS `.env`), and the container now bind-mounts `/home/lucky/health-hub-data:/data`. **Any future `docker run` MUST include BOTH `-v` mounts** (see `api/README.md` Deploy). Existing data was migrated + backed up to `~/health-hub-backups/<ts>/` on lucky-vps. Historical weigh-ins (May 64.5kg) + 3 old workouts were recovered into the persistent dir.

## Done — Brody's 2026-08-04 "weight-aware & honest" batch (shipped + deployed)
- a. **TDEE-derived goals** ✓ `src/lib/goal-suggestions.ts` (calories = TDEE ± surplus/deficit, protein = bodyweight × g/kg: 2.0 gain / 2.2 cut / 1.6 maintain). Accept/tweak card on the Goals page; server mirror `_suggested_goals` in main.py (parity locked by test + `_round_half_up`).
- b. **Muscle-gain intent carried through** ✓ Goal direction now persists to the profile (`PUT /tdee/profile?goal_direction=`); `Stats.tsx` progress tile colours gain as GOOD via `weightProgressTone`.
- c. **Honesty audit** ✓ `docs/audits/2026-08-04-honesty-audit.md`. Big finds: the ephemeral-DATA_DIR data-loss bug (above), `/tdee` reading weight from only `body_metrics.json` (fell back to 80kg despite the real 62kg in `weight_log.json` — fixed via `_all_weighins`), goal direction assumed "maintain". All fixed + verified live.
- d. **Roadmap** — delivered to Brody in-chat (not a doc).
- **Review discipline:** added `.claude/agents/health-hub-reviewer.md` (correctness/honesty invariants). It reviewed this batch; its 3 findings were fixed in `3f013f3`.

**Still worth doing (from the audit, low severity):** offline goal fallbacks (`?? 2200`/`?? 140`) draw a fake reference line when goals fetch fails — render `—` instead; add a "set your height/age for accurate TDEE" nudge (height/age/sex still default until Brody fills the now-persistent profile editor).

## Conventions when shipping from Claude Code (local)
You're in the real git repo here, so it's simpler than the Cowork flow: edit → `npm run build` + `npx vitest run` + `npx tsc --noEmit` + `npx eslint` → `git add/commit/push` (Cloudflare auto-deploys frontend/Functions). For backend (`api/main.py`) run the scp + docker redeploy (status doc). Commit trailer used this project:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
(Adjust the model name to whoever's committing.)
