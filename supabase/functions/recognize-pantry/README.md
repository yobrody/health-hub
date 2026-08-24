# `recognize-pantry` Edge Function (R-2: AI photo → pantry)

Takes base64 photos of a fridge / freezer / pantry / spice rack, asks Gemini
vision to identify the items **actually visible**, and returns them as honest
suggestions with a per-item confidence. It only **suggests** — the app shows the
suggestions and the user confirms before anything is saved.

> ⚠️ **NOT DEPLOYED YET.** There is no live Gemini key wired. Deploy + set the
> secret (below) when the key lands. The Flutter app already calls this function
> by name (`recognize-pantry`) via `SupabaseRecognitionClient`, behind a
> test-overridable provider, so nothing hits the network in tests.

## Request / response contract

`POST /functions/v1/recognize-pantry`

Headers: `Authorization: Bearer <user JWT>` (required — per-user action),
`Content-Type: application/json`.

Body:

```json
{ "images": ["<base64 jpeg>", "<base64 jpeg>"] }
```

- `images`: 1+ base64-encoded JPEG buffers (raw base64, no `data:` prefix). The
  Flutter client base64-encodes each captured photo's bytes.

Success (`200`):

```json
{
  "items": [
    { "name": "Milk", "zoneGuess": "fridge", "confidence": 0.92,
      "qtyGuess": null, "unitGuess": null },
    { "name": "Eggs", "zoneGuess": "fridge", "confidence": 0.81,
      "qtyGuess": 6, "unitGuess": "unit" }
  ]
}
```

- `items` may be **empty** — an honest "couldn't identify anything", not an
  error. The app shows a manual-add fallback.
- `zoneGuess` ∈ `fridge | pantry | freezer | condiments`.
- `confidence` ∈ `[0, 1]`.
- `qtyGuess` / `unitGuess` are `null` unless clearly visible — **never**
  fabricated. `unitGuess` is null whenever `qtyGuess` is null.

Errors (honest, and **never** a fabricated item list):

| status | body                                     | meaning                              |
|-------:|------------------------------------------|--------------------------------------|
| `400`  | `{"error":"bad_request"}` / `"no_images"`| malformed body / no images           |
| `401`  | `{"error":"unauthorized"}`               | missing `Authorization`              |
| `405`  | `{"error":"method_not_allowed"}`         | non-POST                             |
| `502`  | `{"error":"upstream_error", ...}`        | Gemini failed / unreachable / bad JSON |
| `503`  | `{"error":"recognizer_not_configured"}`  | `OPENROUTER_API_KEY` not set             |

The Flutter `SupabaseRecognitionClient` maps any non-2xx / non-JSON to a
`RecognitionFailure`, which the Food gate surfaces truthfully and falls back to
manual add.

## Deploy (when the Gemini key is ready)

Project ref: the Health Hub Supabase project (see `env.local.json` /
`supabase/migrations/README.md`).

### Option A — Supabase CLI

```bash
# from repo root (the folder containing supabase/)
supabase functions deploy recognize-pantry --project-ref <PROJECT_REF>

# set the Gemini key as a function secret
supabase secrets set OPENROUTER_API_KEY=<the key> --project-ref <PROJECT_REF>
```

JWT verification is ON by default (this is a per-user action) — do **not** pass
`--no-verify-jwt`.

### Option B — Management API

```bash
# bundle index.ts and POST it
curl -X POST \
  "https://api.supabase.com/v1/projects/<PROJECT_REF>/functions" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"recognize-pantry","name":"recognize-pantry","verify_jwt":true}'
# then upload the function body per the Management API function-deploy flow.

# set the secret
curl -X POST \
  "https://api.supabase.com/v1/projects/<PROJECT_REF>/secrets" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '[{"name":"OPENROUTER_API_KEY","value":"<the key>"}]'
```

## Notes

- Model: `gemini-2.5-flash` (vision) via the Generative Language API. Change
  `OPENROUTER_MODEL` in `index.ts` if you standardise on a different flash-vision
  model.
- The prompt pins `responseMimeType: application/json` and a low temperature for
  stable, honest extraction, and the function still defensively strips a code
  fence + parses the first JSON object.
- No data is persisted here — the function is stateless; persistence happens in
  the app's pantry repo after the user confirms.
