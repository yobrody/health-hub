/**
 * POST /api/fridge/enrich-batch
 *
 * Body: {
 *   items: [{ name, barcode?, hints? }, ...],
 *   force?: boolean
 * }
 *
 * Used by receipt scan to enrich all items in one go. Runs items in parallel
 * batches of 3 to be polite to OFF (which has shown overload behaviour under
 * load). Returns per-item results keyed by name.
 *
 * On any individual item failure: still returns 200 with that item's entry
 * containing { error: '...' }. Receipt scan should not fail the whole add
 * because one item couldn't be enriched.
 */
import {
  CORS, json, fetchOFFByBarcode, searchOFFByName, geminiEstimate,
  mergeEnrichment, appendPriceHistory, readMeta, writeMeta, readPrices,
} from './_enrich-lib.js'

// flash-lite has generous free-tier RPM, so we can run higher concurrency
// without hitting per-minute caps. OFF stays the bottleneck at 350ms politeness.
const CONCURRENCY = 3
const GEMINI_STEP_MS = 100

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function enrichOne(name, barcode, hints, kv, env) {
  const existing = await readMeta(kv, name)
  const layers = []

  const code = barcode || existing?.barcode
  if (code) {
    const r = await fetchOFFByBarcode(code)
    if (r.enriched) layers.push(r)
  }

  const haveHigh = layers.some(l => l.confidence === 'high')
  if (!haveHigh) {
    const r = await searchOFFByName(name)
    if (r.enriched) layers.push(r)
  }

  const stillMissingNutrition = !layers.some(l => l.enriched?.nutrition_per_100g)
                                && !existing?.nutrition_per_100g
  if (stillMissingNutrition) {
    const r = await geminiEstimate(name, env)
    if (r.enriched) layers.push(r)
    // Respect Gemini free-tier 5 RPM by sleeping after each call.
    await sleep(GEMINI_STEP_MS)
  }

  const merged = mergeEnrichment(existing, layers)
  if (hints) {
    if (hints.cost != null) merged.cost = hints.cost
    if (hints.store) merged.store = hints.store
    if (hints.size) merged.size = hints.size
    await appendPriceHistory(kv, name, hints)
  }
  merged.name = merged.name || name
  await writeMeta(kv, name, merged)
  return merged
}

async function runWithConcurrency(items, fn, n) {
  const results = {}
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      const item = items[i]
      try {
        results[item.name] = await fn(item)
      } catch (err) {
        results[item.name] = { error: String(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return results
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const items = Array.isArray(body?.items) ? body.items : []
  if (!items.length) return json({ error: 'items required' }, 400)
  if (items.length > 50) return json({ error: 'max 50 items per batch' }, 400)

  const kv = context.env.FRIDGE_META

  const cleaned = items
    .map(it => ({
      name: String(it?.name || '').trim(),
      barcode: it?.barcode || null,
      hints: it?.hints && typeof it.hints === 'object' ? it.hints : null,
    }))
    .filter(it => it.name && it.name.length <= 120)

  const results = await runWithConcurrency(
    cleaned,
    (it) => enrichOne(it.name, it.barcode, it.hints, kv, context.env),
    CONCURRENCY,
  )

  return json({ ok: true, results })
}
