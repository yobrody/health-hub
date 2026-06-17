/**
 * Cloudflare Pages Function — POST /api/ai/meals
 * Generates 3 meal suggestions from current fridge contents via Gemini 2.5
 * Flash on the free tier (direct Google AI Studio).
 *
 * Migrated 2026-05-05 from OpenRouter (paid credits) to direct Gemini.
 */
import { geminiTextJSON } from '../_gemini.js'

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

export async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'

  // Fetch current fridge contents (with KV-merged size hints).
  const fridgeItems = []
  try {
    const kv = context.env.FRIDGE_META
    const vpsRes = await fetch(`${VPS_BASE}/fridge`, {
      headers: { 'X-Health-Key': expected, 'Content-Type': 'application/json' }
    })
    if (vpsRes.ok) {
      const fridgeData = await vpsRes.json()
      for (const zone of ['fridge', 'freezer', 'pantry', 'condiments']) {
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

  if (fridgeItems.length === 0) return json({ meals: [] })

  const itemList = fridgeItems
    .map(i => `- ${i.name}${i.size ? ` (${i.size})` : ''} [${i.zone}]`)
    .join('\n')

  const prompt = `I have these ingredients in my fridge/pantry:
${itemList}

Suggest 3 meals I can make from them. Return ONLY this JSON shape (no markdown, no commentary):
{"meals":[{"name":"Meal Name","ingredients":["item1","item2"],"kcal_estimate":450}]}`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
      apiKey2: context.env.GEMINI_API_KEY_2,
    openaiApiKey: context.env.OPENAI_API_KEY,
    prompt,
    maxTokens: 800,
    temperature: 0.6,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, detail: r.error.slice(0, 150), meals: [] }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse meals response', meals: [] }, 422) }

  const meals = Array.isArray(parsed?.meals)
    ? parsed.meals
    : Array.isArray(parsed)
    ? parsed
    : []
  return json({ meals: meals.slice(0, 3) })
}
