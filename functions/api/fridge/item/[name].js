/**
 * GET /api/fridge/item/{name}
 *
 * Returns the full merged record for an item:
 *   - core fields from VPS /fridge (name, added, zone — derived from which
 *     zone array contained it)
 *   - all KV `meta:{name}` enrichment (brand, nutrition_per_100g, allergens,
 *     packaging, photo_url, cost, store, etc.)
 *   - `recent_prices` from KV `prices:{name}` (last 20)
 *   - `slot` from VPS /fridge/slots
 *
 * The frontend's ItemDetailModal calls this on open, so we can return a
 * single rich payload instead of the modal making 3 separate calls.
 */
import { CORS, json, normalize, readMeta, readPrices } from '../_enrich-lib.js'

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

// Method-specific so non-GET requests don't 405. The previous version was a
// method-agnostic onRequest that returned 405 for DELETE — breaking remove-
// from-fridge in the UI. CF Pages doesn't fall through to /api/[[path]].js
// when a more-specific route file exists, so DELETE needs its own handler
// here that proxies directly to the VPS.

const VPS_BASE = 'https://hh-api.pestdispatch.co.uk'

export async function onRequestDelete(context) {
  const url = new URL(context.request.url)
  const apiKey = context.env.HEALTH_API_KEY  // no literal fallback — key lives in CF Pages env only (audit B-9)
  // Forward query string verbatim (the ?contains=true fallback path used by
  // the frontend's exact-then-substring two-step delete). The VPS endpoint
  // already enforces exact-match-by-default with optional substring opt-in.
  const targetUrl = `${VPS_BASE}/fridge/item/${context.params?.name}${url.search}`
  try {
    const res = await fetch(targetUrl, {
      method: 'DELETE',
      headers: { 'X-Health-Key': apiKey },
    })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return json({ error: 'VPS unreachable', detail: String(err) }, 502)
  }
}

export async function onRequestGet(context) {
  const rawName = context.params?.name
  const name = decodeURIComponent(String(rawName || '')).trim()
  if (!name) return json({ error: 'name required' }, 400)

  const kv = context.env.FRIDGE_META
  const apiKey = context.env.HEALTH_API_KEY  // no literal fallback — key lives in CF Pages env only (audit B-9)

  // Fetch fridge data + slots in parallel from the proxy itself, so KV merge
  // logic in [[path]].js applies for the /fridge call.
  const origin = new URL(context.request.url).origin
  const [fridgeRes, slotsRes] = await Promise.all([
    fetch(`${origin}/api/fridge`, { headers: { 'X-Health-Key': apiKey } }),
    fetch(`${origin}/api/fridge/slots`, { headers: { 'X-Health-Key': apiKey } }),
  ])

  if (!fridgeRes.ok) return json({ error: 'fridge unreachable' }, 502)
  const fridgeData = await fridgeRes.json()
  const slots = slotsRes.ok ? await slotsRes.json() : {}

  // Find the item across zones. Match is case-insensitive on substring, same
  // rule the FastAPI delete endpoint uses, so the modal works whether the
  // user clicks a card showing the canonical name or a variant.
  const lower = name.toLowerCase()
  let found = null, foundZone = null
  for (const zone of ['fridge', 'pantry', 'freezer', 'condiments']) {
    const arr = fridgeData[zone]
    if (!Array.isArray(arr)) continue
    const hit = arr.find(it => (it.name || '').toLowerCase() === lower)
              || arr.find(it => (it.name || '').toLowerCase().includes(lower))
    if (hit) { found = hit; foundZone = zone; break }
  }
  if (!found) return json({ error: 'item not found' }, 404)

  const meta = await readMeta(kv, found.name) || {}
  const recent_prices = await readPrices(kv, found.name)
  const slot = slots[found.name] || null

  return json({
    name: found.name,
    added: found.added || null,
    zone: foundZone,
    slot,
    // From KV merge in [[path]].js — already on `found`:
    size: found.size ?? meta.size ?? null,
    cost: found.cost ?? meta.cost ?? null,
    store: found.store ?? meta.store ?? null,
    photo_url: found.photo_url ?? meta.photo_url ?? null,
    unit_size_g: found.unit_size_g ?? meta.unit_size_g ?? null,
    unit_count: found.unit_count ?? meta.unit_count ?? null,
    quantity_g: found.quantity_g ?? meta.quantity_g ?? null,
    quantity_count: found.quantity_count ?? meta.quantity_count ?? null,
    // Full enrichment block:
    brand: meta.brand || null,
    barcode: meta.barcode || null,
    nutrition_per_100g: meta.nutrition_per_100g || null,
    typical_size_g: meta.typical_size_g || null,
    typical_unit_count: meta.typical_unit_count || null,
    packaging: meta.packaging || null,
    allergens: meta.allergens || null,
    categories: meta.categories || null,
    shelf_life_days_sealed: meta.shelf_life_days_sealed || null,
    shelf_life_days_opened: meta.shelf_life_days_opened || null,
    confidence: meta.confidence || 'unknown',
    source: meta.source || null,
    enriched_at: meta.enriched_at || null,
    recent_prices,
  })
}
