// Recovery-aware training signal. Turns last night's sleep (+ an HRV baseline
// when enough nights exist) into a single readiness score the Workout page can
// react to — "5h sleep, HRV low → deload today".
//
// Honesty rules (same as the rest of the app):
//   • Returns null when there's no sleep data at all — never invents a score.
//   • Only factors HRV in when there's a real personal baseline (≥3 prior
//     nights with HRV); otherwise the score is sleep-only and says so.
//   • The advice is framed by WHY the score is low (short sleep vs low HRV),
//     not a generic label.

export interface ReadinessSleepEntry {
  date: string
  duration_hrs: number
  quality: number // 1–5
  hrv_ms?: number
  resting_hr?: number
}

export type ReadinessLevel = 'ready' | 'moderate' | 'low'

export interface Readiness {
  /** 0–100. Higher = more recovered. */
  score: number
  level: ReadinessLevel
  headline: string
  /** Human-readable inputs behind the score, e.g. "5.1h sleep · short". */
  factors: string[]
  /** What to do with it in the gym today. */
  advice: string
  /** True when a real HRV baseline fed the score; false = sleep-only. */
  usedHrv: boolean
}

const SLEEP_TARGET_H = 8
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Compute a readiness signal from sleep entries. `entries` need not be sorted.
 * Uses the most recent night as "last night"; earlier nights form the HRV
 * baseline. Returns null when there are no entries.
 */
export function computeReadiness(
  entries: ReadinessSleepEntry[] | null | undefined,
  opts: { targetSleepH?: number } = {},
): Readiness | null {
  if (!entries || entries.length === 0) return null
  const targetSleepH = opts.targetSleepH ?? SLEEP_TARGET_H
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]

  // Duration: linear 4h → target, capped either end.
  const durScore = clamp01((last.duration_hrs - 4) / (targetSleepH - 4))
  // Quality 1..5 → 0..1.
  const qualScore = clamp01((last.quality - 1) / 4)

  // HRV vs personal baseline (prior nights only, ≥3 with a reading).
  const priorHrv = sorted
    .slice(0, -1)
    .map(e => e.hrv_ms)
    .filter((v): v is number => typeof v === 'number' && v > 0)
  let hrvScore: number | null = null
  let hrvBaseline: number | null = null
  if (typeof last.hrv_ms === 'number' && last.hrv_ms > 0 && priorHrv.length >= 3) {
    hrvBaseline = priorHrv.reduce((a, b) => a + b, 0) / priorHrv.length
    const ratio = last.hrv_ms / hrvBaseline
    // ratio 0.8 → 0, 1.1 → 1 (a ≥10% suppression reads as meaningfully low).
    hrvScore = clamp01((ratio - 0.8) / 0.3)
  }

  const usedHrv = hrvScore !== null
  const score01 = usedHrv
    ? durScore * 0.45 + qualScore * 0.3 + hrvScore! * 0.25
    : durScore * 0.6 + qualScore * 0.4
  const score = Math.round(score01 * 100)
  const level: ReadinessLevel = score >= 70 ? 'ready' : score >= 45 ? 'moderate' : 'low'

  // Factors
  const factors: string[] = []
  const durTag = last.duration_hrs < 6 ? 'short' : last.duration_hrs >= 7.5 ? 'good' : 'ok'
  factors.push(`${last.duration_hrs.toFixed(1)}h sleep · ${durTag}`)
  factors.push(`quality ${last.quality}/5`)
  const hrvLow = usedHrv && last.hrv_ms! < hrvBaseline! * 0.9
  if (usedHrv) {
    factors.push(
      `HRV ${last.hrv_ms}ms vs ${Math.round(hrvBaseline!)}ms baseline${hrvLow ? ' · low' : ''}`,
    )
  }

  // Advice — reason-aware.
  const shortSleep = last.duration_hrs < 6.5
  let advice: string
  let headline: string
  if (level === 'ready') {
    headline = 'Ready to train'
    advice = 'Recovered — train as planned and push your top sets.'
  } else if (level === 'moderate') {
    headline = 'Moderate recovery'
    advice = shortSleep
      ? 'Down on sleep — train, but drop a set or cap the top weight if it feels heavy.'
      : 'Train, but keep 1–2 reps in reserve on the heavy work.'
  } else {
    headline = 'Low recovery'
    if (shortSleep && hrvLow) advice = 'Short sleep and suppressed HRV — deload today or take a rest day.'
    else if (hrvLow) advice = 'HRV is well below your baseline — deload or do light technique work.'
    else advice = 'Under-recovered — cut volume, skip the failure sets, prioritise sleep tonight.'
  }

  return { score, level, headline, factors, advice, usedHrv }
}
