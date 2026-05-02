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
  --env-file .env \
  health-hub-api
```

## Environment

`.env` (not committed):

```
HEALTH_API_KEY=...
ANTHROPIC_API_KEY=...
```

## Storage

Data is read/written under `WORKSPACE` (default
`/home/lucky/.openclaw/workspace/health`) — markdown files for food
logs, JSON for goals/profile/lists/agenda/routines. The volume mount
above keeps state across container rebuilds.
