/**
 * Cloudflare Pages Function - POST /api/ai/analyze-food
 * Body: { image: base64, mimeType: string, description?: string, fridge?: FridgeData | FridgeItem[] }
 * Returns: { foods: [{name,kcal,protein_g,carbs_g,fat_g}], fridge_matches: [{name,zone,added}], confidence }
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

const PROMPT = (desc, fridgeNames) =>
  `Analyze this food image${desc ? ` (user says: "${desc}")` : ''}.

Identify ALL distinct food items visible. For each item estimate realistic nutrition for the visible portion size.

${fridgeNames.length ? `Fridge contents to cross-reference: ${fridgeNames.join(', ')}` : ''}

Return ONLY valid JSON, no markdown:
{
  "foods": [
    {"name":"Chicken breast","kcal":280,"protein_g":52,"carbs_g":0,"fat_g":6},
    {"name":"Brown rice","kcal":215,"protein_g":4,"carbs_g":45,"fat_g":2}
  ],
  "fridge_matches": ["Chicken breast","Brown rice"],
  "confidence": "high"
}

Rules:
- fridge_matches: only items from the fridge list that clearly match something visible in the photo
- confidence: "high" if clearly visible, "medium" if partially visible, "low" if unclear
- Be realistic about portion sizes
- If no food visible, return empty foods array`

export async function onRequestPost(context) {
  const orKey = context.env.OPENROUTER_API_KEY
  if (!orKey) return json({ error: 'OpenRouter not configured' }, 503)

  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { image, mimeType = 'image/jpeg', description = '', fridge = null } = body
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
    // Also handle if fridge was passed as a flat array
    if (Array.isArray(fridge)) {
      fridge.forEach(it => fridgeItems.push({ zone: 'fridge', ...it }))
    }
  }
  const fridgeNames = fridgeItems.map(it => it.name)

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
        max_tokens: 600,
        provider: { order: ['Google'], allow_fallbacks: false },
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
            { type: 'text', text: PROMPT(description, fridgeNames) },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('OpenRouter error:', err)
      return json({ error: 'AI error', detail: err.slice(0, 100) }, 502)
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '{}'
    const result = extractJSON(text)
    if (!result) throw new Error('No JSON in response')

    // Resolve fridge_matches names back to full item objects with zone/added
    const matchNames = Array.isArray(result.fridge_matches) ? result.fridge_matches : []
    const fridge_matches = fridgeItems.filter(it =>
      matchNames.some(n =>
        n.toLowerCase().includes(it.name.toLowerCase()) ||
        it.name.toLowerCase().includes(n.toLowerCase())
      )
    )

    return json({
      foods: Array.isArray(result.foods) ? result.foods : [],
      fridge_matches,
      confidence: result.confidence || 'medium',
    })
  } catch (e) {
    console.error('analyze-food error:', e)
    return json({ foods: [], fridge_matches: [], confidence: 'low' })
  }
}
