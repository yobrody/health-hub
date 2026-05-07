/**
 * POST /api/fridge/enrich-backfill
 *
 * Walks every item from /fridge and enriches any without a high-confidence
 * record fresher than 30 days. Counterpart to /fridge/photo-backfill, but for
 * the full enrichment record (brand, nutrition, allergens, packaging, etc).
 *
 * Body: { force?: boolean }   — force re-enrich even high-confidence records
 *
 * Returns: { ok, scanned, enriched, skipped, errors: [...] }
 *
 * Polite: 350ms gap between OFF calls so we don't trip their overload page.
 */
import {
  CORS, json, normalize, fetchOFFByBarcode, searchOFFByName, geminiEstimate,
  mergeEnrichment, readMeta, writeMeta,
} from './_enrich-lib.js'

const FRESH_SECS = 30 * 24 * 60 * 60
const STEP_MS = 350           // OFF politeness delay
// Modest Gemini pacing — flash-lite has plenty of free-tier RPM, but a
// large backfill could still trip the 1000 RPD ceiling, and 200ms keeps
// the function response time bounded.
const GEMINI_STEP_MS = 200

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export async function onRequestPost(context) {
  let body = {}
  try { body = await context.request.json() } catch {}
  const force = !!body?.force
  // B-4: accept offset/limit so the client can drive multiple shorter
  // calls instead of one ~minute-long one. Defaults preserve old behaviour
  // (whole-fridge backfill in a single call) when neither is supplied.
  const offset = Math.max(0, Number.isFinite(+body?.offset) ? Math.floor(+body.offset) : 0)
  const rawLimit = Number.isFinite(+body?.limit) ? Math.floor(+body.limit) : 0
  const limit = rawLimit > 0 ? Math.min(rawLimit, 200) : 0  // 0 = no cap
  const kv = context.env.FRIDGE_META

  // Pull all items via the proxy (so we get whatever is already merged in).
  const url = new URL(context.request.url)
  url.pathname = '/api/fridge'
  url.search = ''
  const fridgeRes = await fetch(url.toString(), {
    headers: { 'X-Health-Key': context.request.headers.get('X-Health-Key') || '' },
  })
  if (!fridgeRes.ok) return json({ error: 'fridge unreachable' }, 502)
  const fridgeData = await fridgeRes.json()

  const fullItems = []
  for (const zone of ['fridge', 'pantry', 'freezer', 'condiments']) {
    if (!Array.isArray(fridgeData[zone])) continue
    for (const it of fridgeData[zone]) {
      if (it?.name) fullItems.push({ name: it.name, zone })
    }
  }
  const total = fullItems.length
  const sliceEnd = limit > 0 ? Math.min(offset + limit, total) : total
  const allItems = fullItems.slice(offset, sliceEnd)
  const nextOffset = sliceEnd < total ? sliceEnd : null

  let enriched = 0, skipped = 0
  const errors = []

  for (const item of allItems) {
    const existing = await readMeta(kv, item.name)
    const fresh = existing
      && existing.confidence === 'high'
      && existing.enriched_at
      && (Date.now() / 1000 - existing.enriched_at) < FRESH_SECS

    if (fresh && !force) { skipped++; continue }

    const layers = []
    try {
      const code = existing?.barcode
      if (code) {
        const r = await fetchOFFByBarcode(code)
        if (r.enriched) layers.push(r)
        await sleep(STEP_MS)
      }

      const haveHigh = layers.some(l => l.confidence === 'high')
      if (!haveHigh) {
        const r = await searchOFFByName(item.name)
        if (r.enriched) layers.push(r)
        await sleep(STEP_MS)
      }

      const stillMissingNutrition = !layers.some(l => l.enriched?.nutrition_per_100g)
                                    && !existing?.nutrition_per_100g
      if (stillMissingNutrition) {
        const r = await geminiEstimate(item.name, context.env)
        if (r.enriched) layers.push(r)
        // Per-Gemini-call throttle, only when we actually called Gemini.
        await sleep(GEMINI_STEP_MS)
      }

      if (layers.length) {
        const merged = mergeEnrichment(existing, layers)
        merged.name = merged.name || item.name
        await writeMeta(kv, item.name, merged)
        enriched++
      } else {
        skipped++
      }
    } catch (err) {
      errors.push({ name: item.name, error: String(err) })
    }
  }

  return json({
    ok: true,
    scanned: allItems.length,
    enriched,
    skipped,
    errors,
    total,
    offset,
    next_offset: nextOffset,
    done: nextOffset === null,
  })
}
