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
const VALID_LISTS = new Set(['groceries', 'errands', 'shopping'])
const VALID_PRIORITIES = new Set(['low', 'normal', 'urgent'])
const KNOWN_ROUTINES = new Set(['meditate', 'vitamins', 'journal', 'read', 'stretch'])

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
  // Use Europe/London time (the user's actual locale) for meal-of-day +
  // date computation. Was using UTC which drifted: at 00:30 BST a "today"
  // log would write to yesterday's file because UTC was still 23:30 the
  // previous day. Intl handles BST/GMT switches automatically.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hour = parseInt(parts.hour, 10)
  const todayIso = `${parts.year}-${parts.month}-${parts.day}`
  const yParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now.getTime() - 86400000)).map(p => [p.type, p.value]))
  const yesterdayIso = `${yParts.year}-${yParts.month}-${yParts.day}`
  const defaultMeal = defaultMealForHour(hour)

  const sysPrompt = `You translate one short message about the user's day into structured actions for a personal health app.

Today's date: ${todayIso} (${defaultMeal} time of day).
Yesterday: ${yesterdayIso}.

The user has these SAVED MEAL TEMPLATES — when the message mentions any of
the aliases (case-insensitive), emit ONE log_food action with the template's
canonical name + total kcal + total protein, NOT individual items:

  • "Standard breakfast" — 80g oats, 25g whey, 25g PB, 1 banana
    aliases: "breakfast", "oats bowl", "morning oats", "standard breakfast", "my breakfast"
    meal: Breakfast | kcal: 750 | protein_g: 35

  • "Standard lunch" — 180g chicken thighs, 200g rice, 1 tbsp olive oil, veg
    aliases: "lunch", "standard lunch", "my lunch", "chicken bowl", "chicken and rice"
    meal: Lunch | kcal: 800 | protein_g: 50

  • "Standard dinner" — chicken or beef mince, rice/pasta, veg
    aliases: "dinner", "standard dinner", "my dinner"
    meal: Dinner | kcal: 800 | protein_g: 50

  • "Yogurt snack" — 250g Greek yogurt, 15g PB, honey/fruit
    aliases: "yogurt snack", "greek yogurt bowl", "yogurt", "afternoon snack", "post-workout snack"
    meal: Snack | kcal: 400 | protein_g: 28

If the user says "had my breakfast" or "standard lunch", emit ONE log_food
with name="Standard breakfast" (or whichever matched), the template's full
kcal and protein_g, count=1, meal as listed above. DO NOT split into multiple
items — the user wants the saved-meal shortcut. They can fall back to typing
the items individually if they want detail.

Available action types:
1. log_food — log eaten food to the calorie/protein log
   args: { name: string, count?: number, kcal: number, protein_g: number, carbs_g: number, fat_g: number, fiber_g?: number, meal?: "Breakfast"|"Lunch"|"Snack"|"Dinner", date?: string, matched_product?: string, brand_or_shop?: string, confidence?: "high"|"medium"|"low", confidence_reason?: string }
   Notes: estimate kcal, protein, carbs and fat (per UNIT) for typical UK supermarket portions; add fiber_g when notable. ALWAYS include carbs_g and fat_g on every log_food — the app stores full macros per item.
   If the user says "3 eggs", emit ONE entry with count=3 and kcal/protein per egg
   (the app multiplies). If meal isn't stated, pick by time of day — current
   default is "${defaultMeal}".
   CRITICAL — explicit quantities / multi-ingredient meals: when the user lists
   several ingredients with weights (e.g. "75g oats, 46g peanut butter, 75g
   banana, 39g honey"), emit a SEPARATE log_food for EVERY ingredient with kcal
   and protein computed from the stated grams (count=1, gram-accurate values).
   NEVER drop ingredients and NEVER collapse the meal into one low estimate.
   Per-100g anchors (kcal / protein_g): dried/rolled oats 379/13, peanut butter
   597/22, chia seeds 486/17, banana 89/1.1, honey 304/0.3, cinnamon 247/4,
   whey protein 400/80, cooked white rice 130/2.7, chicken breast 165/31,
   chicken thigh 209/18, egg(1)≈72/6, whole milk 64/3.3, greek yogurt 97/9,
   olive oil 884/0, bread(1 slice)≈80/3, cheddar 402/25. Unknown item → best
   per-100g guess. Compute kcal = anchor_kcal * grams / 100 (round). A bowl of
   oats with peanut butter, banana and honey is ~700–800 kcal, never ~250.
   For explicit raw-ingredient meals like this, DO NOT emit consume_fridge —
   just log the food accurately.
   IMPORTANT: If a brand/shop is mentioned (Its Bagels, Greggs, Aldi, Tesco, Pret, etc.),
   set matched_product to the exact product name from that shop, brand_or_shop to the brand,
   and confidence to "high" if you know the actual nutrition, "medium" if estimating.
   Always set confidence_reason explaining your estimate source.
   Date handling: if the user references a past day ("yesterday", "last night",
   "this morning" but it's now afternoon/evening), set date to that day's
   ISO YYYY-MM-DD. Default = today (omit the field). "this morning" said
   before noon = today + Breakfast; said after noon = today + Breakfast still
   (the user is logging breakfast retroactively, same day). "last night" or
   "yesterday" = ${yesterdayIso} + Dinner.

2. add_fridge — add an item to inventory
   args: { name: string, section: "fridge"|"freezer"|"pantry"|"condiments", store?: string, size?: string, unit_size_g?: number, unit_count?: number, cost?: number }
   Notes: "can of pineapple" → unit_count=1, size="can". "1kg chicken" → unit_size_g=1000.
   Section: dairy/produce/eggs/meat → fridge; ice cream/frozen → freezer;
   canned/dry/snacks/bread → pantry; sauces/oils → condiments.

3. log_water — record glasses of water drunk today
   args: { count: number }
   Use for "two glasses of water", "had a pint", "drank 500ml" (round to glasses ~250ml).
   Daily goal is 8 glasses.

4. mark_routine — mark a daily routine done
   args: { name: "meditate"|"vitamins"|"journal"|"read"|"stretch" }
   Use for "meditated", "took my vitamins", "did 10 mins of journaling",
   "read a chapter", "stretched". Match the action to the closest routine name.

5. add_agenda — add a task to today's plan
   args: { title: string, priority?: "low"|"normal"|"urgent" }
   Use for "remind me to call mum", "I need to fix the bike", "todo: book dentist".
   Default priority is "normal"; "urgent"/"asap"/"important" → "urgent";
   "if I get round to it"/"sometime" → "low".

6. add_list_item — add to a shopping/errands/groceries list
   args: { list: "groceries"|"errands"|"shopping", text: string }
   Use for "add tomatoes to my groceries list", "I need to buy a new charger",
   "errand: pick up parcel from PO". Default list is "groceries" for food
   items, "shopping" for non-food consumer goods, "errands" for tasks.

7. log_weight — record a body-weight reading
   args: { kg: number, date?: string }
   Use for "weighed 64.5", "scale said 64.2 kg this morning",
   "weight 142 lbs" (CONVERT to kg: lbs × 0.4536). Round to 1 decimal.
   "yesterday morning I was 64.3" → date=yesterday. Same-day re-logs
   overwrite (the most recent reading wins).

8. consume_fridge — decrement remaining stock of a fridge item
   args: { name: string, grams?: number, count?: number }  (one of grams/count required)
   PAIR THIS WITH log_food whenever the user eats something they probably
   have in stock — e.g. eggs, milk, yogurt, chicken, cheese, butter, bread.
   "ate 2 eggs" → log_food (calories) + consume_fridge {name:"eggs",count:2}
   "ate 180g chicken thighs" → log_food + consume_fridge {name:"chicken thighs",grams:180}
   "drank a glass of milk" → log_food + consume_fridge {name:"milk",grams:250}
   Skip for restaurant / on-the-go items they obviously didn't have stocked
   (e.g. "had a meal deal", "got a coffee from work"). Use lowercase name.
   Backend matches name as case-insensitive substring across the whole fridge,
   so partial names work (e.g. "yogurt" matches "Greek yogurt 500g").

Return ONLY this JSON (no markdown):
{
  "actions": [ { "type": "...", ...args } ],
  "summary": "one short, friendly past-tense confirmation sentence for the user"
}

Examples:

User: "I ate 3 eggs today"
{"actions":[{"type":"log_food","name":"eggs","count":3,"kcal":78,"protein_g":6,"meal":"Breakfast"}],"summary":"Logged 3 eggs to breakfast (~234 kcal)."}

User: "yesterday I had a slice of pizza for dinner"
{"actions":[{"type":"log_food","name":"pizza slice","count":1,"kcal":285,"protein_g":12,"meal":"Dinner","date":"${yesterdayIso}"}],"summary":"Logged a slice of pizza to yesterday's dinner."}

User: "3 eggs and 3 pieces of bacon and a can of pineapple from aldi"
{"actions":[
  {"type":"log_food","name":"eggs","count":3,"kcal":78,"protein_g":6,"meal":"Breakfast"},
  {"type":"log_food","name":"bacon","count":3,"kcal":43,"protein_g":3,"meal":"Breakfast"},
  {"type":"add_fridge","name":"pineapple","section":"pantry","store":"Aldi","size":"can","unit_count":1}
],"summary":"Logged eggs + bacon to breakfast and added a can of pineapple from Aldi to your pantry."}

User: "had two glasses of water and meditated for 10 minutes"
{"actions":[
  {"type":"log_water","count":2},
  {"type":"mark_routine","name":"meditate"}
],"summary":"Logged 2 glasses of water and marked meditation done."}

User: "weighed 64.5 this morning"
{"actions":[{"type":"log_weight","kg":64.5}],"summary":"Logged 64.5 kg."}

User: "ate 4 eggs scrambled with butter for breakfast"
{"actions":[
  {"type":"log_food","name":"4 scrambled eggs with butter","count":1,"kcal":360,"protein_g":24,"meal":"Breakfast"},
  {"type":"consume_fridge","name":"eggs","count":4},
  {"type":"consume_fridge","name":"butter","grams":10}
],"summary":"Logged scrambled eggs to breakfast and dropped 4 eggs + 10g butter from your fridge."}

User: "had my breakfast"
{"actions":[{"type":"log_food","name":"Standard breakfast","count":1,"kcal":750,"protein_g":35,"meal":"Breakfast"}],"summary":"Logged your standard breakfast (~750 kcal, 35g protein)."}

User: "standard lunch and a yogurt snack"
{"actions":[
  {"type":"log_food","name":"Standard lunch","count":1,"kcal":800,"protein_g":50,"meal":"Lunch"},
  {"type":"log_food","name":"Yogurt snack","count":1,"kcal":400,"protein_g":28,"meal":"Snack"}
],"summary":"Logged your standard lunch and a yogurt snack."}

User: "remind me to call mum and add tomatoes to groceries"
{"actions":[
  {"type":"add_agenda","title":"call mum","priority":"normal"},
  {"type":"add_list_item","list":"groceries","text":"tomatoes"}
],"summary":"Added 'call mum' to today's plan and tomatoes to your groceries list."}

User: "75g of dried oats, 46g of smooth peanut butter, 7g of chia seeds, 75g of banana, 1g of cinnamon, 39g of honey"
{"actions":[
  {"type":"log_food","name":"75g oats","count":1,"kcal":284,"protein_g":10,"meal":"Breakfast"},
  {"type":"log_food","name":"46g peanut butter","count":1,"kcal":275,"protein_g":10,"meal":"Breakfast"},
  {"type":"log_food","name":"7g chia seeds","count":1,"kcal":34,"protein_g":1,"meal":"Breakfast"},
  {"type":"log_food","name":"75g banana","count":1,"kcal":67,"protein_g":1,"meal":"Breakfast"},
  {"type":"log_food","name":"39g honey","count":1,"kcal":119,"protein_g":0,"meal":"Breakfast"}
],"summary":"Logged oats, peanut butter, chia, banana and honey to breakfast (~779 kcal, 22g protein)."}

User: "${prompt.replace(/"/g, '\\"')}"`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
    prompt: sysPrompt,
    maxTokens: 1536,
    temperature: 0.2,
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
      const carbs_g = clampNumber(a.carbs_g, 0, 800)
      const fat_g = clampNumber(a.fat_g, 0, 500)
      const fiber_g = clampNumber(a.fiber_g, 0, 200)
      const count = clampNumber(a.count, 1, 50) ?? 1
      const meal = VALID_MEALS.has(a.meal) ? a.meal : defaultMeal
      const out = { type: 'log_food', name, count, kcal: kcal ?? 0, protein_g: protein_g ?? 0, carbs_g: carbs_g ?? 0, fat_g: fat_g ?? 0, fiber_g: fiber_g ?? 0, meal }
      // Validate any date Gemini emitted: must be ISO + within last 7d / next 1d.
      if (typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
        const d = new Date(a.date + 'T12:00:00Z')
        if (!isNaN(d.getTime())) {
          const days = (now.getTime() - d.getTime()) / 86400000
          if (days >= -1 && days <= 7) out.date = a.date
        }
      }
      cleaned.push(out)
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
    } else if (a.type === 'log_water') {
      const count = clampNumber(a.count, 1, 12)
      if (!count) continue
      cleaned.push({ type: 'log_water', count })
    } else if (a.type === 'mark_routine') {
      const rname = String(a.name || '').trim().toLowerCase().slice(0, 30)
      if (!KNOWN_ROUTINES.has(rname)) continue
      cleaned.push({ type: 'mark_routine', name: rname })
    } else if (a.type === 'add_agenda') {
      const title = String(a.title || '').trim().slice(0, 200)
      if (!title) continue
      const priority = VALID_PRIORITIES.has(a.priority) ? a.priority : 'normal'
      cleaned.push({ type: 'add_agenda', title, priority })
    } else if (a.type === 'add_list_item') {
      const text = String(a.text || '').trim().slice(0, 120)
      if (!text) continue
      const list = VALID_LISTS.has(a.list) ? a.list : 'groceries'
      cleaned.push({ type: 'add_list_item', list, text })
    } else if (a.type === 'log_weight') {
      const kg = clampNumber(a.kg, 30, 300)
      if (!kg) continue
      const out = { type: 'log_weight', kg: Math.round(kg * 10) / 10 }
      if (typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
        const d = new Date(a.date + 'T12:00:00Z')
        if (!isNaN(d.getTime())) {
          const days = (now.getTime() - d.getTime()) / 86400000
          if (days >= -1 && days <= 30) out.date = a.date
        }
      }
      cleaned.push(out)
    } else if (a.type === 'consume_fridge') {
      const name = String(a.name || '').trim().toLowerCase().slice(0, 80)
      if (!name) continue
      // Cap grams/count at sane levels — a single meal isn't 5 kg of chicken
      // or 100 eggs, so wild values are model hallucinations rather than
      // real intent. Match server-side limits would be looser, but this
      // protects the fridge log from one bad parse nuking a stock count.
      const grams = clampNumber(a.grams, 1, 2000)
      const count = clampNumber(a.count, 1, 50)
      if (grams == null && count == null) continue
      const out = { type: 'consume_fridge', name }
      if (grams != null) out.grams = grams
      if (count != null) out.count = count
      cleaned.push(out)
    }
  }

  return json({
    ok: true,
    summary: String(parsed.summary || '').slice(0, 200),
    actions: cleaned,
  })
}
