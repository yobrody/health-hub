/**
 * Shared Gemini 2.5 Flash helper for CF Pages Functions — vision + text.
 *
 * Why direct Google instead of OpenRouter: the free tier on Google AI Studio
 * gives ~15 RPM / 1500 RPD on gemini-2.5-flash, which is plenty for personal
 * use, with no credit consumption. Used to be reached via OpenRouter
 * `google/gemini-2.0-flash-001`, which charged credits.
 *
 * Note 2026-05: gemini-2.0-flash has been gated to paid tier; gemini-2.5-flash
 * is the free-tier successor. Verify with ListModels if quota errors recur.
 */

// gemini-2.5-flash-lite has 1000+ RPD on free tier; gemini-2.5-flash has only
// ~20 RPD on this account (lower than the published 250 — appears to be a
// per-project-config thing). Lite is plenty for structured extraction tasks
// (receipt OCR, food photo macros, recipe steps, item nutrition).
const MODEL = 'gemini-2.5-flash-lite'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// Free-tier Gemini intermittently returns 429 (rate) / 503 (overloaded) /
// 5xx for a second or two. Those are transient — a short retry absorbs them
// so the user doesn't see "API error" when they log food. Non-retryable
// statuses (400/401/403/404) fail fast.
const RETRYABLE = new Set([429, 500, 502, 503, 504])
async function fetchWithRetry(url, init, attempts = 3, baseDelay = 450) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || !RETRYABLE.has(res.status)) return res
      last = res
    } catch (e) {
      // Network/abort error — retry too (unless the signal was aborted, in
      // which case the next fetch will throw immediately and we bail out).
      last = e
      if (init.signal && init.signal.aborted) throw e
    }
    if (i < attempts - 1) {
      const retryAfter = last && last.headers ? parseInt(last.headers.get('retry-after') || '', 10) : NaN
      const delay = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1000, 4000)
        : Math.min(baseDelay * Math.pow(2, i) + Math.random() * 150, 4000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  if (last instanceof Error) throw last
  return last
}

/**
 * Text-only Gemini call expecting JSON.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
export async function geminiTextJSON({
  apiKey, prompt, maxTokens = 800, temperature = 0.4, timeoutMs = 25000,
}) {
  if (!apiKey) return { ok: false, status: 503, error: 'GEMINI_API_KEY not configured' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchWithRetry(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature,
          maxOutputTokens: maxTokens,
          // Disable thinking — these are structured-extraction tasks, not
          // reasoning. Without this, 2.5-flash burns the token budget on
          // hidden thinking before emitting output and we get MAX_TOKENS.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: ctrl.signal,
    }, 3)
    if (!res.ok) {
      const errTxt = await res.text()
      return { ok: false, status: res.status, error: errTxt.slice(0, 300) }
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
    const res = await fetchWithRetry(`${ENDPOINT}?key=${apiKey}`, {
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
    }, 2)
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
