// "Are you actually progressing - and if not, is it food or is it training?"
//
// This is the one diagnostic the written routine asks for: if two lifts stall
// AND bodyweight has been flat for three weeks, the problem is intake, not
// programming. It is deliberately the ONLY place food and training meet.
// Progression itself never reads nutrition - see workout-progression.ts.

import { BODYWEIGHT_TARGET, STALL_DIAGNOSIS } from '../program'

export type WeighIn = { date: string; kg: number }

/** One lift's top working weight per session, newest first. */
export type LiftTrend = { name: string; topWeights: number[] }

/**
 * Weekly bodyweight change from the rolling average of the first and last
 * few entries. Averaging both ends stops a single bloated or dehydrated
 * reading from inventing a trend that is not there.
 */
export function weeklyChangeKg(entries: WeighIn[]): number | null {
  // Drop rows that cannot be reasoned about before doing any maths. The API
  // has been seen storing a time ("09:00") where a date belongs, and an
  // invalid date yields NaN days - which sails straight past a `days < 7`
  // guard, because NaN < 7 is false. One bad row would then render
  // "Gaining NaN lb/week" on screen.
  const clean = entries.filter(e =>
    e != null &&
    Number.isFinite(e.kg) && e.kg > 0 &&
    Number.isFinite(new Date(e.date).getTime()))
  if (clean.length < 2) return null
  const sorted = [...clean].sort((a, b) => a.date.localeCompare(b.date))
  const w = Math.min(BODYWEIGHT_TARGET.averageWindow, Math.floor(sorted.length / 2)) || 1
  const first = sorted.slice(0, w)
  const last = sorted.slice(-w)
  const avg = (xs: WeighIn[]) => xs.reduce((s, e) => s + e.kg, 0) / xs.length
  const days =
    (new Date(last[last.length - 1].date).getTime() - new Date(first[0].date).getTime()) / 86400000
  if (!Number.isFinite(days) || days < 7) return null
  const weekly = ((avg(last) - avg(first)) / days) * 7
  return Number.isFinite(weekly) ? weekly : null
}

/** A lift is stalled when its top weight has not increased across recent sessions. */
export function countStalledLifts(lifts: LiftTrend[], sessions = 3): number {
  let stalled = 0
  for (const l of lifts) {
    const recent = l.topWeights.slice(0, sessions)
    if (recent.length < 2) continue
    const best = Math.max(...recent)
    if (recent[0] < best || recent.every(w => w === recent[0])) stalled++
  }
  return stalled
}

export type Diagnosis = {
  kind: 'ok' | 'eat-more' | 'gaining-fast' | 'need-data'
  headline: string
  detail: string
}

export function diagnoseProgress(entries: WeighIn[], lifts: LiftTrend[]): Diagnosis {
  const weekly = weeklyChangeKg(entries)
  const stalled = countStalledLifts(lifts)

  if (weekly === null) {
    return {
      kind: 'need-data',
      headline: 'Not enough weigh-ins yet',
      detail: 'Weigh in 2-3 times a week, same point in your routine. Three entries and the trend becomes readable.',
    }
  }

  const lb = weekly * 2.2046
  const rounded = Math.abs(lb) < 0.05 ? '0' : lb.toFixed(2)

  if (weekly > BODYWEIGHT_TARGET.weeklyGainKgMax * 1.6) {
    return {
      kind: 'gaining-fast',
      headline: `Gaining ${rounded} lb/week - faster than you need`,
      detail: `Target is ${BODYWEIGHT_TARGET.weeklyGainLbMin}-${BODYWEIGHT_TARGET.weeklyGainLbMax} lb a week. Past that, more of it is fat than muscle. Trim 150-200 kcal a day.`,
    }
  }

  if (weekly < BODYWEIGHT_TARGET.weeklyGainKgMin && stalled >= STALL_DIAGNOSIS.liftsStalled) {
    return {
      kind: 'eat-more',
      headline: 'This is food, not training',
      detail: `${stalled} lifts have stopped moving and bodyweight is flat at ${rounded} lb/week. The programme is fine - add 150-200 kcal a day and hold everything else steady.`,
    }
  }

  if (weekly < BODYWEIGHT_TARGET.weeklyGainKgMin) {
    return {
      kind: 'ok',
      headline: `Bodyweight flat at ${rounded} lb/week`,
      detail: 'Lifts are still climbing, so this is fine for now. If two of them stall while the scale stays put, it is food.',
    }
  }

  if (weekly > BODYWEIGHT_TARGET.weeklyGainKgMax) {
    return {
      kind: 'ok',
      headline: `Gaining ${rounded} lb/week - slightly above target`,
      detail: `Target band is ${BODYWEIGHT_TARGET.weeklyGainLbMin}-${BODYWEIGHT_TARGET.weeklyGainLbMax} lb a week. Not worth changing off a handful of weigh-ins - keep logging and see if it holds.`,
    }
  }

  return {
    kind: 'ok',
    headline: `Gaining ${rounded} lb/week - on target`,
    detail: `Target band is ${BODYWEIGHT_TARGET.weeklyGainLbMin}-${BODYWEIGHT_TARGET.weeklyGainLbMax} lb a week. Keep intake where it is.`,
  }
}