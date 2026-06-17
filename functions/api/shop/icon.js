/**
 * Cloudflare Pages Function — GET /api/shop/icon?q=<item>
 *
 * Free AI icon fallback for shopping-list items that have NO Open Food Facts
 * product photo. Generates a clean flat icon with Cloudflare Workers AI
 * (Flux schnell, free tier), then caches the result at the edge effectively
 * forever — so each item is generated at most ONCE and costs nothing after.
 *
 * Graceful by design: if the Workers AI binding isn't enabled on the project,
 * this returns 503 and the frontend's <img> simply falls back to the emoji
 * icon — nothing breaks. To turn real icons on, add a Workers AI binding named
 * "AI" in the Pages project (Settings -> Functions -> Bindings) and redeploy.
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)
  // Capability probe: the client calls this once to learn whether real icons
  // are available, so it never points an <img> at a 503 (avoids console noise).
  if (url.searchParams.get('probe')) {
    // Always 200 (client reads the body) so the probe never logs a console error.
    return new Response(env.AI ? 'ready' : 'off', { status: 200, headers: CORS })
  }

  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60)
  if (!q) return new Response('q required', { status: 400, headers: CORS })

  // Serve from edge cache if we've drawn this item before ("generate once").
  const cache = caches.default
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  // No binding -> let the client fall back to its emoji icon.
  if (!env.AI) return new Response('AI binding not configured', { status: 503, headers: CORS })

  let bytes
  try {
    const prompt = `A clean minimalist flat-design app icon of ${q}, a single centred grocery product, soft solid pastel background, crisp vector style, centered, no text, no words`
    const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt })
    // flux-1-schnell returns { image: <base64 jpeg> }.
    const b64 = out && out.image
    if (!b64) throw new Error('no image in model output')
    bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  } catch (e) {
    return new Response('generation failed: ' + String(e).slice(0, 120), { status: 502, headers: CORS })
  }

  const resp = new Response(bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...CORS,
    },
  })
  // Persist to edge cache so future requests skip generation entirely.
  context.waitUntil(cache.put(cacheKey, resp.clone()))
  return resp
}
