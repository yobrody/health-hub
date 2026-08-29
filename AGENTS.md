# AGENTS.md — Health Hub

> Convention file for any AI coding agent working in this repo (Claude Code, Codex, etc.).

## What this is

Personal health tracking PWA. React 19 + TypeScript + Vite 7. Brody's daily-use app — used on phone primarily. Doubles as a partial personal-assistant surface (food, workouts, skincare, etc.).

## Read these first

1. **Vault (secrets, never commit):** `C:\Users\brody\.secrets\vault.md`
2. **Memory:** `C:\Users\brody\.claude\projects\D--\memory\MEMORY.md`

## Where the code lives

| Component | Path |
|---|---|
| Frontend (PWA) | `D:\Development\health-hub\` (repo root — src/, functions/) |
| Frontend deploy | Cloudflare Pages, project `health-hub`, live at `https://health-hub-dwz.pages.dev` |
| Backend API | VPS: `~/health-hub/api/` (FastAPI, port 8080) |
| API auth | header `X-Health-Key: <see vault>` — value lives in `C:\Users\brody\.secrets\vault.md` + CF Pages env |
| CF Pages function | `functions/api/[[path]].js` proxies `/api/*` → VPS; `functions/_middleware.js` gates the whole /api surface |
| GitHub | github.com/yobrody/health-hub |

## ⚠️ STACK NOTE (the rest of this file is partly stale)

As of 2026-08 the app is a **native Flutter (iOS-first) app** in `app/`, backed by
**Supabase** (Postgres + RLS + Auth + Deno edge functions in `supabase/`). The
React/Vite/FastAPI notes below describe the **retired** PWA + single-user backend.
Source-of-truth locations for the current app:
- **Design: `app/lib/design_system/`** — `colors.dart`, `typography.dart`, `spacing.dart`,
  `shape.dart`, `motion.dart`, `app_theme.dart`, `showcase.dart` (renders the whole
  system), and `components/`. **Evolve these tokens to re-skin the app — never invent
  a design in a vacuum.**
- **Onboarding: `app/lib/onboarding/onboarding_flow.dart`** (real `PageView` flow).
- **Reliable QA: `app/test/e2e/`** (journey tests that drive the real app) + `app/test/goldens/` (visual).

## Conventions

- **SURVEY BEFORE YOU BUILD.** Before writing any test/screen/doc/tool — or reaching
  for an external tool — `ls`/`grep` the relevant module + read `AGENTS.md`/`docs/`
  first. If it already exists, **extend/evolve it; do NOT reinvent.** (This rule
  exists because prototypes, tests, and a whole design system were re-invented that
  already lived in the repo.)
- _(retired stack, for reference:)_ Frontend: React 19 + TypeScript, Vite 7, Tailwind.
- Backend: FastAPI, single `main.py`, JSON file persistence under `~/health-hub/api/data/`.
- Auth: header-based (`X-Health-Key`) — no user accounts, single-user app.
- VITE_API_KEY is the same value as X-Health-Key, baked at build time.

## Things to not do

- Do not commit `.env`, `vault.md`, or the health key in plaintext anywhere (it lives in CF Pages env + the vault, not in the repo).
- Do not break the offline / PWA install flow — Brody installs this on his phone home screen.
- Do not run a local dev server without first checking nothing's already on the port.
