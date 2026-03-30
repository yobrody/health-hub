/**
 * Cloudflare Pages Function - POST /api/ai/meals
 * Generates meal suggestions from current fridge contents via OpenRouter.
 * Overrides the broken VPS /ai/meals endpoint.
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}
const VPS_BASE = 'http://128-140-33-150.nip.io:8080'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

function extractJSON(str) {
  try { return JSON.parse(str) } catch {}
  const m = str.match(/\[[\s\S]*\]/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  const m2 = str.match(/\{[\s\S]*\}/)
  if (m2) { try { const o = JSON.parse(m2[0]); return o.meals || o } catch {} }
  return null
}

export async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'

  const orKey = context.env.OPENROUTER_API_KEY
  if (!orKey) return json({ error: 'OpenRouter not configured', meals: [] }, 503)

  // Fetch current fridge contents
  let fridgeItems = []
  try {
    const kv = context.env.FRIDGE_META
    const vpsRes = await fetch(`${VPS_BASE}/fridge`, {
      headers: { 'X-Health-Key': expected, 'Content-Type': 'application/json' }
    })
    if (vpsRes.ok) {
      const fridgeData = await vpsRes.json()
      const zones = ['fridge', 'freezer', 'pantry', 'condiments']
      for (const zone of zones) {
        if (!Array.isArray(fridgeData[zone])) continue
        for (const item of fridgeData[zone]) {
          let meta = {}
          if (kv) {
            try {
              const ms = await kv.get((item.name || '').toLowerCase().trim())
              if (ms) meta = JSON.parse(ms)
            } catch {}
          }
          fridgeItems.push({ name: item.name, zone, size: meta.size || null })
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch fridge:', e)
  }

  if (fridgeItems.length === 0) {
    return json({ meals: [] })
  }

  const itemList = fridgeItems.map(i => `- ${i.name}${i.size ? ` (${i.size})` : ''} [${i.zone}]`).join('\n')

  const prompt = `I have these ingredients in my fridge/pantry:\n${itemList}\n\nSuggest 3 meals I can make. Return ONLY valid JSON array, no markdown:\n[{"name":"Meal Name","ingredients":["item1","item2"],"kcal_estimate":450},...]`

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
        max_tokens: 800,
        provider: { order: ['Google'], allow_fallbacks: false },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const t = await res.text()
      return json({ error: `AI error ${res.status}`, meals: [] }, 502)
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '[]'
    const parsed = extractJSON(text)
    const meals = Array.isArray(parsed) ? parsed : (parsed?.meals || [])

    return json({ meals: meals.slice(0, 3) })
  } catch (e) {
    return json({ error: 'AI request failed: ' + String(e), meals: [] }, 502)
  }
}
