/**
 * Cloudflare Pages Function — /api/scan-samples
 *
 * Scan self-improvement telemetry. Keeps a rolling window of the LAST 10 scan
 * photo+result pairs so a periodic review can spot where the scanner is getting
 * things wrong or could improve — without the user reporting anything.
 *
 *   POST  { thumb, result, type }   → prepend to the window, keep newest 10
 *   GET   ?t=<SCAN_SAMPLES_TOKEN>   → return the window (for the analysis job)
 *
 * Storage: KV binding FRIDGE_META, single key `scan_samples_v1` (a JSON array).
 * Thumbnails are ~220px q0.65 JPEGs (~10KB), so 10 ≈ 150KB — well under KV limits.
 * No new credentials: reuses the KV namespace already bound for fridge metadata.
 *
 * Auth: POST rides the same-origin gate in _middleware.js (the app calls it).
 * GET is allowed through the middleware only with a valid ?t= token, and this
 * function re-checks that token so the read path is never open.
 */

const KV_KEY = 'scan_samples_v1'
const MAX = 10

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  const kv = env.FRIDGE_META
  if (!kv) return json({ error: 'KV binding FRIDGE_META not configured' }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { thumb, result, type } = body || {}
  if (!result || !type) return json({ error: 'Missing result or type' }, 400)

  // Cap the stored thumbnail so a huge upload can't blow the KV value size.
  const safeThumb = typeof thumb === 'string' && thumb.length < 400_000 ? thumb : ''

  let list = []
  try { list = (await kv.get(KV_KEY, 'json')) || [] } catch { list = [] }
  if (!Array.isArray(list)) list = []

  list.unshift({ thumb: safeThumb, result, type, ts: new Date().toISOString() })
  if (list.length > MAX) list = list.slice(0, MAX)

  try {
    await kv.put(KV_KEY, JSON.stringify(list))
  } catch (e) {
    return json({ error: 'KV write failed', detail: String(e) }, 500)
  }
  return json({ ok: true, count: list.length })
}

export async function onRequestGet({ request, env }) {
  // Belt-and-braces: the middleware already required a valid token to route a
  // GET here, but re-check so this endpoint is never readable without it.
  const token = new URL(request.url).searchParams.get('t')
  if (!env.SCAN_SAMPLES_TOKEN || token !== env.SCAN_SAMPLES_TOKEN) {
    return json({ error: 'forbidden' }, 403)
  }
  const kv = env.FRIDGE_META
  if (!kv) return json({ error: 'KV binding FRIDGE_META not configured' }, 503)

  let list = []
  try { list = (await kv.get(KV_KEY, 'json')) || [] } catch { list = [] }
  if (!Array.isArray(list)) list = []
  return json({ count: list.length, samples: list })
}
