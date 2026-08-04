# CLAUDE.md — Health Hub (handoff / current state)

Read **AGENTS.md** first for repo conventions, where the code lives, deploy targets, and the vault/secret rules. This file is the live handoff: where things stand and what's next. Fuller detail (decisions, per-commit notes) is in the claude.ai Project docs `claude/health-hub-status-and-backlog.md` and `claude/health-hub-feedback-2026-08-04b.md` — the key bits are duplicated below in case those aren't loaded here.

## Stack / deploy (quick)
- Frontend: React 19 + TS + Vite PWA → Cloudflare Pages, auto-deploys on push to `main` (github.com/yobrody/health-hub). Live: health-hub-dwz.pages.dev.
- Cloudflare Pages Functions: `functions/api/[[path]].js` proxies `/api/*` → VPS; `functions/_middleware.js` gates it; `functions/api/ai/*` are Gemini endpoints. **These auto-deploy — no VPS step.**
- Backend: FastAPI single `api/main.py` in Docker on `lucky-vps` (ssh alias; user lucky@128.140.33.150 port 2222). Data: JSON under `~/.openclaw/workspace/health`. **Backend changes need a manual redeploy** (scp main.py + docker rebuild — block at bottom of the status doc).
- Verification harness in-repo: `scripts/e2e-smoke/` (Playwright + mock server). Run after UI changes.

## Status (as of 2026-08-04, latest commit `15d7266`)
Everything from the big 2026-08-04 feedback batch is shipped + deployed (backend redeploy done). Recent commits:
- `71f53f2` workout persistence (no more lost sessions). `be5d89d` real machine weights + cardio no-weight + prone-leg-curl swap. `bf86111` warm-ups removed + rep-shortfall-as-miss. `579ed2a` weight logging via Today tile. `f4026d3` **new Progress/stats page** (`src/pages/Stats.tsx`). `b9dee04` + `15d7266` food label per-100g→pack scaling + branded front-of-pack names + graceful barcode failures.
- Earlier: `e84c0e7` scan self-improvement telemetry + nightly review job (`trig_...`); `0692165` coach-insights + hydration; `a3d95c2` on-device gym fixes.
- Health key rotated. Nightly backup installed. Skill block already matches Brody's routine.

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
