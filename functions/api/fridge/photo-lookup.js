/**
 * Cloudflare Pages Function — POST /api/fridge/photo-lookup
 *
 * Resolves a product image URL from Open Food Facts by name. Server-side so
 * we keep the User-Agent OFF requires + can retry past their flaky overload
 * page. Caches results in the FRIDGE_META KV under `photo:<normalized-name>`
 * so the same query never goes to OFF twice.
 *
 * Body: { name: string }
 * Returns: { photo_url: string | null, source: 'cache'|'off'|'miss' }
 *
 * Cached negative results (no match found) live for 14 days so we don't
 * hammer OFF for items it genuinely doesn't have.
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

// OFF strongly recommends a descriptive UA. Generic UAs hit a stricter
// rate limiter that returns the "Page temporarily unavailable" HTML page
// we kept seeing during testing.
const UA = 'HealthHub/0.1 (https://health-hub-dwz.pages.dev)'

const NEG_TTL_SECS = 14 * 24 * 60 * 60   // 14d for misses
const POS_TTL_SECS = 90 * 24 * 60 * 60   // 90d for hits — product images are stable

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

function normalize(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
}

// Confidence check — refuse to use an OFF result that's clearly not what the
// user typed. Examples we want to reject: "eggs" → "Petites Madeleines" (the
// raw search returns the most-popular product regardless of relevance). Rule:
// at least one word of the query (>3 chars) must appear in the product name.
function looksRelevant(query, productName) {
  const q = normalize(query)
  const p = normalize(productName)
  if (!p) return false
  const words = q.split(' ').filter(w => w.length > 3)
  if (!words.length) {
    // Short query (e.g. "egg" alone). Require exact substring.
    return p.includes(q)
  }
  return words.some(w => p.includes(w))
}

/**
 * Three return states:
 *   { url: '...' }       — found a relevant photo
 *   { checked: true }    — OFF responded with results, no relevant match
 *   { unavailable: true} — OFF errored / overloaded / timed out — DO NOT cache
 *
 * The unavailable distinction matters because OFF's search.pl is flaky and
 * returns an HTML overload page during peaks. If we cached those as a miss,
 * the user would never see a photo until the cache expired in 14 days.
 */
async function searchOFF(name) {
  const params = new URLSearchParams({
    search_terms: name,
    search_simple: '1',
    action: 'process',
    sort_by: 'unique_scans_n',
    json: '1',
    page_size: '5',
    fields: 'product_name,product_name_en,image_small_url,image_front_small_url,brands,countries_tags',
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
      const img = p.image_small_url || p.image_front_small_url
      const pname = p.product_name_en || p.product_name || ''
      if (img && looksRelevant(name, pname)) {
        return { url: img }
      }
    }
    return { checked: true }
  } catch {
    return { unavailable: true }
  } finally {
    clearTimeout(t)
  }
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const name = String(body?.name || '').trim()
  if (!name || name.length > 120) return json({ error: 'name required' }, 400)

  const kv = context.env.FRIDGE_META
  const cacheKey = `photo:${normalize(name)}`

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, 'json')
      if (cached) {
        // Negative-cache marker: { miss: true, t: <timestamp> }
        if (cached.miss) return json({ photo_url: null, source: 'cache' })
        if (cached.url) return json({ photo_url: cached.url, source: 'cache' })
      }
    } catch { /* KV down — fall through to OFF */ }
  }

  const result = await searchOFF(name)

  // Only cache definitive answers. OFF being unavailable is transient; we want
  // the next call to retry, not be locked into "no photo" for 14 days.
  if (kv && !result.unavailable) {
    try {
      if (result.url) {
        await kv.put(cacheKey, JSON.stringify({ url: result.url, t: Date.now() }), { expirationTtl: POS_TTL_SECS })
      } else {
        await kv.put(cacheKey, JSON.stringify({ miss: true, t: Date.now() }), { expirationTtl: NEG_TTL_SECS })
      }
    } catch { /* ignore KV write failures */ }
  }

  const source = result.url
    ? 'off'
    : result.unavailable ? 'unavailable' : 'miss'
  return json({ photo_url: result.url || null, source })
}
