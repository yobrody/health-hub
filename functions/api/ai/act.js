/**
 * Cloudflare Pages Function — POST /api/ai/act
 *
 * Natural-language assistant. The user types one freeform message about
 * their day; Gemini parses it into structured actions the app can execute.
 *
 * Body: { prompt: string }
 * Returns: {
 *   ok: boolean,
 *   summary: string,                 // 1-line confirmation sentence to show
 *   actions: Array<{ type, ...args }>
 * }
 *
 * Action types:
 *   log_food   — { name, count?, kcal, protein_g, meal? }  (one entry per item)
 *   add_fridge — { name, section, store?, size?, unit_size_g?, unit_count?, cost? }
 *
 * Other action types may follow (workouts, water, routines). Keeping the
 * surface tight for v1 so the parse stays reliable.
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

const VALID_SECTIONS = new Set(['fridge', 'freezer', 'pantry', 'condiments'])
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

  const now = new Date()
  const hour = now.getUTCHours()  // close enough for meal inference; user's TZ ~UTC
  const defaultMeal = defaultMealForHour(hour)

  const sysPrompt = `You translate one short message about the user's day into structured actions for a personal health app.

Available action types:
1. log_food — log eaten food to today's calorie/protein log
   args: { name: string, count?: number, kcal: number, protein_g: number, meal?: "Breakfast"|"Lunch"|"Snack"|"Dinner" }
   Notes: estimate kcal+protein per UNIT for typical UK supermarket portions.
   If the user says "3 eggs", emit ONE entry with count=3 and kcal/protein per egg
   (the app multiplies). If meal isn't stated, pick by time of day — current
   default is "${defaultMeal}".

2. add_fridge — add an item to inventory
   args: { name: string, section: "fridge"|"freezer"|"pantry"|"condiments", store?: string, size?: string, unit_size_g?: number, unit_count?: number, cost?: number }
   Notes: "can of pineapple" → unit_count=1, size="can". "1kg chicken" → unit_size_g=1000.
   Section: dairy/produce/eggs/meat → fridge; ice cream/frozen → freezer;
   canned/dry/snacks/bread → pantry; sauces/oils → condiments.

Return ONLY this JSON (no markdown):
{
  "actions": [ { "type": "...", ...args } ],
  "summary": "one short, friendly past-tense confirmation sentence for the user"
}

Examples:

User: "I ate 3 eggs today"
{"actions":[{"type":"log_food","name":"eggs","count":3,"kcal":78,"protein_g":6,"meal":"Breakfast"}],"summary":"Logged 3 eggs to breakfast (~234 kcal)."}

User: "3 eggs and 3 pieces of bacon and a can of pineapple from aldi"
{"actions":[
  {"type":"log_food","name":"eggs","count":3,"kcal":78,"protein_g":6,"meal":"Breakfast"},
  {"type":"log_food","name":"bacon","count":3,"kcal":43,"protein_g":3,"meal":"Breakfast"},
  {"type":"add_fridge","name":"pineapple","section":"pantry","store":"Aldi","size":"can","unit_count":1}
],"summary":"Logged eggs + bacon to breakfast and added a can of pineapple from Aldi to your pantry."}

User: "${prompt.replace(/"/g, '\\"')}"`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
    prompt: sysPrompt,
    maxTokens: 800,
    temperature: 0.3,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, detail: r.error.slice(0, 150), actions: [], summary: '' }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse model response', actions: [], summary: '' }, 422) }

  // Validate / sanitise actions
  const cleaned = []
  for (const a of (parsed.actions || [])) {
    if (!a || typeof a !== 'object') continue
    if (a.type === 'log_food') {
      const name = String(a.name || '').trim().slice(0, 80)
      if (!name) continue
      const kcal = clampNumber(a.kcal, 0, 5000)
      const protein_g = clampNumber(a.protein_g, 0, 500)
      const count = clampNumber(a.count, 1, 50) ?? 1
      const meal = VALID_MEALS.has(a.meal) ? a.meal : defaultMeal
      cleaned.push({ type: 'log_food', name, count, kcal: kcal ?? 0, protein_g: protein_g ?? 0, meal })
    } else if (a.type === 'add_fridge') {
      const name = String(a.name || '').trim().toLowerCase().slice(0, 80)
      if (!name) continue
      const section = VALID_SECTIONS.has(a.section) ? a.section : 'fridge'
      const out = { type: 'add_fridge', name, section }
      if (typeof a.store === 'string' && a.store.trim()) out.store = a.store.trim().slice(0, 60)
      if (typeof a.size === 'string' && a.size.trim()) out.size = a.size.trim().slice(0, 30)
      const usg = clampNumber(a.unit_size_g, 1, 50000); if (usg) out.unit_size_g = usg
      const uc = clampNumber(a.unit_count, 1, 200); if (uc) out.unit_count = uc
      const c = clampNumber(a.cost, 0, 500); if (c != null) out.cost = c
      cleaned.push(out)
    }
  }

  return json({
    ok: true,
    summary: String(parsed.summary || '').slice(0, 200),
    actions: cleaned,
  })
}
