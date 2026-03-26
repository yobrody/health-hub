/**
 * Cloudflare Pages Function — POST /api/fridge/scan
 * Scans a grocery receipt image using Claude Vision and adds items to the fridge.
 * Body: multipart/form-data with field "file" (the receipt image)
 * Returns: { items_added: N, items: string[] }
 *
 * Set ANTHROPIC_API_KEY in Cloudflare Pages → Settings → Environment variables.
 * If ANTHROPIC_API_KEY is missing, falls back to proxying to the VPS.
 */

const VPS = 'http://128-140-33-150.nip.io:8080'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost(context) {
  const reqKey = context.request.headers.get('X-Health-Key') || ''
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'
  if (reqKey !== expected) return json({ error: 'Unauthorized' }, 401)

  const anthropicKey = context.env.ANTHROPIC_API_KEY

  // No AI key → fall back to VPS proxy
  if (!anthropicKey) {
    const h = new Headers(context.request.headers)
    h.delete('host')
    try {
      const r = await fetch(`${VPS}/fridge/scan`, { method: 'POST', headers: h, body: context.request.body })
      const body = await r.text()
      return new Response(body, { status: r.status, headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } })
    } catch (e) {
      return json({ error: 'Receipt scan unavailable', items_added: 0 }, 503)
    }
  }

  // Parse JSON body { image: base64string, mimeType: string }
  let imageBase64, imageMediaType = 'image/jpeg'
  try {
    const body = await context.request.json()
    if (!body.image) return json({ error: 'No image provided' }, 400)
    imageBase64 = body.image
    imageMediaType = body.mimeType || 'image/jpeg'
  } catch (e) {
    return json({ error: 'Failed to read request body: ' + String(e) }, 400)
  }

  const prompt = `This is a grocery store receipt. Extract only edible food and drink items.

Return ONLY this JSON (no other text):
{"items":["item name 1","item name 2"],"count":<number>}

Rules:
- Short simple names (e.g. "chicken breast" not "CHKN BRST 1KG BNLS", "greek yogurt" not "GREEK YOG 10%")
- INCLUDE: fresh produce, meat, fish, dairy, eggs, bread, frozen food, snacks, drinks, condiments, coffee, tea, canned/jarred food, spices
- SKIP non-food items: foil, cling film, bags, cleaning products, batteries, toiletries, paper, packaging
- SKIP: prices, totals, store name, address, dates, barcodes, receipt numbers, VAT lines
- If an item name contains "/" it may be two items — add both separately
- Max 30 items`

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    const claude = await apiRes.json()
    const text = claude.content?.[0]?.text || '{"items":[]}'
    const match = text.match(/\{[\s\S]*\}/)
    const { items = [] } = JSON.parse(match?.[0] || '{"items":[]}')

    // Determine which zone for each item (simple heuristic)
    function getZone(name) {
      const n = name.toLowerCase()
      if (['butter','oil','sauce','mayo','mustard','ketchup','vinegar','soy','sriracha','hot sauce'].some(k => n.includes(k))) return 'condiments'
      if (['frozen','ice cream','peas frozen'].some(k => n.includes(k))) return 'freezer'
      if (['flour','rice','pasta','oat','bread','cereal','nuts','seeds','dried','lentil','bean','canned','tin','jar','chips','crackers','biscuit'].some(k => n.includes(k))) return 'pantry'
      return 'fridge'
    }

    // Add items to fridge via VPS
    let added = 0
    await Promise.allSettled(
      items.map(async (name) => {
        const r = await fetch(`${VPS}/fridge/item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Health-Key': expected },
          body: JSON.stringify({ name, section: getZone(name) }),
        })
        if (r.ok) added++
      })
    )

    return json({ items_added: added, items })
  } catch (e) {
    console.error('Receipt scan error:', e)
    return json({ error: 'Could not process receipt', items_added: 0, items: [] }, 500)
  }
}
