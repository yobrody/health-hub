/**
 * Shared helpers for fridge item enrichment.
 *
 * Cascade priority: Open Food Facts (high) > Gemini Flash (medium).
 * KV schema: meta:{name} → enriched record. prices:{name} → list of purchases.
 *
 * NOTE: This file is imported from sibling functions, so it must be a plain
 *   JS module — no default export. Cloudflare Pages Functions support imports
 *   from neighboring files in the functions tree.
 */

export const UA = 'HealthHub/0.1 (https://health-hub-dwz.pages.dev)'
export const POS_TTL_SECS = 90 * 24 * 60 * 60
export const NEG_TTL_SECS = 14 * 24 * 60 * 60

export const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export function normalize(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
}

// At least one >3-char query word must appear in the product name. Prevents
// "eggs" matching "Petites Madeleines" because OFF sorts by popularity, not
// relevance.
export function looksRelevant(query, productName) {
  const q = normalize(query)
  const p = normalize(productName)
  if (!p) return false
  const words = q.split(' ').filter(w => w.length > 3)
  if (!words.length) return p.includes(q)
  return words.some(w => p.includes(w))
}

const NUTRIMENT_FIELDS = {
  kcal: ['energy-kcal_100g', 'energy_100g'],
  protein_g: ['proteins_100g'],
  carbs_g: ['carbohydrates_100g'],
  fat_g: ['fat_100g'],
  fiber_g: ['fiber_100g'],
  sugar_g: ['sugars_100g'],
}

function pickNumber(nutriments, fields) {
  for (const f of fields) {
    const v = nutriments?.[f]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 10) / 10
  }
  return null
}

function extractNutrition(nutriments) {
  if (!nutriments || typeof nutriments !== 'object') return null
  const out = {}
  let any = false
  for (const [key, fields] of Object.entries(NUTRIMENT_FIELDS)) {
    const v = pickNumber(nutriments, fields)
    if (v != null) { out[key] = v; any = true }
  }
  return any ? out : null
}

function parseQuantityGrams(q) {
  // OFF `quantity` is freeform: "500 g", "1 kg", "330 ml", "12 x 25 g"
  if (!q || typeof q !== 'string') return null
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i)
  if (!m) return null
  let n = parseFloat(m[1].replace(',', '.'))
  const unit = m[2].toLowerCase()
  if (unit === 'kg') n *= 1000
  if (unit === 'l') n *= 1000  // approximation: 1ml ≈ 1g for liquids
  return Math.round(n)
}

function packagingFromTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return null
  // Strip language prefix like "en:plastic-bottle" → "plastic-bottle" → "plastic bottle"
  const first = tags[0].replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
  return first || null
}

function allergensFromTags(tags) {
  if (!Array.isArray(tags)) return []
  // "en:milk" → "milk"
  return tags.map(t => t.replace(/^[a-z]{2}:/, '')).filter(Boolean)
}

export function offProductToEnriched(product, sourceLabel) {
  if (!product || typeof product !== 'object') return null
  const name = product.product_name_en || product.product_name || ''
  const brand = (product.brands || '').split(',')[0]?.trim() || null
  const image = product.image_small_url || product.image_front_small_url
                || product.image_url || product.image_front_url || null
  const nutrition = extractNutrition(product.nutriments)
  const packaging = packagingFromTags(product.packaging_tags)
                    || product.packaging || null
  const allergens = allergensFromTags(product.allergens_tags)
  const categories = allergensFromTags(product.categories_tags).slice(0, 4)
  const sizeG = parseQuantityGrams(product.quantity)
  return {
    name: name || null,
    brand,
    photo_url: image,
    barcode: product.code || null,
    nutrition_per_100g: nutrition,
    typical_size_g: sizeG,
    packaging,
    allergens: allergens.length ? allergens : null,
    categories: categories.length ? categories : null,
    source: sourceLabel,
  }
}

