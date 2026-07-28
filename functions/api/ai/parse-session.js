/**
 * Cloudflare Pages Function - POST /api/ai/parse-session
 *
 * Turns a freeform description of a COMPLETED session into logged sets.
 *
 * This is deliberately different from parse-routine, which produces a plan
 * (rep RANGES, no loads). This produces history: what was actually lifted,
 * for how many reps, at what effort.
 *
 * It exists because people describe a finished session in prose far faster
 * than they tap it in set by set - "failed on 5 at 32kg, dropped to 27 for 5"
 * is one sentence and three logged sets.
 *
 * Body: { text: string }
 * Returns: {
 *   ok: boolean,
 *   title: string,
 *   exercises: Array<{ name, sets: Array<{ weight_kg?, reps?, rir? }> }>,
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

function num(v, min, max, step = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const clamped = Math.max(min, Math.min(max, v))
  // Multiply-then-divide. Dividing first gives 3.4 -> 34 -> 3.4000000000000004,
  // which would be written into history and rendered verbatim.
  const f = 1 / step
  return Math.round(clamped * f) / f
}

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const text = String(body?.text || '').trim().slice(0, 6000)
  // Exercise names the app already knows. History is keyed by EXACT name, so
  // a parsed 'Tricep Pushdown' would never match the programme's 'Triceps
  // Pushdown' and the session would be invisible to progression.
  const known = Array.isArray(body?.known)
    ? body.known.map(s => String(s).slice(0, 80)).filter(Boolean).slice(0, 120)
    : []
  if (!text) return json({ error: 'text required', exercises: [] }, 400)

  const sysPrompt = `You convert a spoken or typed description of a workout the user has ALREADY
FINISHED into structured logged sets. This is history, not a plan.

CRITICAL CONVENTIONS - people describe sets loosely, so read carefully:
- "failed on the 5th rep" / "failed on 5" means 4 COMPLETED reps, not 5.
- "barely got 4" / "managed 4" means 4 completed reps.
- "couldn't finish" with no number means 0 completed reps - omit that set.
- A weight change mid-exercise starts a NEW set at the new weight. Walking a
  weight down ("15kg failed, dropped to 7.9, then 5.7, then 3.4 for 10") is
  four separate sets, in that order.
- "same for set 2" / "same again" repeats the previous set exactly.
- "x reps each arm" or "per arm" is ONE set - do not double it.
- NEVER invent a rep count. If a weight is mentioned with no reps stated for
  it, OMIT that set entirely - do not carry a number over from a neighbouring
  set. "12kg was too heavy, dropped to 7 for 15" is ONE set: 7kg for 15 reps.
  The 12kg attempt has no rep count and must not be recorded as one.
  Likewise "tried 20kg, went down to 15kg for 10" is ONE set: 15kg for 10.
- Bodyweight movements have no weight: omit weight_kg entirely.
- Holds measured in seconds are not reps - omit them rather than guess.

For each set also infer rir (reps in reserve, 0-4) from the language:
- failed / to failure / couldn't finish -> 0
- "barely", "grinding", "really hard" -> 0
- "hard" -> 1
- unremarkable, no comment -> 2
- "easy", "comfortable", "could have done more" -> 3
Omit rir if there is genuinely no signal.

Weights are kilograms unless the text says lb or lbs, in which case convert
to kg (1 lb = 0.4536 kg) and round to one decimal.

Ignore warm-up sets unless the user explicitly says they logged them.
Ignore cardio, stretching, and any commentary that is not a working set.

NAMING - this matters more than it looks. These are the exercise names the app
already tracks:
${known.length ? known.join(' | ') : '(none provided)'}
If a described exercise is clearly one of those, return that name EXACTLY,
character for character. Only invent a name when there is genuinely no match.
History is matched by exact name, so a near-miss silently loses the session.

Give the session a title. If it is clearly a push, pull or legs day, use
exactly "Push", "Pull" or "Legs". If it is bodyweight skill work (handstands,
pike pushups, pull-ups, dips) use "Skill". Otherwise use a short descriptive
title.

Return ONLY this JSON (no markdown, no commentary):
{ "title": "Push", "exercises": [ { "name": "Seated Shoulder Press (machine)", "sets": [ { "weight_kg": 32, "reps": 4, "rir": 0 } ] } ] }

Session:
"""
${text.replace(/"/g, "'")}
"""`

  const r = await geminiTextJSON({
    apiKey: context.env.GEMINI_API_KEY,
    apiKey2: context.env.GEMINI_API_KEY_2,
    prompt: sysPrompt,
    maxTokens: 3072,
    temperature: 0.1,
  })
  if (!r.ok) {
    return json({ error: `AI error ${r.status}`, exercises: [] }, r.status === 503 ? 503 : 502)
  }
  let parsed
  try { parsed = JSON.parse(r.text) }
  catch { return json({ error: 'Could not read that session - try describing it more plainly', exercises: [] }, 422) }

  const exercises = []
  for (const e of (parsed.exercises || [])) {
    if (!e || typeof e !== 'object') continue
    const name = String(e.name || '').trim().slice(0, 80)
    if (!name) continue

    const sets = []
    for (const s of (e.sets || [])) {
      if (!s || typeof s !== 'object') continue
      const reps = num(s.reps, 0, 500, 1)
      const weight = num(s.weight_kg, 0, 1000, 0.1)
      const rir = num(s.rir, 0, 5, 1)
      // A set with no reps recorded is not a set.
      if (reps === null || reps <= 0) continue
      const out = { reps }
      if (weight !== null && weight > 0) out.weight_kg = weight
      if (rir !== null) out.rir = rir
      sets.push(out)
      if (sets.length >= 15) break
    }
    if (!sets.length) continue
    exercises.push({ name, sets })
    if (exercises.length >= 25) break
  }

  if (!exercises.length) {
    return json({ ok: false, title: '', exercises: [], error: 'No completed sets found in that description' }, 422)
  }

  const title = String(parsed.title || 'Workout').trim().slice(0, 60) || 'Workout'
  return json({ ok: true, title, exercises })
}
