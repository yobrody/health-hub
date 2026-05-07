// Pure helpers for workout weight prediction + nutrition gating.
// Extracted so the rules are testable without rendering the Workout page.

export type RepRange = { min: number; max: number }

export function parseRepRange(repRange?: string | null): RepRange | null {
  if (!repRange) return null
  // Accept ASCII hyphen-minus, en-dash, and em-dash. The PROGRAM data is
  // authored with en-dashes ("8–12") so an ASCII-only regex silently misses
  // every program rep range, which used to suppress the at-top-of-range
  // analysis and overload bumps.
  const m = repRange.match(/(\d+)\s*[-–—]\s*(\d+)/)
  if (!m) return null
  const min = parseInt(m[1], 10)
  const max = parseInt(m[2], 10)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null
  return { min, max }
}

export type SetSummary = { weight_kg?: number | null; reps?: number | null }

export type PredictInput = {
  /** Personal best for this exercise — used as the baseline weight when there's no fresher data. */
  prevBest?: { weight_kg: number; reps: number } | null
  /** Sets from the most recent workout containing this exercise (in order). Drives the "all reps hit?" check. */
  prevSets?: SetSummary[]
  /** Program prescribed rep range, e.g. "8-12". Drives the bump rule. */
  repRange?: string | null
  /** True iff the user hit calorie + protein goals recently. When false, weight bumps are suppressed. */
  properlyEating: boolean
}

export type PredictResult = {
  /** Suggested starting weight in kg, or undefined when there's no signal at all. */
  weight_kg: number | undefined
  /** Default reps to pre-fill — we offer the rep range max so the "tap ✓ to confirm" UX works. */
  reps: number | undefined
  /** Why this weight was picked. Used for a tiny inline label so the user can trust the number. */
  rationale: 'no-history' | 'baseline-pr' | 'baseline-last' | 'bump-progressive-overload' | 'hold-eat-more' | 'hold-build-reps'
}

const COMPOUND_THRESHOLD_KG = 40

/**
 * Pick the next set's starting weight via a simple progressive-overload rule:
 *   1. If every set last session hit the rep-range top → bump (+2.5kg if base ≥ 40kg, else +1.25kg)
 *      — but only when the user is "properly eating"; otherwise hold (don't try to grow on under-fueled days).
 *   2. If every set last session was below the rep-range minimum → hold (build reps before adding weight).
 *   3. Otherwise hold.
 * Falls back to the user's PR weight, then to the last set's weight, then undefined.
 */
export function predictNextWeight(input: PredictInput): PredictResult {
  const baseline =
    input.prevBest?.weight_kg ??
    input.prevSets?.find(s => typeof s.weight_kg === 'number')?.weight_kg ??
    undefined

  const range = parseRepRange(input.repRange)
  const repsBaseline =
    input.prevBest?.reps ??
    input.prevSets?.find(s => typeof s.reps === 'number')?.reps ??
    range?.max ??
    undefined

  if (baseline === undefined) {
    return { weight_kg: undefined, reps: repsBaseline, rationale: 'no-history' }
  }

  // Bump only when we have rep range AND last session's sets to evaluate.
  const completedLast = (input.prevSets ?? []).filter(
    s => typeof s.reps === 'number' && (s.reps ?? 0) > 0,
  )
  if (range && completedLast.length > 0) {
    const allAtTop = completedLast.every(s => (s.reps ?? 0) >= range.max)
    const allBelowMin = completedLast.every(s => (s.reps ?? 0) < range.min)
    if (allAtTop) {
      if (!input.properlyEating) {
        return { weight_kg: baseline, reps: range.max, rationale: 'hold-eat-more' }
      }
      const bump = baseline >= COMPOUND_THRESHOLD_KG ? 2.5 : 1.25
      return { weight_kg: roundToHalfKg(baseline + bump), reps: range.max, rationale: 'bump-progressive-overload' }
    }
    if (allBelowMin) {
      return { weight_kg: baseline, reps: range.min, rationale: 'hold-build-reps' }
    }
  }

  // No rep-range signal — fall back to baseline.
  return {
    weight_kg: baseline,
    reps: repsBaseline,
    rationale: input.prevBest ? 'baseline-pr' : 'baseline-last',
  }
}

/** 17.5 + 1.25 = 18.75 → 18.75 (already half). 102.5 + 2.5 = 105 → 105. Anything else → nearest 0.25kg. */
function roundToHalfKg(n: number): number {
  return Math.round(n * 4) / 4
}

export type DailyTotals = {
  date: string // ISO YYYY-MM-DD
  total_kcal: number
  total_protein_g?: number
  logged: boolean
}

export type Goals = { calories: number; protein: number }

/**
 * "Properly eating" = the most recent fully-logged day hit at least 95% of both
 * calorie and protein targets. Single bad day is enough to suppress a bump —
 * progressive overload on under-fueled muscle is just risk for no reward.
 *
 * The 95% threshold is permissive enough that a one-meal undershoot doesn't
 * cancel progress, but tight enough that "I had toast for dinner" does.
 */
export function isProperlyEating(history: DailyTotals[], goals: Goals): boolean {
  // Find the latest logged day (the user might not have logged today yet).
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date))
  const lastLogged = sorted.find(d => d.logged)
  if (!lastLogged) return false
  const kcalHit = lastLogged.total_kcal >= goals.calories * 0.95
  const proteinHit = (lastLogged.total_protein_g ?? 0) >= goals.protein * 0.95
  return kcalHit && proteinHit
}
