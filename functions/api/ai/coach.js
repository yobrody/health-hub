/**
 * Cloudflare Pages Function — POST /api/ai/coach
 *
 * Reverse macro solver. The user names a set of ingredients and asks how
 * much of each to cook to hit their remaining daily goal. Gemini picks the
 * foods, sensible per-100g macros, and reasonable portions; THIS FUNCTION
 * does every piece of arithmetic deterministically so the numbers are
 * trustworthy (the model never does mental math we rely on).
 *
 * Body: {
 *   prompt: string,                       // "pork mince, broccoli, spinach - how much to hit my goal?"
 *   remaining?: { kcal?: number, protein_g?: number },  // today's goal minus consumed
 * }
 * Returns: {
 *   ok: boolean,
 *   summary: string,                      // one-line recommendation
 *   note?: string,                        // short reasoning from the model
 *   plan: {
 *     ingredients: Array<{ name, grams, kcal, protein_g, carbs_g, fat_g }>,
 *     totals: { kcal, protein_g, carbs_g, fat_g },
 *     remaining: { kcal, protein_g },
 *   },
 *   actions: Array<{ type:'log_food', ... }>,  // ready to confirm + log via the normal path
 * }
 */
import { geminiTextJSON } from '../_gemini.js'

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

const VALID_MEALS = new Set(['Breakfast', 'Lunch', 'Snack', 'Dinner'])
function clampNumber(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.max(min, Math.min(max, v))
}
function defaultMealForHour(h) {
  if (h < 11) return 'Breakfast'
  if (h < 15) return 'Lunch'
  if (h < 18) return 'Snack'
  return 'Dinner'
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const prompt = String(body?.prompt || '').trim().slice(0, 600)
  if (!prompt) return json({ error: 'prompt required' }, 400)

  // Remaining targets for the day. Clamp to sane ranges; default to a
  // reasonable single-meal target when the client doesn't supply them.
  const remKcal = clampNumber(Number(body?.remaining?.kcal), 0, 6000) ?? 700
  const remProtein = clampNumber(Number(body?.remaining?.protein_g), 0, 400) ?? 40

  const hour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })
      .formatToParts(new Date()).find(p => p.type === 'hour').value, 10)
  const defaultMeal = defaultMealForHour(hour)

  const sysPrompt = `You are a nutrition coach for a personal health app. The user names some
ingredients they're about to cook and wants to know how many grams of each to
use to hit what's LEFT of their daily goal.

Remaining today: ${remKcal} kcal and ${remProtein} g protein.

Rules:
- Identify each ingredient the user names. Give realistic per-100g macros for
  raw/typical UK supermarket form (kcal, protein_g, carbs_g, fat_g).
- Choose grams for each ingredient so the MEAL TOTAL lands as close as possible
  to the remaining protein FIRST, then the remaining kcal. Protein priority.
- Use sensible, cookable portions (e.g. 100-250g for a protein, 80-200g for veg).
  Never propose absurd amounts (no 900g of mince, no 5g of a main).
- It's fine to fall a little short or over; get protein close.
- Per-100g anchors you can rely on (kcal / protein / carbs / fat):
  pork mince(10% fat) 263/17/0/21, beef mince(5%) 137/21/0/5, chicken breast 165/31/0/4,
  chicken thigh 209/18/0/15, salmon 208/20/0/13, eggs 143/13/1/10, tofu 76/8/2/5,
  broccoli 34/2.8/7/0.4, spinach 23/2.9/3.6/0.4, white rice(cooked) 130/2.7/28/0.3,
  pasta(cooked) 157/6/31/0.9, potato 77/2/17/0.1, sweet potato 86/1.6/20/0.1,
  olive oil 884/0/0/100, cheddar 402/25/1/33, greek yogurt 97/9/4/5.
  Unknown item → best per-100g guess.
- Do NOT compute the meal totals yourself — just give grams + per100 for each
  ingredient and a one-line note. The app does the arithmetic.

Return ONLY this JSON (no markdown):
{
  "ingredients": [
    { "name": "pork mince", "grams": 190, "per100": { "kcal": 263, "protein_g": 17, "carbs_g": 0, "fat_g": 21 } }
  ],
  "note": "one short sentence on the strategy"
}

User: "${prompt.replace(/"/g, '\\"')}"`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
      apiKey2: context.env.GEMINI_API_KEY_2,
    openaiApiKey: context.env.OPENAI_API_KEY,
    prompt: sysPrompt,
    maxTokens: 1024,
    temperature: 0.2,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, detail: String(r.error || '').slice(0, 150) }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse model response' }, 422) }

  // Recompute EVERYTHING deterministically from grams x per-100g.
  const ingredients = []
  const actions = []
  let tK = 0, tP = 0, tC = 0, tF = 0
  for (const it of (parsed.ingredients || [])) {
    if (!it || typeof it !== 'object') continue
    const name = String(it.name || '').trim().slice(0, 80)
    const grams = clampNumber(Number(it.grams), 1, 2000)
    const p = it.per100 || {}
    const k100 = clampNumber(Number(p.kcal), 0, 1000)
    const pr100 = clampNumber(Number(p.protein_g), 0, 100)
    const c100 = clampNumber(Number(p.carbs_g), 0, 100)
    const f100 = clampNumber(Number(p.fat_g), 0, 100)
    if (!name || grams == null || k100 == null) continue
    const factor = grams / 100
    const kcal = Math.round(k100 * factor)
    const protein_g = Math.round((pr100 ?? 0) * factor)
    const carbs_g = Math.round((c100 ?? 0) * factor)
    const fat_g = Math.round((f100 ?? 0) * factor)
    ingredients.push({ name, grams, kcal, protein_g, carbs_g, fat_g })
    tK += kcal; tP += protein_g; tC += carbs_g; tF += fat_g
    actions.push({ type: 'log_food', name: `${grams}g ${name}`, count: 1, kcal, protein_g, carbs_g, fat_g, fiber_g: 0, meal: defaultMeal })
  }

  if (!ingredients.length) {
    return json({ error: 'No ingredients understood', plan: null, actions: [] }, 422)
  }

  const totals = { kcal: tK, protein_g: tP, carbs_g: tC, fat_g: tF }
  const portionText = ingredients.map(i => `${i.grams}g ${i.name}`).join(', ')
  const summary = `To add ~${remProtein}g protein within ${remKcal} kcal: ${portionText} → ${totals.kcal} kcal, ${totals.protein_g}g protein.`

  return json({
    ok: true,
    summary,
    note: String(parsed.note || '').slice(0, 200),
    plan: { ingredients, totals, remaining: { kcal: remKcal, protein_g: remProtein } },
    actions,
  })
}
