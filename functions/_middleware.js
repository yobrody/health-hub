/**
 * Cloudflare Pages middleware — runs before EVERY function under /functions,
 * including the [[path]].js VPS proxy and all /api/ai/* endpoints.
 *
 * Why (audit 2026-08): the proxy injects the real X-Health-Key server-side
 * and every function sent `Access-Control-Allow-Origin: *`, which made
 * https://health-hub-dwz.pages.dev/api/* an open, unauthenticated proxy to
 * the whole FastAPI surface — and let anyone burn the Gemini free-tier quota
 * (~20 RPD on this account) through the AI endpoints.
 *
 * Gate: a request is allowed if ANY of:
 *   1. The browser marks it same-origin/same-site (Sec-Fetch-Site) — covers
 *      the installed PWA and preview deploys with zero client changes.
 *   2. Origin or Referer host is the app itself (…health-hub-dwz.pages.dev,
 *      localhost for `vite preview` against prod).
 *   3. It carries the real X-Health-Key — covers curl, the Telegram bot and
 *      the HealthKit iOS Shortcut (which must now send the header; see
 *      docs/healthkit-shortcut.md).
 *
 * This is a deterrent, not bank-vault auth: Origin is forgeable outside a
 * browser. The KV-backed rate limit below is the backstop for that case.
 * Single-user app; good enough by design.
 */

const ALLOWED_HOST_SUFFIXES = ['health-hub-dwz.pages.dev']
const ALLOWED_HOSTS = ['localhost', '127.0.0.1']

// Requests per IP per minute. AI endpoints are the expensive ones.
const LIMIT_AI = 30
const LIMIT_DEFAULT = 240

function corsJson(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
    },
  })
}

function hostAllowed(value) {
  if (!value) return false
  let host
  try { host = new URL(value).hostname } catch { return false }
  if (ALLOWED_HOSTS.includes(host)) return true
  return ALLOWED_HOST_SUFFIXES.some(s => host === s || host.endsWith('.' + s) || host.endsWith(s))
}

function isAllowed(request, env) {
  const sfs = request.headers.get('Sec-Fetch-Site')
  if (sfs === 'same-origin' || sfs === 'same-site' || sfs === 'none') return true
  if (hostAllowed(request.headers.get('Origin'))) return true
  if (hostAllowed(request.headers.get('Referer'))) return true
  const key = request.headers.get('X-Health-Key')
  if (key && env.HEALTH_API_KEY && key === env.HEALTH_API_KEY) return true
  // Autonomous review jobs (nightly scan review, weekly coach digest) read a
  // few GET-only endpoints with a dedicated read-only token as a query param
  // (WebFetch can't set headers). Read-only, single-user, low-sensitivity.
  const u = new URL(request.url)
  const READ_TOKEN_PATHS = ['/api/scan-samples', '/api/report/weekly']
  if (request.method === 'GET' && READ_TOKEN_PATHS.includes(u.pathname)) {
    const t = u.searchParams.get('t')
    if (t && env.SCAN_SAMPLES_TOKEN && t === env.SCAN_SAMPLES_TOKEN) return true
  }
  return false
}

async function rateLimited(context, limit) {
  // Best-effort KV counter: per IP per minute bucket. KV allows ~1 write/sec
  // per key, so a fast burst may under-count — fine, this is a backstop
  // against sustained abuse, not a precise meter. Errors are swallowed.
  const kv = context.env.FRIDGE_META
  if (!kv) return false
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown'
    const bucket = Math.floor(Date.now() / 60000)
    const key = `rl:${ip}:${bucket}`
    const count = parseInt((await kv.get(key)) || '0', 10)
    if (count >= limit) return true
    context.waitUntil?.(kv.put(key, String(count + 1), { expirationTtl: 120 }).catch(() => {}))
  } catch { /* KV unavailable — fail open */ }
  return false
}

export async function onRequest(context) {
  const { request } = context
  if (request.method === 'OPTIONS') return context.next()

  if (!isAllowed(request, context.env)) {
    return corsJson({ error: 'forbidden' }, 403)
  }

  const path = new URL(request.url).pathname
  const limit = path.startsWith('/api/ai/') || path.startsWith('/api/fridge/enrich') || path.startsWith('/api/fridge/scan') || path.startsWith('/api/scan/')
    ? LIMIT_AI
    : LIMIT_DEFAULT
  if (await rateLimited(context, limit)) {
    return corsJson({ error: 'rate limit exceeded; try again in a minute' }, 429)
  }

  return context.next()
}
