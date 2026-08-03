// The weight / reps / rest decision engine.
//
// WEIGHT comes from the written progression rules ALONE (workout-progression),
// snapped to a real notch on the real machine. No diet multiplier, no fatigue
// multiplier, no sleep multiplier. If you earned the jump, you get the jump.
// Silently shaving a few percent off a weight you earned is how an app loses
// trust - the number stops matching the room and you stop opening it.
//
// REST is where the soft signals live. Adjusting rest is reversible and
// obvious; adjusting weight is neither.

import {
  predictNextWeight, parseRepRange,
  type SetSummary, type PredictResult,
} from './workout-progression'
import {
  resolveEquipment, snapToStack, nextUpWeight, nextDownWeight, genericIncrement,
  type StackSpec,
} from './gym-equipment'

export interface SessionContext {
  positionInSession: number
  totalExercises: number
  sessionVolumeSoFar: number
  avgSessionVolume?: number
}

export interface DecisionInput {
  exerciseName: string
  prevBest?: { weight_kg: number; reps: number } | null
  /** Sets from the most recent session with this exercise. */
  prevSets?: SetSummary[]
  /** Sets from the session before that - two-session stall detection. */
  priorSets?: SetSummary[]
  repRange?: string | null
  programRestSeconds?: number
  /** RIR on the PREVIOUS SET of the CURRENT session - drives rest only. */
  lastSetRIR?: number | null
  /** RIR on the last set of the PREVIOUS SESSION - drives progression. */
  lastSessionRIR?: number | null
  /** Days since this exercise was last trained - drives the layoff rule. */
  daysSinceLast?: number | null
  /** Seed is an unverified guess - allows an aggressive recalibration jump. */
  recalibrating?: boolean
  sleepHours?: number | null
  session: SessionContext
  isFirstSet?: boolean
}

export interface ModifierBreakdown {
  sleep: number
  load: number
  rir: number
  position: number
}

export interface DecisionResult {
  weight_kg: number | undefined
  weightDown: number | undefined
  weightUp: number | undefined
  repsTarget: number | undefined
  restSeconds: number
  weightSource: 'manual' | 'learned' | 'seed' | 'generic' | 'none'
  rationale: PredictResult['rationale']
  /** WHY this weight - the progression rationale only. Kept apart from
otes,
   * which also carries rest-modifier chatter like 'First exercise - warm-up
   * rest'. Showing notes[0] as the reason surfaced a rest note whenever a lift
   * had no history and therefore no progression note. */
  reasonNote?: string
  notes: string[]
  modifiers: ModifierBreakdown
}

// -- Rest modifiers -------------------------------------------------------

export function sleepModifier(hours: number | null | undefined): { mult: number; note?: string } {
  if (hours == null) return { mult: 1.0 }
  if (hours >= 7) return { mult: 1.0 }
  if (hours >= 6) return { mult: 1.05, note: 'Slept ' + hours.toFixed(1) + 'h - a little more rest' }
  return { mult: 1.10, note: 'Slept ' + hours.toFixed(1) + 'h - take the extra rest' }
}

/** Heavier % of est-1RM -> longer rest. */
export function loadRestModifier(weight: number | undefined, prevBest?: { weight_kg: number; reps: number } | null): { mult: number; note?: string } {
  if (!weight || !prevBest) return { mult: 1.0 }
  const est1RM = prevBest.weight_kg * (1 + prevBest.reps / 30)
  if (est1RM <= 0) return { mult: 1.0 }
  const pct = weight / est1RM
  if (pct >= 0.85) return { mult: 1.20, note: 'Heavy set - longer rest' }
  if (pct >= 0.65) return { mult: 1.00 }
  return { mult: 0.85, note: 'Lighter set - short rest' }
}

export function rirRestModifier(rir: number | null | undefined): { mult: number; note?: string } {
  if (rir == null) return { mult: 1.0 }
  if (rir <= 1) return { mult: 1.15, note: 'Last set near failure - more rest' }
  if (rir >= 3) return { mult: 0.85, note: 'Last set easy - less rest' }
  return { mult: 1.0 }
}

