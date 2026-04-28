/**
 * Cloudflare Pages Function — GET /api/photos/:key
 * Serves a photo from R2.
 * R2 binding: PHOTO_STORE → health-hub-photos bucket
 *
 * Note: key may contain slashes (e.g. "photos/2026-04-29/uuid.jpg")
 * so the client sends it URL-encoded and we decode here.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ params, env }) {
  if (!env.PHOTO_STORE) {
    return new Response('R2 not configured', { status: 503 })
  }

  // params.key is everything after /api/photos/ — decode it
  const key = decodeURIComponent(params.key)

  const object = await env.PHOTO_STORE.get(key)
  if (!object) {
    return new Response('Not found', { status: 404 })
  }

  const headers = new Headers(CORS)
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
}
