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

// OpenAI fallback. NOTE: a ChatGPT *Pro* subscription does NOT grant API
// access — this uses an OpenAI Platform API key (env OPENAI_API_KEY,
// pay-as-you-go). When that key is set, every AI feature automatically retries
// here if Gemini fails (quota/rate/5xx), so a drained free-tier Gemini quota no
// longer breaks food logging, coach, the routine parser, etc.
async function openaiJSON({ apiKey, prompt, imageBase64, mimeType = 'image/jpeg', maxTokens = 1024, temperature = 0.3, timeoutMs = 30000 }) {
  if (!apiKey) return { ok: false, status: 503, error: 'OPENAI_API_KEY not configured' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const content = imageBase64
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }]
    : prompt
  try {
    const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: imageBase64 ? 'gpt-4o' : 'gpt-4o-mini',
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: maxTokens,
      }),
      signal: ctrl.signal,
    }, 2)
    if (!res.ok) {
      const errTxt = await res.text()
      return { ok: false, status: res.status, error: 'openai: ' + errTxt.slice(0, 200) }
    }
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content || ''
    if (!text) return { ok: false, status: 502, error: 'empty response from OpenAI' }
    return { ok: true, text, provider: 'openai' }
  } catch (e) {
    return { ok: false, status: 502, error: 'openai fetch failed: ' + String(e) }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Text JSON with automatic Gemini→OpenAI fallback. Pass openaiApiKey to enable
 * the fallback; without it, behaves exactly as Gemini-only.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
// Statuses worth retrying on a DIFFERENT key (quota/rate/auth/availability) —
// as opposed to 400/422 which would just fail again.
const FAILOVER = new Set([401, 403, 408, 429, 500, 502, 503, 504])

export async function geminiTextJSON(opts) {
  const r = await geminiTextOnly(opts)
  if (r.ok) return r
  // Free second Gemini key (GEMINI_API_KEY_2) has its own daily quota — when
  // key 1 is rate-limited or exhausted we transparently retry on key 2.
  if (opts.apiKey2 && FAILOVER.has(r.status)) {
    const r2 = await geminiTextOnly({ ...opts, apiKey: opts.apiKey2 })
    if (r2.ok) return r2
  }
  if (opts.openaiApiKey) {
    const o = await openaiJSON({ apiKey: opts.openaiApiKey, prompt: opts.prompt, maxTokens: opts.maxTokens, temperature: opts.temperature })
    if (o.ok) return o
  }
  return r
}

/**
 * Vision JSON with automatic Gemini→OpenAI fallback. Pass openaiApiKey to enable.
 */
export async function geminiVisionJSON(opts) {
  const r = await geminiVisionOnly(opts)
  if (r.ok) return r
  // Free second Gemini key fallback (does vision too) before any paid provider.
  if (opts.apiKey2 && FAILOVER.has(r.status)) {
    const r2 = await geminiVisionOnly({ ...opts, apiKey: opts.apiKey2 })
    if (r2.ok) return r2
  }
  if (opts.openaiApiKey) {
    const o = await openaiJSON({ apiKey: opts.openaiApiKey, prompt: opts.prompt, imageBase64: opts.imageBase64, mimeType: opts.mimeType, maxTokens: opts.maxTokens, temperature: 0.2 })
    if (o.ok) return o
  }
  return r
}

/**
 * Text-only Gemini call expecting JSON.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
async function geminiTextOnly({
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
async function geminiVisionOnly({
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
