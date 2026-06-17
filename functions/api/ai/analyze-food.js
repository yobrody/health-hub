/**
 * Cloudflare Pages Function - POST /api/ai/analyze-food
 *
 * Body: {
 *   image: base64,
 *   mimeType: string,
 *   description?: string,
 *   mode?: 'home' | 'out',                  // defaults to 'home' if fridge present, else 'out'
 *   fridge?: FridgeData | FridgeItem[]       // ignored in 'out' mode
 * }
 *
 * Returns: {
 *   mode: 'home' | 'out',
 *   foods: [{name, kcal, protein_g, carbs_g, fat_g, grams?}],
 *   fridge_matches: [{name, zone, added, grams_used?}],   // [] when mode='out'
 *   confidence: 'high' | 'medium' | 'low'
 * }
 *
 * Migrated 2026-05-05 from OpenRouter (paid credits) to direct Google AI
 * Studio free tier (gemini-2.5-flash).
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

// Packaged-food accuracy: a printed nutrition label is the ground truth, so
// READ it rather than estimate. A branded front-of-pack with no readable label
// must NOT yield a confident guess (wrong numbers are worse than none) — flag
// it low-confidence + needs_label so the app asks for the label.
const LABEL_RULE = `PACKAGED FOOD & NUTRITION LABELS — check this FIRST, before anything else:
- If a NUTRITION LABEL / information panel is visible (a table listing Energy/kcal, Fat, Carbohydrate, Protein — per 100g and/or per serving/pack): READ THE PRINTED NUMBERS EXACTLY. Never estimate when the label is readable. Return ONE food item. If a per-serving or per-pack column is shown, use those values and set grams to that serving size; otherwise use the per-100g values and set grams to 100. Set "source":"label" and "confidence":"high".
- If a PACKAGED PRODUCT is shown only from the FRONT (branded wrapper/box, e.g. a meal-deal sandwich) and you CANNOT actually read a nutrition panel: identify the product name and give a rough best-effort estimate, but set "source":"estimate", "confidence":"low", and "needs_label": true. Do NOT present a confident number you could not read — the app will ask the user to photograph the nutrition label.`

// CRITICAL: the model must REFUSE to invent food when the image is empty,
// dark, blurry, or non-food. Past failure mode: black screen → "chicken katsu
// curry". The IMAGE GUARD rules below + an empty-array escape hatch fix that.
const IMAGE_GUARD = `IMAGE QUALITY GUARD:
- If the image is mostly black, dark, blurry, blank, a screen capture, a UI screenshot, a wall, a person, a logo, a pet, or a building AND there is no food and no nutrition label: return {"foods":[],"fridge_matches":[],"confidence":"low"}. DO NOT guess.
- A photo of a NUTRITION LABEL is VALID input — do NOT treat printed nutrition text as "no food"; read it per the PACKAGED FOOD rule above.
- If you would have to invent details to fill the JSON, return empty foods.
- Only name a plated meal if the food is clearly visible. "Maybe chicken curry" → empty foods.`

const HOME_PROMPT = (desc, fridgeNames) => `${LABEL_RULE}

${IMAGE_GUARD}

Analyze this home-made meal photo${desc ? ` (user says: "${desc}")` : ''}.

Identify ALL distinct food items visible. Estimate realistic nutrition AND grams for the visible portion of each item.

${fridgeNames.length ? `User's fridge/pantry contents: ${fridgeNames.join(', ')}` : 'No fridge inventory provided.'}

For each food on the plate that appears to come from the fridge list, also estimate how many grams of that fridge item were used.

Return ONLY valid JSON, no markdown:
{
  "foods": [
    {"name":"Chicken breast","kcal":280,"protein_g":52,"carbs_g":0,"fat_g":6,"grams":150},
    {"name":"Brown rice","kcal":215,"protein_g":4,"carbs_g":45,"fat_g":2,"grams":120}
  ],
  "fridge_matches": [
    {"name":"chicken breast","grams_used":150},
    {"name":"brown rice","grams_used":120}
  ],
  "confidence": "high",
  "source": "estimate",
  "needs_label": false
}

Rules:
- source: "label" only if you READ a printed nutrition panel; otherwise "estimate".
- needs_label: true when it's a packaged product you can't read a label for (see PACKAGED FOOD rule).
- grams: visible portion weight in grams (raw/cooked, whichever is on the plate)
- fridge_matches: only items from the fridge list that clearly match something visible. Use the EXACT name from the fridge list.
- grams_used: estimated raw/dry grams of the fridge item that went into this dish (a 150g cooked chicken portion ≈ 200g raw)
- confidence: "high" if clearly visible, "medium" if partially visible, "low" if unclear
- Empty/non-food images: return empty foods + empty fridge_matches + "low" confidence — see IMAGE QUALITY GUARD above.`

const OUT_PROMPT = (desc) => `${LABEL_RULE}

${IMAGE_GUARD}

Analyze this restaurant / takeaway / out-and-about food photo${desc ? ` (user says: "${desc}")` : ''}.

This food was NOT made from the user's fridge — they're eating out. Identify ALL distinct food items visible and estimate realistic nutrition + grams for the portion shown.

Return ONLY valid JSON, no markdown:
{
  "foods": [
    {"name":"Chicken katsu curry","kcal":820,"protein_g":42,"carbs_g":86,"fat_g":34,"grams":480}
  ],
  "confidence": "high",
  "source": "estimate",
  "needs_label": false
}

Rules:
- source: "label" only if you READ a printed nutrition panel; otherwise "estimate".
- needs_label: true when it's a packaged product you can't read a label for (see PACKAGED FOOD rule).
- grams: estimated total weight of the dish in grams as served
- confidence: "high" if clearly visible, "medium" if partially visible, "low" if unclear
- Be realistic about restaurant portions (often larger than home-cooked)
- Empty/non-food images: return empty foods + "low" confidence — see IMAGE QUALITY GUARD above.`

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { image, mimeType = 'image/jpeg', description = '', fridge = null, mode } = body
  if (!image) return json({ error: 'No image provided' }, 400)

  // Build flat list of fridge items across all zones from FridgeData object
  const fridgeItems = []
  if (fridge) {
    for (const zone of ['fridge', 'freezer', 'pantry', 'condiments']) {
      const zoneItems = fridge[zone]
      if (Array.isArray(zoneItems)) {
        zoneItems.forEach(it => fridgeItems.push({ ...it, zone }))
      }
    }
    if (Array.isArray(fridge)) {
      fridge.forEach(it => fridgeItems.push({ zone: 'fridge', ...it }))
    }
  }
  const fridgeNames = fridgeItems.map(it => it.name)

  // If caller didn't specify mode, infer: fridge present → home, otherwise → out.
  const effectiveMode = mode === 'home' || mode === 'out'
    ? mode
    : (fridgeItems.length > 0 ? 'home' : 'out')
  const promptText = effectiveMode === 'home'
    ? HOME_PROMPT(description, fridgeNames)
    : OUT_PROMPT(description)

  try {
    const r = await geminiVisionJSON({
      apiKey: context.env.GEMINI_API_KEY,
      apiKey2: context.env.GEMINI_API_KEY_2,
      openaiApiKey: context.env.OPENAI_API_KEY,
      prompt: promptText,
      imageBase64: image,
      mimeType,
      maxTokens: 800,
    })
    if (!r.ok) {
      console.error('Gemini error:', r.status, r.error)
      return json({ error: 'AI error', detail: r.error.slice(0, 100) }, r.status === 503 ? 503 : 502)
    }
    let result
    try { result = JSON.parse(r.text) }
    catch { throw new Error('No JSON in response') }

    const foods = Array.isArray(result.foods) ? result.foods : []
    let fridge_matches = []
    if (effectiveMode === 'home') {
      // Resolve match names back to full item objects, attaching grams_used
      const rawMatches = Array.isArray(result.fridge_matches) ? result.fridge_matches : []
      fridge_matches = rawMatches
        .map(m => {
          // Match can be a string (back-compat) or {name, grams_used}
          const name = typeof m === 'string' ? m : m?.name
          const grams_used = typeof m === 'object' && typeof m?.grams_used === 'number' ? m.grams_used : null
          if (!name) return null
          const item = fridgeItems.find(it =>
            it.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(it.name.toLowerCase())
          )
          if (!item) return null
          return { ...item, grams_used }
        })
        .filter(Boolean)
    }

    return json({
      mode: effectiveMode,
      foods,
      fridge_matches,
      confidence: result.confidence || 'medium',
      source: result.source === 'label' ? 'label' : 'estimate',
      needs_label: result.needs_label === true,
    })
  } catch (e) {
    console.error('analyze-food error:', e)
    return json({ mode: effectiveMode, foods: [], fridge_matches: [], confidence: 'low' })
  }
}
