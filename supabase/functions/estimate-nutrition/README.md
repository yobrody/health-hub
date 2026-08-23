# `estimate-nutrition` Edge Function (P1: AI nutrition estimate)

Takes EITHER a base64 photo of a meal OR a short text description, asks Gemini
to **estimate** the meal's macros, and returns a single honest estimate with a
confidence. It only **estimates** — the app prefills the capture form as an
estimate (`~` / `AccuracyTier.estimate`) and the user confirms/edits before
anything is logged.

> ⚠️ **NOT DEPLOYED YET.** The Flutter app already calls this function by name
> (`estimate-nutrition`) via `SupabaseNutritionEstimateClient`, behind a
> test-overridable provider, so nothing hits the network in tests. The
> `GEMINI_API_KEY` function secret is **already set** on the Health Hub project.

## Request / response contract

`POST /functions/v1/estimate-nutrition`

Headers: `Authorization: Bearer <user JWT>` (required — per-user action),
`Content-Type: application/json`.

Body — provide **exactly one** of `image` or `text`:

```json
{ "image": "<base64 jpeg>" }
```

```json
{ "text": "grilled chicken breast with rice and broccoli" }
```

- `image`: a base64-encoded JPEG buffer (raw base64, no `data:` prefix). The
  Flutter client base64-encodes the captured photo's bytes.
- `text`: a short free-text meal description.

Success (`200`) — a single estimate:

```json
{
  "name": "Chicken salad",
  "kcal": 420,
  "protein_g": 38,
  "carbs_g": 12,
  "fat_g": 24,
  "confidence": 0.6,
  "note": "Assumed a standard bowl portion."
}
```

- These are **estimates**, never measured values. The app always shows them as
  an estimate (`~` / `AccuracyTier.estimate`).
- Any of `name` / `kcal` / `protein_g` / `carbs_g` / `fat_g` / `note` may be
  `null` when the model can't estimate it — **never** a fabricated `0` or an
  invented precise number.
- `confidence` ∈ `[0, 1]`.

Errors (honest, and **never** a fabricated estimate):

| status | body                                       | meaning                                |
|-------:|--------------------------------------------|----------------------------------------|
| `400`  | `{"error":"bad_request"}` / `"no_input"`   | malformed body / neither image nor text|
| `401`  | `{"error":"unauthorized"}`                 | missing `Authorization`                |
| `405`  | `{"error":"method_not_allowed"}`           | non-POST                               |
| `502`  | `{"error":"upstream_error", ...}` / `"no_estimate"` | Gemini failed / unreachable / unparseable |
| `503`  | `{"error":"estimator_not_configured"}`     | `GEMINI_API_KEY` not set               |

The Flutter `SupabaseNutritionEstimateClient` maps any non-2xx / non-JSON / empty
result to `null`, and the capture screen falls back to the manual form.

## Deploy (GEMINI_API_KEY already set)

Project ref: the Health Hub Supabase project (see `env.local.json` /
`supabase/migrations/README.md`).

### Supabase CLI

```bash
# from repo root (the folder containing supabase/)
supabase functions deploy estimate-nutrition --project-ref <PROJECT_REF>
```

JWT verification is ON by default (this is a per-user action) — do **not** pass
`--no-verify-jwt`. The `GEMINI_API_KEY` secret is already set on the project, so
no `supabase secrets set` step is needed. (If ever rotating it:
`supabase secrets set GEMINI_API_KEY=<the key> --project-ref <PROJECT_REF>`.)

## Notes

- Model: `gemini-2.5-flash` via the Generative Language API. Change
  `GEMINI_MODEL` in `index.ts` to standardise on a different flash model.
- The prompt pins `responseMimeType: application/json` and a low temperature for
  stable, honest estimation, forbids precise guessing when unsure (→ `null`),
  and the function defensively strips a code fence + parses the first JSON
  object.
- No data is persisted here — the function is stateless; persistence happens in
  the app's nutrition repo only after the user confirms the estimate.
