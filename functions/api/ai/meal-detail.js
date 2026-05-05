/**
 * Cloudflare Pages Function — POST /api/ai/meal-detail
 *
 * Generates a recipe (steps + per-serving macros) for a single meal idea.
 * Direct Gemini 2.5 Flash on the free tier.
 *
 * Body: { name: string, ingredients: string[] }
 * Returns: { prep_minutes, cook_minutes, servings, steps, kcal, protein_g, carbs_g, fat_g }
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const name = String(body?.name || '').slice(0, 200)
  const ingredients = Array.isArray(body?.ingredients) ? body.ingredients.slice(0, 30) : []
  if (!name) return json({ error: 'name is required' }, 400)

  const prompt = `Recipe for: ${name}
Ingredients available: ${ingredients.length ? ingredients.join(', ') : '(none specified)'}

Return ONLY this JSON (no markdown, no commentary):
{"prep_minutes": 15, "cook_minutes": 20, "servings": 1, "steps": ["Step 1...", "Step 2..."], "kcal": 620, "protein_g": 42, "carbs_g": 60, "fat_g": 22}

Rules:
- 4-8 short cooking steps (one sentence each, action-first)
- Macros are per serving
- Be realistic about portions (one serving for an active adult)`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
    prompt,
    maxTokens: 800,
    temperature: 0.5,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, detail: r.error.slice(0, 200) }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse recipe response' }, 422) }

  return json({
    prep_minutes: typeof parsed.prep_minutes === 'number' ? parsed.prep_minutes : null,
    cook_minutes: typeof parsed.cook_minutes === 'number' ? parsed.cook_minutes : null,
    servings: typeof parsed.servings === 'number' ? parsed.servings : null,
    steps: Array.isArray(parsed.steps) ? parsed.steps.map(String).slice(0, 12) : [],
    kcal: typeof parsed.kcal === 'number' ? parsed.kcal : 0,
    protein_g: typeof parsed.protein_g === 'number' ? parsed.protein_g : 0,
    carbs_g: typeof parsed.carbs_g === 'number' ? parsed.carbs_g : 0,
    fat_g: typeof parsed.fat_g === 'number' ? parsed.fat_g : 0,
  })
}
