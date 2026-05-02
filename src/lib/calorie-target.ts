// Adaptive calorie-target suggestion: looks at the user's weight log over the
// last ~2 weeks, compares against their stated direction (gain/maintain/lose),
// and suggests a delta to the calorie target if the trend is off.
//
// All thresholds are conservative — we suggest ±100-200 kcal at a time,
// not ±500. Rapid swings make the trend noisy and the user lose trust in
// the suggestion. Better to nudge slowly.

export type WeightEntry = { date: string; kg: number }
export type Direction = 'gain' | 'maintain' | 'lose'

export const LS_DIRECTION_KEY = 'weight_goal_direction'

export function loadDirection(storage: Pick<Storage, 'getItem'>): Direction {
  try {
    const raw = storage.getItem(LS_DIRECTION_KEY)
    if (raw === 'gain' || raw === 'maintain' || raw === 'lose') return raw
  } catch { /* ignore access errors */ }
  return 'maintain'
}

export function saveDirection(storage: Pick<Storage, 'setItem'>, direction: Direction): void {
  try { storage.setItem(LS_DIRECTION_KEY, direction) } catch { /* quota */ }
}

export type Trend = {
  /** Number of distinct days in the analysis window. */
  days: number
  /** Most recent logged weight in kg. */
  current: number
  /** Linear regression slope expressed as kg per week. Negative = losing. */
  weeklyChangeKg: number
  /** True when we have enough data to trust the slope (≥14 distinct days). */
  reliable: boolean
}

/**
 * Compute a per-week change rate from a weight log via least-squares fit on
 * (day-index, kg) over the last `windowDays` days. Returns null if there isn't
 * enough data even to display a trend (need ≥2 distinct days within the window).
 */
export function analyzeWeightTrend(weights: WeightEntry[], windowDays = 14): Trend | null {
  if (!weights || weights.length === 0) return null
  // Sort ascending by date
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]
  const lastDate = parseISODate(last.date)
  if (!lastDate) return null
  const cutoff = new Date(lastDate.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const window = sorted.filter(w => {
    const d = parseISODate(w.date)
    return d !== null && d >= cutoff
  })
  if (window.length < 2) return null

  // Linear regression: x = days since first point, y = kg
  const x0 = parseISODate(window[0].date)!.getTime()
  const xs = window.map(w => (parseISODate(w.date)!.getTime() - x0) / (24 * 60 * 60 * 1000))
  const ys = window.map(w => w.kg)
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  const slopePerDay = den === 0 ? 0 : num / den
  return {
    days: n,
    current: last.kg,
    weeklyChangeKg: slopePerDay * 7,
    reliable: n >= 14,
  }
}

export type Suggestion = {
  /** Suggested NEW calorie target. Equals currentTarget when no change is recommended. */
  suggested: number
  /** Signed delta (suggested - currentTarget). Zero when nothing's wrong. */
  deltaKcal: number
  /** Plain-English why; rendered in the banner. */
  reason: string
  /** Whether the UI should show a suggestion at all (false when stable / no data). */
  actionable: boolean
}

/**
 * Per-direction thresholds and bumps. All numbers here are intentionally
 * tunable in one place — the calling code shouldn't know the magic numbers.
 *
 * Sign convention is fixed: trending ABOVE the upper bound → eat less
 * (deltaKcal -bumpOver). Trending BELOW the lower bound → eat more
 * (deltaKcal +bumpUnder). This holds for all three directions — what changes
 * per-direction is where the bounds sit and how big the bumps are.
 */
const RULES: Record<Direction, {
  targetWeeklyKg: number
  toleranceKg: number  // half-width around target — within this band → no change
  bumpOverKcal: number   // applied with -ve sign when above upper bound
  bumpUnderKcal: number  // applied with +ve sign when below lower bound
  reasonOver: string
  reasonUnder: string
}> = {
  gain: {
    targetWeeklyKg: 0.25,
    toleranceKg: 0.15,
    bumpOverKcal: 100,  // gaining too fast — back off cautiously
    bumpUnderKcal: 200, // not gaining — push harder
    reasonOver: 'Gaining faster than 0.4kg/week — eat 100 kcal less',
    reasonUnder: 'Not gaining — try 200 kcal more per day',
  },
  maintain: {
    targetWeeklyKg: 0,
    toleranceKg: 0.2,
    bumpOverKcal: 100,
    bumpUnderKcal: 100,
    reasonOver: 'Trending up — try 100 kcal less',
    reasonUnder: 'Trending down — try 100 kcal more',
  },
  lose: {
    targetWeeklyKg: -0.5,
    toleranceKg: 0.25,
    bumpOverKcal: 150,  // not losing → eat 150 kcal less
    bumpUnderKcal: 150, // losing too fast → eat 150 kcal more
    reasonOver: 'Not losing — try 150 kcal less per day',
    reasonUnder: 'Losing faster than 0.75kg/week — eat 150 kcal more',
  },
}

/**
 * Given a trend + direction + current calorie target, return either:
 *   - a small adjustment (typically ±100-200 kcal), or
 *   - "no action" when the trend is in-band.
 *
 * Returns `actionable: false` whenever the trend is unreliable (<14 days),
 * the trend object is null, or the change is within tolerance.
 */
export function suggestCalorieTarget(
  currentTarget: number,
  trend: Trend | null,
  direction: Direction,
): Suggestion {
  if (!trend || !trend.reliable) {
    return {
      suggested: currentTarget,
      deltaKcal: 0,
      reason: trend ? 'Need ≥14 days of weight logs to trust the trend' : 'No weight data yet',
      actionable: false,
    }
  }
  const rule = RULES[direction]
  const upperBound = rule.targetWeeklyKg + rule.toleranceKg
  const lowerBound = rule.targetWeeklyKg - rule.toleranceKg
  if (trend.weeklyChangeKg > upperBound) {
    // Above the desired band → eat less (regardless of direction).
    const delta = -rule.bumpOverKcal
    return {
      suggested: Math.round((currentTarget + delta) / 50) * 50,
      deltaKcal: delta,
      reason: rule.reasonOver,
      actionable: true,
    }
  }
  if (trend.weeklyChangeKg < lowerBound) {
    // Below the desired band → eat more.
    const delta = rule.bumpUnderKcal
    return {
      suggested: Math.round((currentTarget + delta) / 50) * 50,
      deltaKcal: delta,
      reason: rule.reasonUnder,
      actionable: true,
    }
  }
  return {
    suggested: currentTarget,
    deltaKcal: 0,
    reason: 'On track — no change needed',
    actionable: false,
  }
}

function parseISODate(s: string): Date | null {
  // Accept both "YYYY-MM-DD" and full ISO datetimes
  if (!s) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00Z' : s)
  return Number.isNaN(d.getTime()) ? null : d
}
