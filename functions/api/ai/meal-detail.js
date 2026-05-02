/**
 * Cloudflare Pages Function — POST /api/ai/meal-detail
 *
 * Replaces the VPS endpoint that was failing with "Couldn't generate recipe"
 * because ANTHROPIC_API_KEY isn't configured on the VPS. Same OpenRouter +
 * Gemini Flash path as /ai/meals so we have one source of truth for AI calls.
 *
 * Body: { name: string, ingredients: string[] }
 * Returns: { prep_minutes, cook_minutes, servings, steps, kcal, protein_g, carbs_g, fat_g }
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
  const m = str.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

export async function onRequestPost(context) {
  const orKey = context.env.OPENROUTER_API_KEY
  if (!orKey) return json({ error: 'OpenRouter not configured' }, 503)

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
      return json({ error: `AI error ${res.status}`, detail: t.slice(0, 200) }, 502)
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '{}'
    const parsed = extractJSON(text)
    if (!parsed) return json({ error: 'Could not parse recipe response' }, 422)

    // Sanitize / coerce shape so the frontend gets predictable fields.
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
  } catch (e) {
    return json({ error: 'AI request failed: ' + String(e) }, 502)
  }
}
