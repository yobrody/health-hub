/**
 * Cloudflare Pages Function — POST /api/fridge/scan
 * AI-powered receipt scanning via direct Google AI Studio (Gemini 2.5 Flash).
 * Returns detected items — client handles adding to VPS via /api/fridge/item.
 *
 * Migrated 2026-05-05 from OpenRouter (paid credits) to direct Google AI
 * Studio free tier. Same vision capability, no credit consumption.
 */
import { geminiVisionJSON } from '../_gemini.js'

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

const PROMPT = `Look at this grocery store receipt. Extract the purchased food and drink items.

Return ONLY valid JSON — no markdown, no explanation:
{"store":{"name":"store name","location":"address/area on receipt or null"},"items":[{"name":"readable name","unit_size_g":340,"unit_count":null,"size":"340g","cost":1.89,"section":"fridge"}]}

Rules:
- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%", "peanut butter" not "PNT BTR 340G")
- unit_size_g: pack size in grams as a NUMBER (parse "340g" → 340, "1kg" → 1000, "1.5L" → 1500). null if not shown or not weight-based.
- unit_count: discrete count if it makes more sense than weight (eggs: 6 or 12, apples: 4). null otherwise.
- size: human-readable package size string (e.g. "340g", "1L", "12 eggs") — null if not shown.
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
  let imageBase64, imageMediaType = 'image/jpeg'
  try {
    const body = await context.request.json()
    if (!body.image) return json({ error: 'No image provided' }, 400)
    imageBase64 = body.image
    imageMediaType = body.mimeType || 'image/jpeg'
  } catch (e) {
    return json({ error: 'Bad request: ' + String(e) }, 400)
  }

  const r = await geminiVisionJSON({
    apiKey: context.env.GEMINI_API_KEY,
      apiKey2: context.env.GEMINI_API_KEY_2,
    openaiApiKey: context.env.OPENAI_API_KEY,
    prompt: PROMPT,
    imageBase64,
    mimeType: imageMediaType,
    maxTokens: 1500,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}: ${r.error.slice(0, 150)}`, items: [] }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse AI response', raw: r.text.slice(0, 200), items: [] }) }

  const store = parsed.store || null
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .filter(i => i?.name)
        .map(i => ({
          name: i.name.toLowerCase().trim(),
          size: i.size || (typeof i.unit_size_g === 'number' ? `${i.unit_size_g}g` : null),
          unit_size_g: typeof i.unit_size_g === 'number' && i.unit_size_g > 0 ? i.unit_size_g : null,
          unit_count: Number.isInteger(i.unit_count) && i.unit_count > 0 ? i.unit_count : null,
          cost: typeof i.cost === 'number' ? i.cost : null,
          section: ['fridge','freezer','pantry','condiments'].includes(i.section) ? i.section : 'fridge',
        }))
    : []

  return json({ items, store })
}
