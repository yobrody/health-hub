/**
 * Cloudflare Pages Function - POST /api/ai/analyze-food
 * Analyzes a food photo via OpenRouter (Gemini 2.0 Flash vision).
 * Body: { image: base64, mimeType: string, description: string }
 * Returns: { name, kcal, protein_g, carbs_g, fat_g, description, confidence }
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

const PROMPT = (desc) =>
  `Analyze this food image${desc ? ` (user says: "${desc}")` : ''}.

Return ONLY valid JSON, no markdown:
{"name":"short food name","kcal":450,"protein_g":35,"carbs_g":40,"fat_g":12,"description":"one sentence description","confidence":"high"}

confidence: "high" if clearly visible, "medium" if partially visible, "low" if unclear.
Be realistic about portion sizes. If no food visible, set kcal to 0.`

export async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'

  const orKey = context.env.OPENROUTER_API_KEY
  if (!orKey) return json({ error: 'OpenRouter not configured' }, 503)

  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { image, mimeType = 'image/jpeg', description = '' } = body
  if (!image) return json({ error: 'No image provided' }, 400)

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
        max_tokens: 300,
        provider: { order: ['Google'], allow_fallbacks: false },
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
            { type: 'text', text: PROMPT(description) },
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

    return json({
      name: result.name || description || 'Unknown food',
      kcal: result.kcal || 0,
      protein_g: result.protein_g || 0,
      carbs_g: result.carbs_g || 0,
      fat_g: result.fat_g || 0,
      description: result.description || '',
      confidence: result.confidence || 'medium',
    })
  } catch (e) {
    console.error('analyze-food error:', e)
    return json({
      name: description || 'Unknown food',
      kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      description: 'Could not analyse — enter details manually',
      confidence: 'low',
    })
  }
}
