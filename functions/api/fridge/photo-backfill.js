/**
 * Cloudflare Pages Function — POST /api/fridge/photo-backfill
 *
 * One-shot pass over the user's existing fridge: for every item without a
 * cached photo, run the photo-lookup logic and write the result into the
 * item's KV metadata so the next /fridge GET surfaces the image.
 *
 * Body: {} (no input)
 * Returns: { walked: number, resolved: number, missed: number, items: [...] }
 *
 * This calls the same OFF text search as /photo-lookup (with the same KV
 * cache + relevance check). Safe to call multiple times; cached results are
 * read-through, OFF only gets hit for items that haven't been resolved yet.
 *
 * Rate limit: small artificial delay between OFF calls to be polite to
 * their shared search infrastructure. Don't run this in a tight loop.
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

const VPS_BASE = 'https://hh-api.pestdispatch.co.uk'
const UA = 'HealthHub/0.1 (https://health-hub-dwz.pages.dev)'

const NEG_TTL_SECS = 14 * 24 * 60 * 60
const POS_TTL_SECS = 90 * 24 * 60 * 60

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

function looksRelevant(query, productName) {
  const q = normalize(query)
  const p = normalize(productName)
  if (!p) return false
  const words = q.split(' ').filter(w => w.length > 3)
  if (!words.length) return p.includes(q)
  return words.some(w => p.includes(w))
}

// See photo-lookup.js for the rationale on the three return states.
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
      if (img && looksRelevant(name, pname)) return { url: img }
    }
    return { checked: true }
  } catch {
    return { unavailable: true }
  } finally {
    clearTimeout(t)
  }
}

export async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY  // no literal fallback — key lives in CF Pages env only (audit B-9)
  const kv = context.env.FRIDGE_META
  // ?force=1 bypasses the negative cache so the previous backfill's stale
  // "miss" entries from when OFF was overloaded get retried. Hits are still
  // read from cache (no point re-fetching a known-good photo URL).
  const url = new URL(context.request.url)
  const force = url.searchParams.get('force') === '1'

  // Pull current fridge contents
  let fridge
  try {
    const res = await fetch(`${VPS_BASE}/fridge`, {
      headers: { 'X-Health-Key': expected, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return json({ error: `VPS /fridge ${res.status}` }, 502)
    fridge = await res.json()
  } catch (e) {
    return json({ error: 'VPS unreachable: ' + String(e) }, 502)
  }

  const all = []
  for (const zone of ['fridge', 'freezer', 'pantry', 'condiments']) {
    if (Array.isArray(fridge[zone])) {
      fridge[zone].forEach(it => all.push({ ...it, zone }))
    }
  }

  const items = []
  let resolved = 0
  let missed = 0
  let lookedUp = 0

  for (const it of all) {
    const name = it.name || ''
    if (!name) continue
    const cacheKey = `photo:${normalize(name)}`
    const itemKey = normalize(name)

    let photo_url = null
    let source = 'miss'

    // 1) Try cached photo lookup. Hits always honoured. Misses honoured unless
    // ?force=1 was passed (used to recover from a backfill that ran during
    // an OFF outage and cached a bunch of false misses).
    if (kv) {
      try {
        const cached = await kv.get(cacheKey, 'json')
        if (cached?.url) { photo_url = cached.url; source = 'cache' }
        else if (cached?.miss && !force) { source = 'cache-miss' }
      } catch { /* fall through */ }
    }

    // 2) If still missing, hit OFF (with polite gap)
    if (!photo_url && source !== 'cache-miss') {
      // Gap between OFF requests so we don't trip their rate limit. Skipped
      // when the only previous result was a cached miss.
      if (lookedUp > 0) await new Promise(r => setTimeout(r, 350))
      const offResult = await searchOFF(name)
      lookedUp++
      photo_url = offResult.url || null
      source = offResult.url
        ? 'off'
        : offResult.unavailable ? 'unavailable' : 'miss'

      // Only cache definitive answers. Don't burn a 14-day miss cache on a
      // transient OFF outage — let the next backfill retry.
      if (kv && !offResult.unavailable) {
        try {
          if (photo_url) {
            await kv.put(cacheKey, JSON.stringify({ url: photo_url, t: Date.now() }), { expirationTtl: POS_TTL_SECS })
          } else {
            await kv.put(cacheKey, JSON.stringify({ miss: true, t: Date.now() }), { expirationTtl: NEG_TTL_SECS })
          }
        } catch { /* ignore */ }
      }
    }

    // 3) Persist photo_url into the item's KV metadata so /fridge GET picks it up
    if (kv && photo_url) {
      try {
        const existing = await kv.get(itemKey, 'json') || {}
        // Merge — don't clobber size/cost/store
        await kv.put(itemKey, JSON.stringify({ ...existing, photo_url }))
      } catch { /* ignore */ }
    }

    if (photo_url) resolved++
    else missed++
    items.push({ name, zone: it.zone, photo_url, source })
  }

  return json({
    walked: all.length,
    resolved,
    missed,
    looked_up_external: lookedUp,
    items,
  })
}
