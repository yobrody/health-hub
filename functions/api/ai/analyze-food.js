/**
 * Cloudflare Pages Function — POST /api/ai/analyze-food
 * Analyzes a food photo + optional text with Claude Vision.
 * Body: JSON { image: base64string, mimeType: string, description: string }
 * Returns: { name, kcal, protein_g, carbs_g, fat_g, description, confidence }
 *
 * Set ANTHROPIC_API_KEY in Cloudflare Pages → Settings → Environment variables.
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

export async function onRequestPost(context) {
  // Auth check
  const reqKey = context.request.headers.get('X-Health-Key') || ''
  const expected = context.env.HEALTH_API_KEY || 'brody-health-hub-2026'
  if (reqKey !== expected) return json({ error: 'Unauthorized' }, 401)

  const anthropicKey = context.env.ANTHROPIC_API_KEY
  if (!anthropicKey)
    return json({ error: 'ANTHROPIC_API_KEY not configured on server. Add it in Cloudflare Pages → Settings → Environment Variables.' }, 503)

  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { image, mimeType = 'image/jpeg', description = '' } = body

  const prompt = `Analyze this food image${description ? ` — the user says it is: "${description}"` : ''}.

Estimate the nutritional content and return ONLY this JSON (no other text):
{
  "name": "short common food name",
  "kcal": <integer calories for this portion>,
  "protein_g": <grams protein>,
  "carbs_g": <grams carbs>,
  "fat_g": <grams fat>,
  "description": "one sentence describing what you see",
  "confidence": "high" | "medium" | "low"
}

Be realistic about portion sizes. If no food is visible, set kcal to 0.`

  const content = []
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: image } })
  }
  content.push({ type: 'text', text: prompt })

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!apiRes.ok) {
      const err = await apiRes.text()
      console.error('Anthropic error:', err)
      return json({ error: 'AI service error', detail: err }, 502)
    }

    const claude = await apiRes.json()
    const text = claude.content?.[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in AI response')
    const result = JSON.parse(match[0])
    return json(result)
  } catch (e) {
    console.error('analyze-food error:', e)
    return json({
      name: description || 'Unknown food',
      kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      description: 'Could not analyze — enter details manually',
      confidence: 'low',
    })
  }
}
