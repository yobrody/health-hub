/**
 * Shared Gemini 2.5 Flash vision helper for CF Pages Functions.
 *
 * Why direct Google instead of OpenRouter: the free tier on Google AI Studio
 * gives ~15 RPM / 1500 RPD on gemini-2.5-flash, which is plenty for personal
 * use, with no credit consumption. Same model class used to be reached via
 * OpenRouter `google/gemini-2.0-flash-001`, which charged credits.
 *
 * Note 2026-05: gemini-2.0-flash has been gated to paid tier; gemini-2.5-flash
 * is the free-tier successor. Verify with ListModels if quota errors recur.
 */

const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

/**
 * Call Gemini Flash with an image + text prompt, expecting a JSON response.
 *
 * @param {object} opts
 * @param {string} opts.apiKey  - Google AI Studio API key (env GEMINI_API_KEY).
 * @param {string} opts.prompt  - Text prompt.
 * @param {string} opts.imageBase64
 * @param {string} [opts.mimeType='image/jpeg']
 * @param {number} [opts.maxTokens=1500]
 * @param {number} [opts.timeoutMs=25000]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
export async function geminiVisionJSON({
  apiKey, prompt, imageBase64, mimeType = 'image/jpeg',
  maxTokens = 1500, timeoutMs = 25000,
}) {
  if (!apiKey) return { ok: false, status: 503, error: 'GEMINI_API_KEY not configured' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: maxTokens,
        },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, status: res.status, error: t.slice(0, 300) }
    }
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!text) return { ok: false, status: 502, error: 'empty response from Gemini' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, status: 502, error: 'gemini fetch failed: ' + String(e) }
  } finally {
    clearTimeout(t)
  }
}
