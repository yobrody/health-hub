// Pure progression rules. No React, no food coupling.
//
// DELIBERATE: nothing in this file reads nutrition. Food and training are kept
// independent so a break in one cannot take down the other. Earned progression
// is never withheld because of a bad food day - food is a DIAGNOSTIC surfaced
// elsewhere (two lifts stalled + bodyweight flat 3wk), never a gate.

import { PROGRESSION } from '../program'

export type RepRange = { min: number; max: number }

export function parseRepRange(repRange?: string | null): RepRange | null {
  if (!repRange) return null
  const m = repRange.match(/(\d+)\s*[-\u2013\u2014]\s*(\d+)/)
  if (!m) return null
  const min = parseInt(m[1], 10)
  const max = parseInt(m[2], 10)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null
  return { min, max }
}

export type SetSummary = { weight_kg?: number | null; reps?: number | null }

export type PredictInput = {
  prevBest?: { weight_kg: number; reps: number } | null
  /** Sets from the most recent session containing this exercise, in order. */
  prevSets?: SetSummary[]
  /** Sets from the session BEFORE that. Drives two-session stall detection. */
  priorSets?: SetSummary[]
  repRange?: string | null
  /** RIR on the last set of the previous session. null = not reported, in
   * which case hitting the top of the range alone earns the jump. */
  lastSessionRIR?: number | null
  /** Days since this exercise was last trained. Drives the layoff rule. */
  daysSinceLast?: number | null
  /** Seed is a carried-over guess, not measured on this machine. Permits an
   * aggressive jump so the weight finds its real level in a session or two
   * instead of crawling up one notch at a time. */
  recalibrating?: boolean
  /** Next selectable weight above baseline, from the equipment catalog. This
   * is what makes the 10% rule possible: at the bottom of an imperial cable
   * stack the next notch can be +68%, which is a wall, not a progression. */
  nextStackUp?: number
}

export type PredictRationale =
  | 'no-history' | 'baseline-pr' | 'baseline-last'
  | 'bump-progressive-overload' | 'bump-recalibrating' | 'bump-too-light' | 'bump-overrun'
  | 'hold-build-reps' | 'hold-rir-slack'
  | 'hold-jump-too-big' | 'deload-stalled' | 'deload-layoff'

export type PredictResult = {
  weight_kg: number | undefined
  reps: number | undefined
  rationale: PredictRationale
  /** One-liner for the UI so the number is never mysterious. */
  note?: string
}

const COMPOUND_THRESHOLD_KG = 40

export function genericStep(currentKg: number): number {
  return currentKg >= COMPOUND_THRESHOLD_KG ? 2.5 : 1.25
}

function roundKg(n: number): number { return Math.round(n * 4) / 4 }

function completed(sets?: SetSummary[]): SetSummary[] {
  return (sets ?? []).filter(s => typeof s.reps === 'number' && (s.reps ?? 0) > 0)
}
function allBelowMin(sets: SetSummary[], r: RepRange): boolean {
  return sets.length > 0 && sets.every(s => (s.reps ?? 0) < r.min)
}
function allAtTop(sets: SetSummary[], r: RepRange): boolean {
  return sets.length > 0 && sets.every(s => (s.reps ?? 0) >= r.max)
}

/**
 * Next working weight, in priority order:
 *   1. >10 days off           -> one session 10% lighter, then resume.
 *   2. Missed bottom twice    -> drop 15% and rebuild.
 *   3. Missed bottom once     -> same weight, no change.
 *   4. Top of range, 2+ RIR   -> same weight, push harder.
 *   5. Top of range, 0-1 RIR  -> smallest jump, unless that jump is >10% of
 *                                current, in which case hold and add reps
 *                                past the top of the range.
 *   6. Inside the range       -> same weight, add a rep.
 */
