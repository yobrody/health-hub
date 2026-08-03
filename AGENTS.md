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

## Conventions

- Frontend: React 19 + TypeScript, Vite 7, Tailwind. Mobile-first — Brody uses it on phone.
- Backend: FastAPI, single `main.py`, JSON file persistence under `~/health-hub/api/data/`.
- Auth: header-based (`X-Health-Key`) — no user accounts, single-user app.
- VITE_API_KEY is the same value as X-Health-Key, baked at build time.

## Things to not do

- Do not commit `.env`, `vault.md`, or the health key in plaintext anywhere (it lives in CF Pages env + the vault, not in the repo).
- Do not break the offline / PWA install flow — Brody installs this on his phone home screen.
- Do not run a local dev server without first checking nothing's already on the port.
