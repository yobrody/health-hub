/**
 * Cloudflare Pages Function — POST /api/photos/upload
 * Accepts a base64 thumbnail, stores it in R2, returns the key.
 * R2 binding: PHOTO_STORE → health-hub-photos bucket
 */

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

function uuid() {
  return crypto.randomUUID()
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  if (!env.PHOTO_STORE) {
    return json({ error: 'R2 binding PHOTO_STORE not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { image, mime = 'image/jpeg' } = body
  if (!image) return json({ error: 'Missing image' }, 400)

  // Strip data URL prefix if present: "data:image/jpeg;base64,..."
  const base64 = image.includes(',') ? image.split(',')[1] : image

  // Decode base64 to binary
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

  // Generate key with date prefix for easy browsing: photos/2026-04-29/uuid.jpg
  const date = new Date().toISOString().slice(0, 10)
  const ext = mime === 'image/png' ? 'png' : 'jpg'
  const key = `photos/${date}/${uuid()}.${ext}`

  await env.PHOTO_STORE.put(key, binary, {
    httpMetadata: { contentType: mime },
  })

  return json({ key, url: `/api/photos/${encodeURIComponent(key)}` })
}
