/**
 * POST /api/fridge/enrich
 *
 * Body: {
 *   name: string,                       // required
 *   barcode?: string,                   // optional — if known, OFF barcode lookup runs first
 *   hints?: { store, cost, size, date }, // optional — appended to prices:{name} if cost present
 *   force?: boolean,                    // bypass "already enriched recently" short-circuit
 * }
 *
 * Returns: { ok: true, meta: <enriched record>, recent_prices: [...] }
 *
 * Side effects:
 *   - Writes meta:{name} with full enriched record (merged with existing).
 *   - Appends prices:{name} when hints.cost is present.
 */
import {
  CORS, json, normalize, fetchOFFByBarcode, searchOFFByName,
  geminiEstimate, mergeEnrichment, appendPriceHistory,
  readMeta, writeMeta, readPrices,
} from './_enrich-lib.js'

const FRESH_SECS = 30 * 24 * 60 * 60   // 30d — skip re-enrich within this window unless force

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const name = String(body?.name || '').trim()
  if (!name || name.length > 120) return json({ error: 'name required' }, 400)

  const kv = context.env.FRIDGE_META
  const force = !!body.force
  const hints = body.hints && typeof body.hints === 'object' ? body.hints : null

  // Short-circuit: if we already have a high-confidence record fresher than
  // FRESH_SECS, return it (and still append price history if hints have it).
  const existing = await readMeta(kv, name)
  const fresh = existing
    && existing.confidence === 'high'
    && existing.enriched_at
    && (Date.now() / 1000 - existing.enriched_at) < FRESH_SECS

  if (fresh && !force) {
    if (hints?.cost) await appendPriceHistory(kv, name, hints)
    return json({ ok: true, meta: existing, recent_prices: await readPrices(kv, name), source: 'cache' })
  }

  // Build the cascade. Each layer either contributes an `enriched` object or
  // bows out. Order = most authoritative first.
  const layers = []

  // 1. Barcode → OFF (if barcode in body OR existing)
  const barcode = body.barcode || existing?.barcode
  if (barcode) {
    const r = await fetchOFFByBarcode(barcode)
    if (r.enriched) layers.push(r)
  }

  // 2. Name → OFF text search (always — even if barcode hit, in case it adds
  //    fields the barcode product is missing). But skip if barcode gave high
  //    confidence and we're not forcing, since text search is flaky.
  const haveHigh = layers.some(l => l.confidence === 'high')
  if (!haveHigh) {
    const r = await searchOFFByName(name)
    if (r.enriched) layers.push(r)
  }

  // 3. Gemini fallback (only if we still don't have nutrition).
  const stillMissingNutrition = !layers.some(l => l.enriched?.nutrition_per_100g)
                                && !existing?.nutrition_per_100g
  if (stillMissingNutrition) {
    const r = await geminiEstimate(name, context.env)
    if (r.enriched) layers.push(r)
  }

  // Merge
  const merged = mergeEnrichment(existing, layers)

  // Always preserve any existing user-supplied fields (cost/store/size etc)
  // by carrying them through merge — readMeta returned them under `existing`,
  // and mergeEnrichment only overwrites empty fields. So they survive.

  // If hints arrived (typically from a receipt scan), they reflect the
  // CURRENT purchase. Update top-level cost/store/size and append price hist.
  if (hints) {
    if (hints.cost != null) merged.cost = hints.cost
    if (hints.store) merged.store = hints.store
    if (hints.size) merged.size = hints.size
    await appendPriceHistory(kv, name, hints)
  }

  // Persist
  merged.name = merged.name || name
  await writeMeta(kv, name, merged)

  const recent_prices = await readPrices(kv, name)
  return json({ ok: true, meta: merged, recent_prices, source: 'enriched' })
}
