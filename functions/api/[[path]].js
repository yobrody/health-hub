/**
 * Cloudflare Pages Function — proxies /api/* → VPS FastAPI on port 8080
 *
 * Special handling:
 *   GET  /fridge          — merges VPS item list with KV rich metadata
 *   POST /fridge/item     — proxies to VPS + writes extended metadata to KV
 *
 * Direct IP blocked from Cloudflare Workers (error 1003).
 * nip.io resolves 128-140-33-150.nip.io → 128.140.33.150
 */
const VPS_BASE = 'http://128-140-33-150.nip.io:8080'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const backendPath = url.pathname.replace(/^\/api/, '') || '/'
  const targetUrl = `${VPS_BASE}${backendPath}${url.search}`
  const apiKey = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'
  const kv = context.env.FRIDGE_META

  const reqHeaders = new Headers(context.request.headers)
  reqHeaders.set('X-Health-Key', apiKey)
  reqHeaders.delete('host')

  // ── GET /fridge — merge VPS items with KV metadata ───────────────────────
  if (context.request.method === 'GET' && backendPath === '/fridge') {
    try {
      const vpsRes = await fetch(targetUrl, { method: 'GET', headers: reqHeaders })
      if (!vpsRes.ok) {
        return new Response(await vpsRes.text(), {
          status: vpsRes.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const fridgeData = await vpsRes.json()
      if (kv) {
        for (const zone of ['fridge', 'freezer', 'pantry', 'condiments']) {
          if (!Array.isArray(fridgeData[zone])) continue
          fridgeData[zone] = await Promise.all(
            fridgeData[zone].map(async (item) => {
              try {
                const key = (item.name || '').toLowerCase().trim()
                const metaStr = await kv.get(key)
                if (metaStr) {
                  const meta = JSON.parse(metaStr)
                  // Audit B-3: pass the full enriched record through so
                  // list views can show brand / nutrition / allergens
                  // without an extra per-item GET. Was only size/cost/
                  // store/photo_url before; cards couldn't show brand.
                  return {
                    ...item,
                    size: meta.size ?? null,
                    cost: meta.cost ?? null,
                    store: meta.store ?? null,
                    photo_url: meta.photo_url ?? null,
                    brand: meta.brand ?? null,
                    barcode: meta.barcode ?? null,
                    nutrition_per_100g: meta.nutrition_per_100g ?? null,
                    typical_size_g: meta.typical_size_g ?? null,
                    packaging: meta.packaging ?? null,
                    allergens: meta.allergens ?? null,
                    categories: meta.categories ?? null,
                    shelf_life_days_sealed: meta.shelf_life_days_sealed ?? null,
                    shelf_life_days_opened: meta.shelf_life_days_opened ?? null,
                    confidence: meta.confidence ?? null,
                  }
                }
              } catch {}
              return item
            })
          )
        }
      }
      return new Response(JSON.stringify(fridgeData), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      return jsonResp({ error: 'API unreachable', detail: String(err) }, 502)
    }
  }

  // ── POST /fridge/item — proxy to VPS + write KV metadata ─────────────────
  if (context.request.method === 'POST' && backendPath === '/fridge/item') {
    let body = {}
    try { body = await context.request.json() } catch {}

    const {
      name, section,
      size = null, cost = null, store = null,
      unit_size_g = null, quantity_g = null,
      unit_count = null, quantity_count = null,
      photo_url = null,
    } = body

    // Forward to VPS with the fields the FastAPI model accepts
    let vpsStatus, vpsBody
    try {
      const vpsRes = await fetch(targetUrl, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          name, section,
          unit_size_g, quantity_g, unit_count, quantity_count,
        }),
      })
      vpsStatus = vpsRes.status
      vpsBody = await vpsRes.text()
    } catch (err) {
      return jsonResp({ error: 'VPS unreachable: ' + String(err) }, 502)
    }

    // Write extended metadata to KV if any present. Merge with existing record
    // so we don't clobber a photo_url that an earlier add or backfill resolved.
    if (kv && name && (size !== null || cost !== null || store !== null || photo_url !== null)) {
      try {
        const key = name.toLowerCase().trim()
        let existing = {}
        try {
          const prev = await kv.get(key)
          if (prev) existing = JSON.parse(prev)
        } catch {}
        await kv.put(key, JSON.stringify({
          ...existing,
          size: size ?? existing.size ?? null,
          cost: cost ?? existing.cost ?? null,
          store: store ?? existing.store ?? null,
          photo_url: photo_url ?? existing.photo_url ?? null,
          section: section || existing.section || 'fridge',
          added: existing.added || new Date().toISOString(),
        }))
      } catch {}
    }

    return new Response(vpsBody, {
      status: vpsStatus,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── Default: proxy everything else straight to VPS ────────────────────────
  const init = {
    method: context.request.method,
    headers: reqHeaders,
  }
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body
  }

  try {
    const response = await fetch(targetUrl, init)
    const resHeaders = new Headers(response.headers)
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, X-Health-Key')
    return new Response(response.body, { status: response.status, headers: resHeaders })
  } catch (err) {
    return jsonResp({ error: 'API unreachable', detail: String(err) }, 502)
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  })
}
