# Health Hub

Personal health-tracking PWA — nutrition, workouts, fridge inventory, skincare,
goals, and a lightweight personal assistant (lists + agenda) — all in one app.

## What it does

- **Today** — command-center home: greeting, quick-action pills, week stats,
  fridge "use these soon" alerts, water tracker, next workout preview, today's
  food log, calorie-goal celebration.
- **Nutrition** — fast-log meals (typed, AI photo analysis with multi-item +
  fridge cross-ref, or barcode scan), photo diary, recent foods, history.
- **Fridge** — inventory across fridge / freezer / pantry / condiments with
  receipt-scan ingestion, learned shelf-life per item, quantity controls,
  grocery list integration.
- **Workout** — live workout tracking with rest timer, set/rep/weight logging,
  PRs, exercise search via Wger.
- **Goals** — calories / protein / gym-day targets, weight log with chart.
- **Skincare** — twice-daily checklist (AM/PM) with streak tracking.
- **Lists** — groceries, errands, shopping (CRUD against the personal-assistant
  API).
- **Agenda** — today's plan with priority (urgent/normal/low), check-off, undo.

## Stack

- **Frontend:** React 19 + TypeScript + Vite + vite-plugin-pwa, Recharts for
  charts, React Spring for transitions.
- **Backend proxy:** Cloudflare Pages Functions (`functions/api/[[path]].js`)
  proxy `/api/*` → FastAPI on `128.140.33.150:8080` and add KV-backed extended
  fridge metadata.
- **Backend service:** FastAPI (Docker) on a VPS — health metrics + personal
  assistant endpoints. Source lives on the `add-personal-assistant-api` branch
  (not main). See `functions/api/[[path]].js` for the proxy contract.
- **Storage:** VPS-side JSON for app data, Cloudflare KV for fridge metadata
  + learned shelf-life, R2 for permanent food-photo URLs, browser
  `localStorage` for offline cache and per-device state (e.g. agenda
  priorities).

## Develop

```bash
npm install
npm run dev      # vite dev server
npm run build    # tsc -b && vite build
npm run lint     # eslint
```

## CI

`.github/workflows/ci.yml` runs `build` and `lint` on every PR and push to
`main`. Both are required checks.

## API contract

The full client surface lives in `src/api/client.ts`. All requests go to the
same-origin `/api/*` path (Pages Functions proxy) unless `VITE_API_BASE` is
set for direct-to-VPS debugging. `VITE_API_KEY` only needs to be set when
hitting the VPS directly — the proxy injects the key server-side.
