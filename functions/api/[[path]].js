/**
 * Cloudflare Pages Function — proxies /api/* → VPS FastAPI on port 8080
 * This keeps the API key server-side and avoids mixed-content (HTTPS→HTTP) issues.
 */

const VPS_BASE = 'http://128.140.33.150:8080'

export async function onRequest(context) {
  const url = new URL(context.request.url)

  // Strip /api prefix to get the backend path
  const backendPath = url.pathname.replace(/^\/api/, '') || '/'
  const targetUrl = `${VPS_BASE}${backendPath}${url.search}`

  // Forward request with API key injected server-side
  const apiKey = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'

  const reqHeaders = new Headers(context.request.headers)
  reqHeaders.set('X-Health-Key', apiKey)
  // Remove host header (causes issues when forwarding)
  reqHeaders.delete('host')

  const init = {
    method: context.request.method,
    headers: reqHeaders,
  }

  // Forward body for non-GET requests
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body
  }

  try {
    const response = await fetch(targetUrl, init)

    // Pass through the response with CORS headers added
    const resHeaders = new Headers(response.headers)
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, X-Health-Key')

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'API unreachable', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
      'Access-Control-Max-Age': '86400',
    },
  })
}