export function predictNextWeight(input: PredictInput): PredictResult {
  // Anchor on where you SETTLED last session, not your all-time PR.
  //
  // A PR is the heaviest weight ever touched - which is often a failed
  // attempt you immediately dropped down from. Real example: 32kg for 4,
  // 32kg for 4, then 27kg for 5. The PR says 32kg, so a PR-anchored engine
  // prescribes 32kg again and tells you to "chase the bottom of the range" -
  // a weight you had just demonstrated you could not do. The final completed
  // set is where you actually landed after any drop-downs, so it is the
  // honest working weight. PR is kept only as a cold-start fallback.
  const settled = (() => {
    const done = completed(input.prevSets)
    for (let i = done.length - 1; i >= 0; i--) {
      const w = done[i].weight_kg
      if (typeof w === 'number' && w > 0) return w
    }
    return undefined
  })()
  const baseline =
    settled ??
    input.prevBest?.weight_kg ??
    input.prevSets?.find(s => typeof s.weight_kg === 'number')?.weight_kg ??
    undefined

  const range = parseRepRange(input.repRange)
  const repsBaseline =
    input.prevBest?.reps ??
    input.prevSets?.find(s => typeof s.reps === 'number')?.reps ??
    range?.max ?? undefined

  if (baseline === undefined) {
    return { weight_kg: undefined, reps: repsBaseline, rationale: 'no-history' }
  }

  if (input.daysSinceLast != null && input.daysSinceLast > PROGRESSION.layoffDays) {
    return {
      weight_kg: roundKg(baseline * (1 - PROGRESSION.layoffBackoffPct)),
      reps: range?.min ?? repsBaseline,
      rationale: 'deload-layoff',
      note: input.daysSinceLast + ' days off - 10% lighter for one session',
    }
  }

  const last = completed(input.prevSets)
  const prior = completed(input.priorSets)

  if (range && last.length > 0) {
    if (allBelowMin(last, range) && allBelowMin(prior, range)) {
      return {
        weight_kg: roundKg(baseline * (1 - PROGRESSION.stallDeloadPct)),
        reps: range.min, rationale: 'deload-stalled',
        note: 'Missed the bottom twice - dropping 15% to rebuild',
      }
    }
    if (allBelowMin(last, range)) {
      return {
        weight_kg: baseline, reps: range.min, rationale: 'hold-build-reps',
        note: 'Below the range - same weight, chase the bottom',
      }
    }
    if (allAtTop(last, range)) {
      // 2 in reserve at the top of the range means the effort was soft - repeat
      // it properly. 3+ means the RANGE is the limiter, not you, and 'push
      // harder' is not available: the weight is simply too light.
      const tooLight = input.lastSessionRIR != null && input.lastSessionRIR >= PROGRESSION.tooLightRIR
      if (input.lastSessionRIR != null && input.lastSessionRIR >= PROGRESSION.holdAboveRIR && !tooLight) {
        return {
          weight_kg: baseline, reps: range.max, rationale: 'hold-rir-slack',
          note: 'Hit the top with ' + input.lastSessionRIR + ' left - same weight, push harder',
        }
      }
      // Seed was a guess - stop crawling, go find the real weight.
      if (input.recalibrating) {
        return {
          weight_kg: roundKg(baseline * 1.15), reps: range.max,
          rationale: 'bump-recalibrating',
          note: 'Seed was an estimate - jumping ~15% to find your real weight',
        }
      }
      // Already a real notch when the catalog supplied it; already rounded when
      // we derived it. Rounding again is what corrupted it.
      const target = input.nextStackUp ?? roundKg(baseline + genericStep(baseline))
      const jumpPct = baseline > 0 ? (target - baseline) / baseline : 0
      if (jumpPct > PROGRESSION.maxJumpPct) {
        const achieved = Math.max(...last.map(s => s.reps ?? 0))
        const jumpAt = Math.ceil(range.max * PROGRESSION.repsOverrunMultiplier)
        // Enough extra reps at this weight earns the oversized notch.
        if (achieved >= jumpAt) {
          return {
            weight_kg: target, reps: range.min, rationale: 'bump-overrun',
            note: achieved + ' reps at ' + baseline + 'kg earns the jump - restart at ' + range.min + ' reps',
          }
        }
        // Otherwise climb from what was ACTUALLY done, not from the range
        // top - a fixed target repeats the same session forever.
        return {
          weight_kg: baseline, reps: achieved + 1, rationale: 'hold-jump-too-big',
          note: 'Next notch is +' + Math.round(jumpPct * 100) + '% - build to ' + jumpAt + ' reps here first (' + achieved + ' now)',
        }
      }
      return {
        weight_kg: target, reps: range.max,
        rationale: tooLight ? 'bump-too-light' : 'bump-progressive-overload',
        note: tooLight
          ? 'Capped by the rep range, not by strength - going up'
          : 'Earned it - smallest jump up',
      }
    }
  }

  return {
    weight_kg: baseline, reps: repsBaseline,
    rationale: input.prevBest ? 'baseline-pr' : 'baseline-last',
  }
}

// -- Food (diagnostic only - NOT wired into progression) ------------------

export type DailyTotals = {
  date: string
  total_kcal: number
  total_protein_g?: number
  logged: boolean
}

export type Goals = { calories: number; protein: number }

/** Informational badge only. Does NOT gate weight suggestions. */
export function isProperlyEating(history: DailyTotals[], goals: Goals): boolean {
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date))
  const lastLogged = sorted.find(d => d.logged)
  if (!lastLogged) return false
  const kcalHit = lastLogged.total_kcal >= goals.calories * 0.95
  const proteinHit = (lastLogged.total_protein_g ?? 0) >= goals.protein * 0.95
  return kcalHit && proteinHit
}