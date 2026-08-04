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

## Open / pending
1. **Optional CF env var:** `SCAN_SAMPLES_TOKEN = hh_scan_431NLxeqrWM790HmkC3pB7qIKZP9RWWY` in Cloudflare Pages (Production) + retry deploy, to activate the nightly scan self-improvement review reads. No-ops harmlessly until set.
2. **NEXT WORK (Brody's 2026-08-04 asks) — make Health Hub weight-aware & honest:**
   a. **TDEE-derived goals.** Body weight now feeds BMR/TDEE (`GET /tdee` in main.py — was defaulting to 80kg, now uses the latest logged weight; Brody is 62kg). But calorie + protein GOALS are still fixed values (goals.md), not derived. Add: suggest a calorie goal from real TDEE and a protein goal from bodyweight (Brody's aim = **muscle gain** → surplus over maintenance, protein ~1.8–2.2 g/kg). Surface on Goals page; let him accept/adjust. Backend + frontend.
   b. **Workout weight-awareness.** Engine already uses bodyweight for plateau detection (`diagnoseProgress`, `bodyweightFlatWeeks:3`) and a nutrition "properly eating" gate. Extend so goals/progress reflect the gain intent.
   c. **Honesty audit.** Brody asked "is anything else not honest?" — audit for other places using hardcoded defaults / placeholder / stale data like the old 80kg TDEE default. Report + fix. (Known-good: machine weights self-correct, scans scale to pack, etc.)
   d. **Final-vision additions.** Brody wants a "what should we add for the final vision of Health Hub" pass — propose a roadmap.

## Conventions when shipping from Claude Code (local)
You're in the real git repo here, so it's simpler than the Cowork flow: edit → `npm run build` + `npx vitest run` + `npx tsc --noEmit` + `npx eslint` → `git add/commit/push` (Cloudflare auto-deploys frontend/Functions). For backend (`api/main.py`) run the scp + docker redeploy (status doc). Commit trailer used this project:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
(Adjust the model name to whoever's committing.)