export function positionRestModifier(s: SessionContext): { mult: number; note?: string } {
  const pos = s.positionInSession
  const total = Math.max(1, s.totalExercises)
  if (pos === 0) return { mult: 1.10, note: 'First exercise - warm-up rest' }
  if (pos / total >= 0.75) return { mult: 0.85, note: 'Final stretch - push through' }
  return { mult: 1.0 }
}

// -- Main entry point -----------------------------------------------------

export function decideNextSet(input: DecisionInput): DecisionResult {
  const equipment = resolveEquipment(input.exerciseName)

  // Ask the catalog what the next real notch up is, so the 10% rule can be
  // evaluated against the machine rather than an imaginary 1.25kg plate.
  const baseline =
    input.prevBest?.weight_kg ??
    input.prevSets?.find(s => typeof s.weight_kg === 'number')?.weight_kg ??
    undefined
  let nextStackUp: number | undefined
  if (baseline !== undefined) {
    nextStackUp = equipment.effectiveStack
      ? nextUpWeight(equipment.effectiveStack, baseline)
      : Math.round((baseline + genericIncrement(baseline)) * 4) / 4
  }

  const base = predictNextWeight({
    prevBest: input.prevBest,
    prevSets: input.prevSets,
    priorSets: input.priorSets,
    repRange: input.repRange,
    lastSessionRIR: input.lastSessionRIR,
    daysSinceLast: input.daysSinceLast,
    recalibrating: input.recalibrating,
    nextStackUp,
  })

  const notes: string[] = []
  if (base.note) notes.push(base.note)

  // Snap the rule's answer to a weight that physically exists.
  let snapped: number | undefined
  let weightDown: number | undefined
  let weightUp: number | undefined
  if (base.weight_kg !== undefined) {
    if (equipment.effectiveStack) {
      snapped = snapToStack(equipment.effectiveStack, base.weight_kg)
      // Coarse-stack deload guard: a 10-15% backoff on a 15lb-step machine
      // often rounds back UP to the weight you were trying to leave (28.8kg
      // snaps to 32). A deload must actually go DOWN — floor to the next real
      // notch below the baseline so "lighter" means lighter.
      const isDeload = base.rationale === 'deload-layoff' || base.rationale === 'deload-stalled'
      if (isDeload && baseline !== undefined && snapped >= baseline) {
        snapped = nextDownWeight(equipment.effectiveStack, baseline)
      }
      weightDown = nextDownWeight(equipment.effectiveStack, snapped)
      weightUp = nextUpWeight(equipment.effectiveStack, snapped)
    } else {
      snapped = Math.round(base.weight_kg * 4) / 4
      const inc = genericIncrement(snapped)
      weightDown = Math.max(0, Math.round((snapped - inc) * 4) / 4)
      weightUp = Math.round((snapped + inc) * 4) / 4
    }
  }

  const baseRest = input.programRestSeconds ?? defaultRestForRange(input.repRange)
  const modSleep = sleepModifier(input.sleepHours)
  const modLoad = loadRestModifier(snapped, input.prevBest)
  const modRIR = rirRestModifier(input.lastSetRIR)
  const modPos = positionRestModifier(input.session)
  const restRaw = baseRest * modLoad.mult * modRIR.mult * modPos.mult * modSleep.mult
  const restSeconds = Math.max(20, Math.round(restRaw / 5) * 5)

  if (modLoad.note) notes.push(modLoad.note)
  if (modRIR.note) notes.push(modRIR.note)
  if (modPos.note) notes.push(modPos.note)
  if (modSleep.note) notes.push(modSleep.note)

  return {
    weight_kg: snapped, weightDown, weightUp,
    repsTarget: base.reps, restSeconds, reasonNote: base.note,
    weightSource: equipment.source, rationale: base.rationale, notes,
    modifiers: { sleep: modSleep.mult, load: modLoad.mult, rir: modRIR.mult, position: modPos.mult },
  }
}

function defaultRestForRange(repRange?: string | null): number {
  const r = parseRepRange(repRange)
  if (!r) return 90
  if (r.max <= 6) return 180
  if (r.max <= 12) return 90
  return 60
}

export type { StackSpec }