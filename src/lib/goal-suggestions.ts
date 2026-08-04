// From-scratch daily calorie + protein goals derived from the user's REAL
// TDEE and bodyweight, not fixed numbers. This is the "set my baseline" pass;
// calorie-target.ts is the "fine-tune from the scale trend" pass. The two are
// complementary: this decides where to start, that decides how to nudge.
//
// Every number here traces to a real input:
//   calories = TDEE ± a surplus/deficit chosen for the goal direction
//   protein  = bodyweight × g/kg (higher for gain/cut, lower for maintain)
// If an input is missing we return zero and a flag rather than inventing a
// plausible-looking figure — see the honesty rules the reviewer enforces.

import type { Direction } from './calorie-target'
import { BODYWEIGHT_TARGET } from '../program'

const KCAL_PER_KG = 7700 // ~kcal to move 1 kg of bodyweight

/**
 * Lean-bulk surplus, derived from the SAME weekly gain band the workout
 * diagnosis uses (progress-diagnosis.ts), so "eat this much" and "you're
 * gaining at the right rate" can never contradict each other. Mid-band
 * ≈ 0.17 kg/wk → ≈ 187 kcal/day → rounded to 200.
 */
export const GAIN_SURPLUS_KCAL =
  Math.round(
    ((BODYWEIGHT_TARGET.weeklyGainKgMin + BODYWEIGHT_TARGET.weeklyGainKgMax) / 2) *
      KCAL_PER_KG / 7 / 50,
  ) * 50

/** ~0.5 kg/wk loss — the standard sustainable cut, matching calorie-target's lose rule. */
export const LOSE_DEFICIT_KCAL = 500

/** Protein grams per kg of bodyweight, per goal. Gain/cut sit in the
 * evidence-backed 1.8–2.2+ band for muscle retention; maintenance can sit a
 * touch lower. The point value is what we suggest; the range is what we show. */
const PROTEIN_G_PER_KG: Record<Direction, { point: number; min: number; max: number }> = {
  gain: { point: 2.0, min: 1.8, max: 2.2 },
  maintain: { point: 1.6, min: 1.6, max: 2.0 },
  lose: { point: 2.2, min: 2.0, max: 2.4 },
}

export interface GoalSuggestion {
  /** Suggested daily calorie target (0 when TDEE is unknown). */
  calories: number
  /** Signed surplus/deficit vs TDEE (0 when TDEE is unknown or maintaining). */
  calorieDelta: number
  /** Suggested daily protein in grams (0 when bodyweight is unknown). */
  protein: number
  /** [min, max] protein band in grams for the chosen direction. */
  proteinRange: [number, number]
  /** The g/kg multiplier behind the point value — surfaced so the UI can show the math. */
  proteinPerKg: number
  /** False when TDEE was missing/invalid, so the UI can hide the calorie row. */
  hasTdee: boolean
  /** False when bodyweight was missing/invalid, so the UI can hide the protein row. */
  hasWeight: boolean
}

function validPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * Is a weight change good, bad, or neutral GIVEN the goal direction? A bulker
 * gaining is winning; a cutter gaining is off-track. The old Stats card hard-
 * coded "loss = green, gain = orange", which is dishonest for someone whose
 * whole aim is muscle gain. `deadbandKg` keeps tiny scale noise neutral.
 */
export function weightProgressTone(
  deltaKg: number,
  direction: Direction,
  deadbandKg = 0.1,
): 'good' | 'bad' | 'neutral' {
  if (!Number.isFinite(deltaKg) || Math.abs(deltaKg) <= deadbandKg) return 'neutral'
  if (direction === 'maintain') return 'neutral'
  const gaining = deltaKg > 0
  const wantGain = direction === 'gain'
  return gaining === wantGain ? 'good' : 'bad'
}

export function suggestGoals(tdee: number, weightKg: number, direction: Direction): GoalSuggestion {
  const hasTdee = validPositive(tdee)
  const hasWeight = validPositive(weightKg)

  const calorieDelta = !hasTdee
    ? 0
    : direction === 'gain'
      ? GAIN_SURPLUS_KCAL
      : direction === 'lose'
        ? -LOSE_DEFICIT_KCAL
        : 0
  const calories = hasTdee ? Math.round((tdee + calorieDelta) / 50) * 50 : 0

  const pk = PROTEIN_G_PER_KG[direction]
  const protein = hasWeight ? Math.round(weightKg * pk.point) : 0
  const proteinRange: [number, number] = hasWeight
    ? [Math.round(weightKg * pk.min), Math.round(weightKg * pk.max)]
    : [0, 0]

  return {
    calories,
    calorieDelta,
    protein,
    proteinRange,
    proteinPerKg: pk.point,
    hasTdee,
    hasWeight,
  }
}
