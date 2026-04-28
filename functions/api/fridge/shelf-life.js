/**
 * Cloudflare Pages Function - GET /api/fridge/shelf-life?items=chicken,rice,eggs
 * Reads per-item usage history from KV, returns learned avg_days per item.
 * Returns: { [item_name]: { avg_days, sample_count } }
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet(context) {
  const kv = context.env.FRIDGE_META
  if (!kv) return json({})

  const url = new URL(context.request.url)
  const itemsParam = url.searchParams.get('items') || ''
  const names = itemsParam.split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean)
  if (!names.length) return json({})

  const result = {}
  await Promise.all(names.map(async (name) => {
    try {
      const kvKey = `usage:${name.toLowerCase().trim()}`
      const raw = await kv.get(kvKey)
      if (!raw) return
      const history = JSON.parse(raw)
      if (!history.length) return
      const avg = Math.round(history.reduce((a, e) => a + e.days, 0) / history.length)
      result[name] = { avg_days: avg, sample_count: history.length }
    } catch {}
  }))

  return json(result)
}
