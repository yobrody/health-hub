/**
 * Cloudflare Pages Function — GET /api/shop/lookup?q=<item>
 *
 * Powers the shopping-list notepad's per-item intelligence. Given a typed
 * item name, searches Open Food Facts for the best-matching real product and
 * returns its name, brand, product photo (the SAME image source the fridge
 * uses), and the stores OFF knows stock it. The frontend layers the user's
 * own receipt price history on top.
 *
 * Returns: {
 *   ok: boolean,
 *   query: string,
 *   product: { name, brand, image_url, quantity } | null,
 *   stores: string[],            // e.g. ["Tesco", "Sainsbury's"]
 *   kcal_100g: number | null,
 * }
 *
 * Results are edge-cached for a day — product metadata barely changes and we
 * don't want to hammer OFF on every keystroke-completed item.
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extraHeaders } })
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

// Tidy OFF's comma/locale-tagged store strings into clean display names.
function cleanStores(product) {
  const raw = []
  if (typeof product.stores === 'string') raw.push(...product.stores.split(','))
  if (Array.isArray(product.stores_tags)) {
    for (const t of product.stores_tags) raw.push(String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' '))
  }
  const seen = new Set()
  const out = []
  for (let s of raw) {
    s = s.trim()
    if (!s) continue
    // Title-case for display ("tesco" -> "Tesco", "marks and spencer" -> "Marks And Spencer")
    const disp = s.replace(/\b\w/g, c => c.toUpperCase())
    const key = disp.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(disp) }
  }
  return out.slice(0, 6)
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 80)
  if (!q) return json({ ok: false, error: 'q required', product: null, stores: [], kcal_100g: null }, 400)

  const offUrl = 'https://world.openfoodfacts.org/cgi/search.pl?' + new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '8',
    fields: 'product_name,product_name_en,brands,image_small_url,image_front_small_url,stores,stores_tags,quantity,nutriments',
  }).toString()

  let data
  try {
    const res = await fetch(offUrl, { headers: { 'User-Agent': 'HealthHub/1.0 (personal use)' } })
    if (!res.ok) return json({ ok: false, error: `OFF ${res.status}`, product: null, stores: [], kcal_100g: null }, 502)
    data = await res.json()
  } catch (e) {
    return json({ ok: false, error: 'OFF unreachable: ' + String(e), product: null, stores: [], kcal_100g: null }, 502)
  }

  const products = Array.isArray(data?.products) ? data.products : []
  if (!products.length) {
    return json({ ok: true, query: q, product: null, stores: [], kcal_100g: null },
      200, { 'Cache-Control': 'public, max-age=86400' })
  }

  // Prefer the first product that actually has a photo AND store data; else
  // the first with a photo; else the first result.
  const score = p => (p.image_small_url || p.image_front_small_url ? 2 : 0) + ((p.stores || (p.stores_tags || []).length) ? 1 : 0)
  const best = [...products].sort((a, b) => score(b) - score(a))[0]

  const name = best.product_name_en || best.product_name || q
  const image_url = best.image_small_url || best.image_front_small_url || null
  const brand = (typeof best.brands === 'string' ? best.brands.split(',')[0].trim() : '') || null
  const kcal100 = best?.nutriments?.['energy-kcal_100g']
    ?? (best?.nutriments?.energy_100g ? Math.round(best.nutriments.energy_100g / 4.184) : null)

  return json({
    ok: true,
    query: q,
    product: { name: String(name).slice(0, 80), brand, image_url, quantity: best.quantity || null },
    stores: cleanStores(best),
    kcal_100g: typeof kcal100 === 'number' ? Math.round(kcal100) : null,
  }, 200, { 'Cache-Control': 'public, max-age=86400' })
}