export async function fetchOFFByBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`
            + `?fields=code,product_name,product_name_en,brands,image_small_url,image_front_small_url,`
            + `image_url,image_front_url,nutriments,quantity,packaging,packaging_tags,allergens_tags,categories_tags`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) return { unavailable: true }
    const data = await res.json()
    if (data?.status !== 1 || !data?.product) return { miss: true }
    const enriched = offProductToEnriched(data.product, 'off-barcode')
    if (!enriched || !enriched.name) return { miss: true }
    return { enriched, confidence: 'high' }
  } catch {
    return { unavailable: true }
  } finally {
    clearTimeout(t)
  }
}

export async function searchOFFByName(name) {
  const params = new URLSearchParams({
    search_terms: name,
    search_simple: '1',
    action: 'process',
    sort_by: 'unique_scans_n',
    json: '1',
    page_size: '5',
    fields: [
      'product_name', 'product_name_en', 'brands', 'image_small_url',
      'image_front_small_url', 'nutriments', 'quantity', 'packaging',
      'packaging_tags', 'allergens_tags', 'categories_tags', 'countries_tags',
      'code',
    ].join(','),
  })
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) return { unavailable: true }
    const text = await res.text()
    if (!text.startsWith('{')) return { unavailable: true }
    let data
    try { data = JSON.parse(text) }
    catch { return { unavailable: true } }
    const products = Array.isArray(data?.products) ? data.products : []
    const ukFirst = [
      ...products.filter(p => (p.countries_tags || []).includes('en:united-kingdom')),
      ...products.filter(p => !(p.countries_tags || []).includes('en:united-kingdom')),
    ]
    for (const p of ukFirst) {
      const pname = p.product_name_en || p.product_name || ''
      if (looksRelevant(name, pname)) {
        const enriched = offProductToEnriched(p, 'off-text')
        if (enriched) return { enriched, confidence: 'medium' }
      }
    }
    return { miss: true }
  } catch {
    return { unavailable: true }
  } finally {
    clearTimeout(t)
  }
}

// Gemini Flash fallback. Free tier via Google AI Studio. Returns whatever JSON
// the model produces — we then merge into existing enriched fields. Skips if
// no API key is configured.
//
// Confidence is tagged "low" because the model is guessing typical UK values,
// not reading off a product label.
export async function geminiEstimate(name, env) {
  const key = env.GEMINI_API_KEY
  if (!key) return { skipped: true, reason: 'no-key' }

  const prompt = `For the UK supermarket food item "${name}", return ONLY a JSON object with these fields (omit any you don't know):
{
  "nutrition_per_100g": { "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number>, "fiber_g": <number>, "sugar_g": <number> },
  "typical_size_g": <number>,
  "packaging": <string, e.g. "plastic bottle" or "tub" or "loose">,
  "shelf_life_days_sealed": <number>,
  "shelf_life_days_opened": <number>,
  "allergens": [<string>, ...],
  "categories": [<string>, ...]
}
Return only the JSON object — no prose, no markdown fences.`

  // gemini-2.5-flash is on the free tier as of 2026-05; 2.0-flash has been
  // moved to paid-only. Verify with ListModels if quota issues recur.
  // thinkingConfig.thinkingBudget=0 — 2.5-flash defaults to reasoning-with-
  // hidden-thinking which burns the maxOutputTokens budget. Off for structured
  // extraction.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { unavailable: true, status: res.status }
    const data = await res.json()
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!txt) return { miss: true }
    let parsed
    try { parsed = JSON.parse(txt) } catch { return { miss: true } }
    return { enriched: { ...parsed, source: 'gemini' }, confidence: 'low' }
  } catch {
    return { unavailable: true }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Merge with priority: high > medium > low > existing.
 * `result` is the new layer to merge in. `existing` is what's already in KV.
 * Per-field confidence is not tracked individually for v1 — instead the whole
 * record gets the confidence of its primary source, and lower-confidence
 * sources only fill missing fields.
 */
export function mergeEnrichment(existing, layers) {
  // layers: array of { enriched: {...fields}, confidence: 'high'|'medium'|'low' }
  // ordered most→least preferred.
  const out = { ...(existing || {}) }
  let bestConfidence = existing?.confidence || null
  let bestSource = existing?.source || null
  let primaryFilled = false  // once we take a high-conf primary, it wins

  for (const layer of layers) {
    if (!layer?.enriched) continue
    const e = layer.enriched
    // Take fields that aren't already set, OR overwrite when the layer is
    // higher-confidence than what's there.
    for (const [k, v] of Object.entries(e)) {
      if (v == null || v === '') continue
      if (Array.isArray(v) && !v.length) continue
      const have = out[k]
      const layerWins =
        have == null ||
        have === '' ||
        (Array.isArray(have) && !have.length)
      if (layerWins) out[k] = v
    }
    if (!primaryFilled) {
      bestConfidence = layer.confidence
      bestSource = e.source || bestSource
      if (layer.confidence === 'high') primaryFilled = true
    }
  }

  out.confidence = bestConfidence || 'unknown'
  out.source = bestSource || out.source || 'unknown'
  out.enriched_at = Math.floor(Date.now() / 1000)
  return out
}

// Append a price record. Caps at last 20 entries per item.
export async function appendPriceHistory(kv, name, entry) {
  if (!kv || !entry || !entry.cost) return
  try {
    const key = `prices:${normalize(name)}`
    const existing = (await kv.get(key, 'json')) || []
    const list = Array.isArray(existing) ? existing : []
    list.unshift({
      date: entry.date || new Date().toISOString().slice(0, 10),
      store: entry.store || null,
      cost: entry.cost,
      size: entry.size || null,
    })
    await kv.put(key, JSON.stringify(list.slice(0, 20)))
  } catch { /* ignore KV failures — non-essential */ }
}

export async function readMeta(kv, name) {
  if (!kv) return null
  try {
    const key = normalize(name)
    return (await kv.get(key, 'json')) || null
  } catch { return null }
}

export async function writeMeta(kv, name, meta) {
  if (!kv) return
  try {
    const key = normalize(name)
    await kv.put(key, JSON.stringify(meta))
  } catch { /* ignore */ }
}

export async function readPrices(kv, name) {
  if (!kv) return []
  try {
    const key = `prices:${normalize(name)}`
    return (await kv.get(key, 'json')) || []
  } catch { return [] }
}
