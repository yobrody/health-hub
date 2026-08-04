# Health Hub API

FastAPI backend for the Health Hub PWA. Runs on port 8080. Serves
`/today`, `/food`, `/fridge`, `/workouts`, `/goals`, `/users/profile`,
`/stats/week`, `/lists/{name}`, `/agenda`, `/routines/{name}`. Auth via
the `X-Health-Key` header.

The Cloudflare Pages Function `functions/api/[[path]].js` proxies all
`/api/*` requests from the frontend to this service.

## Deploy

```bash
docker build -t health-hub-api .
docker run -d --name health-hub-api \
  -p 8080:8080 \
  -v /home/lucky/.openclaw/workspace/health:/home/lucky/.openclaw/workspace/health \
  -v /home/lucky/health-hub-data:/data \
  --env-file .env \
  health-hub-api
```

**Both volume mounts are required.** `WORKSPACE` holds food logs + goals.md;
the second holds `DATA_DIR` — workouts, weight, metrics, profile, lists,
routines, agenda. `DATA_DIR` defaults to `./data` *inside the image*, which is
ephemeral, so `.env` sets `HEALTH_DATA_DIR=/data` and we mount a host dir there.
Miss this mount and every `docker build` + `run` wipes the user's non-food data
(this happened — see `docs/audits/2026-08-04-honesty-audit.md`).

## Environment

`.env` (not committed):

```
HEALTH_API_KEY=...
GEMINI_API_KEY=...        # Google AI Studio — free tier (gemini-2.5-flash)
HEALTH_DATA_DIR=/data     # persistent DATA_DIR mount (see Deploy)
```

## Storage

Two roots:
- `WORKSPACE` (default `/home/lucky/.openclaw/workspace/health`) — food-log
  markdown, `goals.md`, `fridge.md`.
- `DATA_DIR` (`HEALTH_DATA_DIR`, default `./data`) — JSON for
  workouts/weight/metrics/profile/lists/routines/agenda/sleep/meal-plans.

Both must be bind-mounted from the host or state is lost on rebuild.
