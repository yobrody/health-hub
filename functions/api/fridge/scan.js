/**
 * Cloudflare Pages Function — POST /api/fridge/scan
 * AI-powered receipt scanning via OpenRouter (Gemini 2.0 Flash).
 * Returns detected items — client handles adding to VPS via /api/fridge/item.
 * This avoids issues with outbound VPS calls inside the Worker.
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

function extractJSON(str) {
  try { return JSON.parse(str) } catch {}
  let depth = 0, end = -1
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === '}') { if (depth === 0) end = i; depth++ }
    else if (str[i] === '{') {
      depth--
      if (depth === 0 && end !== -1) {
        try { return JSON.parse(str.slice(i, end + 1)) } catch {}
      }
    }
  }
  const m = str.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

const PROMPT = `Look at this grocery store receipt. Extract the purchased food and drink items.

Return ONLY valid JSON — no markdown, no explanation:
{"store":{"name":"store name","location":"address/area on receipt or null"},"items":[{"name":"readable name","size":"package size or null","cost":1.89,"section":"fridge"}]}

Rules:
- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%", "peanut butter" not "PNT BTR 340G")
- size: package size if visible on receipt (e.g. "340g", "1L") — null if not shown
- cost: item price as a number (e.g. 2.25) — null if not visible
- section: one of "fridge", "freezer", "pantry", "condiments"
  - fridge: dairy, fresh produce, eggs, fresh meat/fish, yogurt, juice, deli
  - freezer: frozen meals, ice cream, frozen veg/meat
  - pantry: canned goods, dry goods, snacks, coffee, tea, bread, nuts, spreads, chocolate
  - condiments: sauces, oils, vinegar, dressings, spices
- INCLUDE all food and drink items on the receipt
- SKIP non-food items (foil, bags, cleaning supplies, toiletries, packaging)
- SKIP totals, subtotals, VAT lines, discounts, store header rows
- If a name contains "/" (e.g. "edamame/mushroom") add both as separate items`

export async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'

  const orKey = context.env.OPENROUTER_API_KEY
  if (!orKey) return json({ error: 'OpenRouter key not configured', items: [] }, 503)

  let imageBase64, imageMediaType = 'image/jpeg'
  try {
    const body = await context.request.json()
    if (!body.image) return json({ error: 'No image provided' }, 400)
    imageBase64 = body.image
    imageMediaType = body.mimeType || 'image/jpeg'
  } catch (e) {
    return json({ error: 'Bad request: ' + String(e) }, 400)
  }

  // Call OpenRouter
  let claudeText = ''
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${orKey}`,
        'HTTP-Referer': 'https://health-hub-dwz.pages.dev',
        'X-Title': 'Health Hub',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        max_tokens: 1500,
        provider: { order: ['Google'], allow_fallbacks: false },
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      return json({ error: `AI error ${res.status}: ${t.slice(0, 150)}`, items: [] }, 502)
    }
    const data = await res.json()
    claudeText = data.choices?.[0]?.message?.content || ''
  } catch (e) {
    return json({ error: 'AI request failed: ' + String(e), items: [] }, 502)
  }

  const parsed = extractJSON(claudeText)
  if (!parsed) {
    return json({ error: 'Could not parse AI response', raw: claudeText.slice(0, 200), items: [] })
  }

  const store = parsed.store || null
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .filter(i => i?.name)
        .map(i => ({
          name: i.name.toLowerCase().trim(),
          size: i.size || null,
          cost: typeof i.cost === 'number' ? i.cost : null,
          section: ['fridge','freezer','pantry','condiments'].includes(i.section) ? i.section : 'fridge',
        }))
    : []

  return json({ items, store })
}
