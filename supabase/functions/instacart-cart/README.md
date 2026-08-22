# `instacart-cart` Edge Function

Creates an Instacart **pre-filled shopping list page** from the user's grocery
list via the [Instacart Developer Platform (IDP)](https://www.instacart.com/developer) API,
and returns the URL. The Flutter client opens this URL — Instacart then opens
(in-app or browser) with all items pre-loaded, ready for the user to check out.

> ⚠️ **NOT DEPLOYED YET.** No live `INSTACART_API_KEY` is wired. Deploy + set
> the secret when the key lands. The Flutter app already calls this function by
> name (`instacart-cart`) via `SupabaseInstacartClient`, behind a
> test-overridable provider, so nothing hits the network in tests.

## Honesty

- This function **never claims** an order was placed or is in progress. It
  returns a URL that opens Instacart for the user to complete the purchase there.
- On any failure (missing key, upstream error, bad input) it returns an honest
  error status so the Flutter client falls back to the existing Instacart
  search deep-link. **No fabricated URLs are ever returned.**
- The items list forwarded to Instacart is the user's **real grocery list**,
  passed verbatim from the client.

## Request / response contract

`POST /functions/v1/instacart-cart`

Headers:
- `Authorization: Bearer <user JWT>` (required — per-user action)
- `Content-Type: application/json`

Body:
```json
{ "items": ["Oat Milk", "Eggs", "Greek Yoghurt"] }
```

- `items`: non-empty array of grocery item name strings (the user's real list).

### Success (`200`)

```json
{ "products_link_url": "https://www.instacart.com/store/checkout_redirect?..." }
```

- `products_link_url`: the Instacart pre-filled shopping list page. The Flutter
  client launches this URL. It is **not** a checkout confirmation.

### Errors (honest — never a fabricated URL)

| status | body                                               | meaning                                    |
|-------:|----------------------------------------------------|--------------------------------------------|
| `400`  | `{"error":"bad_request","detail":"..."}`           | missing/invalid body or empty items        |
| `401`  | `{"error":"unauthorized"}`                         | missing `Authorization`                    |
| `405`  | `{"error":"method_not_allowed"}`                   | non-POST                                   |
| `502`  | `{"error":"upstream_error","status":...,"detail":...}` | Instacart API returned non-2xx          |
| `502`  | `{"error":"upstream_unreachable","detail":"..."}`  | network / DNS failure reaching Instacart   |
| `502`  | `{"error":"upstream_bad_json"}`                    | Instacart response was not valid JSON      |
| `502`  | `{"error":"unexpected_response","detail":"..."}`   | `products_link_url` missing from response  |
| `503`  | `{"error":"instacart_not_configured","detail":"..."}` | `INSTACART_API_KEY` secret not set     |

The Flutter `SupabaseInstacartClient` maps any non-2xx / missing URL to `null`,
which the Cart page handles by falling back to the Instacart search deep-link —
so the Instacart button **always** does something useful even when this function
is not deployed or the key hasn't landed yet.

## Upstream API (Instacart Developer Platform)

- **Endpoint:** `POST https://connect.instacart.com/idp/v1/products/products_link`
- **Dev endpoint:** `POST https://connect.dev.instacart.tools/idp/v1/products/products_link`
  (set `INSTACART_ENV=dev` to use dev server)
- **Auth:** `Authorization: Bearer <INSTACART_API_KEY>`
- **Request body:**
  ```json
  { "line_items": [{ "name": "Oat Milk" }, { "name": "Eggs" }] }
  ```
  Each `line_item` requires at minimum a `name`. UPC is optional (omitted here
  since the grocery list stores names only).
- **Response:**
  ```json
  { "products_link_url": "https://..." }
  ```

## Deploy (when the Instacart key is ready)

Project ref: the Health Hub Supabase project (see `env.local.json` /
`supabase/migrations/README.md`).

### Step 1 — Deploy the function

```bash
# from repo root (the folder containing supabase/)
supabase functions deploy instacart-cart --project-ref <PROJECT_REF>
```

JWT verification is ON by default (this is a per-user action) — do **not** pass
`--no-verify-jwt`.

### Step 2 — Set the secret

```bash
supabase secrets set INSTACART_API_KEY=<your_instacart_api_key> \
  --project-ref <PROJECT_REF>
```

Optionally, to use the Instacart dev server for initial testing:
```bash
supabase secrets set INSTACART_ENV=dev --project-ref <PROJECT_REF>
```

Remove `INSTACART_ENV` (or set it to anything other than `dev`) for production.

### Step 3 — Verify

After deploying and setting the secret, test with a real session JWT:

```bash
curl -X POST \
  "https://<PROJECT_REF>.supabase.co/functions/v1/instacart-cart" \
  -H "Authorization: Bearer <user_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"items":["Oat Milk","Eggs"]}'
# Expected: { "products_link_url": "https://..." }

# Without the key (before setting it):
# Expected: 503 { "error": "instacart_not_configured", ... }
```

A 503 before the key is set is the intended "not configured" signal — the
Flutter app falls back to search and the user still reaches Instacart.

## Notes

- The function is stateless — no data is persisted here. It's a pure proxy
  from the client's item list to the Instacart IDP API.
- Items are passed by name only. Instacart's API handles product matching.
- If the IDP API shape changes (e.g. the request body key `line_items` renames),
  update the `lineItems` mapping in `index.ts`.
