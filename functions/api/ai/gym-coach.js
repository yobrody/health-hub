/**
 * POST /api/ai/gym-coach
 *
 * Two modes via `kind`:
 *   • machine-question — body { question: string, knownEquipment?: string[] }
 *       returns { answer, suggestedEquipment?, suggestedSchedule? }
 *
 *   • workout-summary  — body { analysis, weeklyVolume?: [...], recent?: [...] }
 *       returns { narrative }
 *
 * Uses Gemini 2.5 Flash via the shared helper. Failure modes degrade to a
 * deterministic fallback so the UI never sees an empty card.
 */
import { geminiTextJSON } from '../_gemini.js'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS }) }
export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }) }

const MACHINE_PROMPT = `You are Brody's gym coach in his personal Health Hub app. He trains at The Gym Group, Paddington, London — a typical mid-tier UK chain gym (Life Fitness Insignia stacks, Hammer Strength plate-loaded equipment, dumbbells 2.5–50kg, full Olympic rack).

Brody is 6'0", ~64kg, lean-bulking. His current 4-day Upper/Lower split focuses on hypertrophy:
• Upper A: Chest · Back · Arms (incline DB press, machine chest press, lat pulldown, seated row, lateral raise, tricep pushdown, curls, abs)
• Lower A: Legs · Core (leg press, leg extension, leg curl, calf raise, cable crunch, hanging knee raise)
• Upper B: Shoulders · Back · Chest (flat DB press, pull-ups, pec deck, single-arm row, DB shoulder press, lateral raise, rear delt fly, tricep extension, hammer curl)
• Lower B: Legs · Recovery (lighter leg press, leg ext, leg curl, glute trainer, calf raise, glute kickback, abs)

He's asking you about a specific machine. Respond with strict JSON:

{
  "answer": "1-2 short sentences. Plain language. Tell him what the machine does and whether it's available at his gym (Yes if it's standard Gym Group kit; Maybe — check with staff if it's specialty). DO NOT use markdown.",
  "suggestedEquipment": {
    "id": "kebab-case-id",
    "name": "Display Name",
    "type": "stack | plate-loaded | dumbbell | barbell | cable | bodyweight | machine-fixed",
    "stack": { "min": <kg>, "max": <kg>, "step": <kg> },
    "aliases": ["lowercase alias", ...],
    "notes": "Optional 1-line note"
  } | null,
  "suggestedSchedule": {
    "addToDay": "Upper A | Lower A | Upper B | Lower B | none",
    "afterExercise": "<existing exercise name in that day, or empty string for end>",
    "sets": <int>,
    "repRange": "8-12" | "10-15" | "6-10" | etc,
    "rir": "1-3",
    "restSeconds": <int>,
    "startingWeight_kg": <number>,
    "rationale": "1 sentence why this machine fits where you put it (target a muscle gap, replaces redundant lift, etc)"
  } | null
}

Rules:
• If the machine is essentially the same as one already in his program, set suggestedEquipment to null and tell him in the answer it's redundant.
• If the machine is genuinely new and useful, suggest where it fits given the program above and his hypertrophy goal.
• If you don't know what the machine is, set both to null and ask a clarifying question in answer.
• starting weight: be conservative — 60% of what an equivalent already-programmed lift uses, or a sensible beginner weight.
• Output ONLY the JSON. No prose, no markdown fences.`

const SUMMARY_PROMPT = `You are Brody's gym coach. Generate a short post-workout summary (3-5 sentences max, no bullet points). Speak in second person ("you"). Cover: how this session compared to last time, top moments (PRs or strong lifts), what to work on next session, and any nutrition or volume adjustment that follows from the data. Be direct, no platitudes ("great job"), no emojis. Output ONLY a JSON object: { "narrative": "<your text>" }.`

export async function onRequestPost(context) {
  let body
  try { body = await context.request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const kind = String(body?.kind || '').trim()
  const apiKey = context.env.GEMINI_API_KEY

  if (kind === 'machine-question') {
    const question = String(body?.question || '').trim().slice(0, 400)
    if (!question) return json({ error: 'question required' }, 400)
    const known = Array.isArray(body?.knownEquipment)
      ? body.knownEquipment.map(String).slice(0, 50).join(', ')
      : ''

    const prompt = `${MACHINE_PROMPT}

Brody's question: ${question}

Equipment already in his catalog: ${known || 'none yet'}`

    const result = await geminiTextJSON({ apiKey, prompt, maxTokens: 600, temperature: 0.3 })
    if (!result.ok) {
      return json({
        ok: true,
        answer: "Coach is offline — I can't reach the AI right now. Try again in a minute, or add the machine manually from the Manage sheet.",
        suggestedEquipment: null,
        suggestedSchedule: null,
        offline: true,
      })
    }
    try {
      const parsed = JSON.parse(result.text)
      return json({ ok: true, ...parsed })
    } catch {
      return json({
        ok: true,
        answer: result.text.slice(0, 300),
        suggestedEquipment: null,
        suggestedSchedule: null,
      })
    }
  }

  if (kind === 'workout-summary') {
    const analysis = body?.analysis
    if (!analysis || typeof analysis !== 'object') return json({ error: 'analysis required' }, 400)

    const weekly = Array.isArray(body?.weeklyVolume) ? body.weeklyVolume : []
    const prompt = `${SUMMARY_PROMPT}

This workout's analysis (JSON):
${JSON.stringify(analysis).slice(0, 1500)}

Last 7 days of muscle volume:
${JSON.stringify(weekly).slice(0, 800)}`

    const result = await geminiTextJSON({ apiKey, prompt, maxTokens: 400, temperature: 0.5 })
    if (!result.ok) {
      // Deterministic fallback so the user always sees *something*.
      const head = analysis.headline || `${analysis.completedSets} sets · ${analysis.durationMins}m`
      return json({ ok: true, narrative: `Session done: ${head}. Volume ${analysis.totalVolume}kg. Coach is offline — refresh and try again for personalised insights.`, offline: true })
    }
    try {
      const parsed = JSON.parse(result.text)
      return json({ ok: true, narrative: parsed.narrative || result.text })
    } catch {
      return json({ ok: true, narrative: result.text.slice(0, 600) })
    }
  }

  return json({ error: 'unknown kind' }, 400)
}
