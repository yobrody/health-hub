/**
 * Cloudflare Pages Function — POST /api/ai/parse-routine
 *
 * Turns a freeform workout routine (pasted from ChatGPT, a website, a PT's
 * note, etc.) into structured exercises the app can track. Gemini does the
 * messy natural-language parse; this function validates + clamps every field
 * so the output is safe to drop straight into a workout.
 *
 * Body: { text: string }
 * Returns: {
 *   ok: boolean,
 *   title: string,
 *   exercises: Array<{ name, sets, repRange, restSeconds, rir }>,
 *   error?: string
 * }
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

function clampNumber(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.max(min, Math.min(max, Math.round(v)))
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const text = String(body?.text || '').trim().slice(0, 4000)
  if (!text) return json({ error: 'text required', exercises: [] }, 400)

  const sysPrompt = `You convert a freeform workout routine into structured JSON. The text may
come from ChatGPT, a website, or handwritten notes — formats vary wildly
("Bench 4x8", "3 sets of 10-12 lat pulldown", "Squat 5×5 @ RPE 8", bullet
lists, paragraphs).

Extract every distinct exercise IN ORDER. For each:
- name: clean exercise name, title case (e.g. "Barbell Bench Press").
- sets: number of working sets (default 3 if unstated).
- repRange: a string like "8-12" or "5". If a single number, use it as-is.
  If reps unstated, use "8-12".
- restSeconds: rest between sets in seconds if stated/implied (compound lifts
  ~120, isolation ~60). Default 90.
- rir: reps-in-reserve or effort note if present (e.g. "1-2", "RPE 8"),
  else "1-3".

Ignore warm-ups described as such, cardio-only lines, and non-exercise text.
Give the routine a short title (e.g. "Push Day", "Full Body A"); if none is
stated, use "Imported Routine".

Return ONLY this JSON (no markdown):
{ "title": "...", "exercises": [ { "name": "...", "sets": 3, "repRange": "8-12", "restSeconds": 90, "rir": "1-3" } ] }

Routine:
"""
${text.replace(/"/g, "'")}
"""`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
    prompt: sysPrompt,
    maxTokens: 2048,
    temperature: 0.2,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, exercises: [] }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not parse the routine — try simplifying the text', exercises: [] }, 422) }

  const exercises = []
  for (const e of (parsed.exercises || [])) {
    if (!e || typeof e !== 'object') continue
    const name = String(e.name || '').trim().slice(0, 80)
    if (!name) continue
    const sets = clampNumber(e.sets, 1, 12) ?? 3
    let repRange = String(e.repRange ?? '').trim().slice(0, 12)
    if (!/\d/.test(repRange)) repRange = '8-12'
    const restSeconds = clampNumber(e.restSeconds, 15, 600) ?? 90
    const rir = String(e.rir ?? '1-3').trim().slice(0, 12) || '1-3'
    exercises.push({ name, sets, repRange, restSeconds, rir })
    if (exercises.length >= 25) break
  }

  if (!exercises.length) {
    return json({ ok: false, title: '', exercises: [], error: 'No exercises found in that text' }, 422)
  }

  const title = String(parsed.title || 'Imported Routine').trim().slice(0, 60) || 'Imported Routine'
  return json({ ok: true, title, exercises })
}
