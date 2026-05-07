// The synced weight / reps / rest decision engine.
//
// One pure function. Inputs: signal bundle. Outputs: { weight_kg, repsTarget,
// restSeconds, rationale }. Every input maps to a documented modifier so the
// behaviour is explainable on the UI ("rest +20s · ate short last 24h").
//
// Stays decoupled from React — testable in isolation.

import {
  predictNextWeight,
  parseRepRange,
  type SetSummary,
  type PredictResult,
} from './workout-progression'
import {
  resolveEquipment, snapToStack, nextUpWeight, nextDownWeight, genericIncrement,
  type StackSpec,
} from './gym-equipment'

// ── Inputs ───────────────────────────────────────────────────────────────

export interface DietState {
  /** Did yesterday/last-logged hit ≥95% of both kcal & protein. */
  properlyEating: boolean
  /** Rolling 3-day avg kcal as % of target (0..1+). undefined when unknown. */
  threeDayKcalPct?: number
  /** Last logged day kcal as % of target (0..1+). */
  lastDayKcalPct?: number
}

export interface SessionContext {
  /** Position of current exercise in the session, 0-indexed. */
  positionInSession: number
  /** Total exercises in the session (excluding skipped). */
  totalExercises: number
  /** Sum of weight × reps for completed sets so far this session. */
  sessionVolumeSoFar: number
  /** Average session volume from recent comparable sessions. Drives a fatigue
   * tax once we cross 80% of average. */
  avgSessionVolume?: number
}

export interface DecisionInput {
  exerciseName: string
  prevBest?: { weight_kg: number; reps: number } | null
  prevSets?: SetSummary[]
  /** Program rep range, e.g. "8-12". */
  repRange?: string | null
  /** Program prescribed rest (seconds). Used as the base rest. */
  programRestSeconds?: number
  /** Reps in reserve achieved on the previous set (if any). */
  lastSetRIR?: number | null
  /** Hours of sleep last night (optional). */
  sleepHours?: number | null
  diet: DietState
  session: SessionContext
  /** True when this is the warm-up / first working set (not a rest-recovered set). */
  isFirstSet?: boolean
}

// ── Outputs ──────────────────────────────────────────────────────────────

export interface ModifierBreakdown {
  diet: number
  fatigue: number
  sleep: number
  load: number
  rir: number
  position: number
}

export interface DecisionResult {
  weight_kg: number | undefined
  /** The next-lighter and next-heavier valid stack values, for the +/- buttons. */
  weightDown: number | undefined
  weightUp: number | undefined
  repsTarget: number | undefined
  restSeconds: number
  /** Stack source — drives the tiny "(seed/learned/manual)" label in the UI. */
  weightSource: 'manual' | 'learned' | 'seed' | 'generic' | 'none'
  rationale: PredictResult['rationale']
  /** Human-readable reason strings, ordered by impact. */
  notes: string[]
  modifiers: ModifierBreakdown
}

// ── Modifiers ────────────────────────────────────────────────────────────

export function dietModifier(diet: DietState): { mult: number; note?: string } {
  const last = diet.lastDayKcalPct ?? (diet.properlyEating ? 1 : 0.7)
  const three = diet.threeDayKcalPct ?? last
  // 3-day deficit beats single-day signal — chronic underfueling kills progression.
  if (three < 0.90) return { mult: 0.92, note: '3-day kcal deficit · holding back' }
  if (last >= 0.95 && diet.properlyEating) return { mult: 1.00 }
  if (last >= 0.80) return { mult: 0.985, note: 'Light undershoot yesterday' }
  return { mult: 0.95, note: 'Big undershoot yesterday · pulling back' }
}

export function fatigueModifier(s: SessionContext): { mult: number; note?: string } {
  const pos = s.positionInSession
  const total = Math.max(1, s.totalExercises)
  const positionPct = pos / total
  let mult = 1.0
  if (positionPct >= 0.66) mult *= 0.95
  else if (positionPct >= 0.4) mult *= 0.97
  // Volume-based fatigue tax — kicks in once we've done 80%+ of an avg session.
  if (s.avgSessionVolume && s.avgSessionVolume > 0) {
    const ratio = s.sessionVolumeSoFar / s.avgSessionVolume
    if (ratio > 0.8) mult *= 0.97
  }
  const note = mult < 0.99 ? `Late-session fatigue · ${Math.round((1 - mult) * 100)}% off` : undefined
  return { mult: Math.round(mult * 1000) / 1000, note }
}

export function sleepModifier(hours: number | null | undefined): { mult: number; note?: string } {
  if (hours == null) return { mult: 1.0 }
  if (hours >= 7) return { mult: 1.0 }
  if (hours >= 6) return { mult: 0.98, note: `Slept ${hours.toFixed(1)}h` }
  return { mult: 0.95, note: `Slept ${hours.toFixed(1)}h · light day` }
}

/** Load modifier for *rest*. Heavier % of est-1RM → longer rest. */
export function loadRestModifier(weight: number | undefined, prevBest?: { weight_kg: number; reps: number } | null): { mult: number; note?: string } {
  if (!weight || !prevBest) return { mult: 1.0 }
  // Epley est 1RM = w × (1 + reps/30). Treat current weight as % of that.
  const est1RM = prevBest.weight_kg * (1 + prevBest.reps / 30)
  if (est1RM <= 0) return { mult: 1.0 }
  const pct = weight / est1RM
  if (pct >= 0.85) return { mult: 1.20, note: 'Heavy set · longer rest' }
  if (pct >= 0.65) return { mult: 1.00 }
  return { mult: 0.85, note: 'Lighter set · short rest' }
}

export function rirRestModifier(rir: number | null | undefined): { mult: number; note?: string } {
  if (rir == null) return { mult: 1.0 }
  if (rir <= 1) return { mult: 1.15, note: 'Last set near failure · +rest' }
  if (rir >= 3) return { mult: 0.85, note: 'Last set easy · less rest' }
  return { mult: 1.0 }
}

export function positionRestModifier(s: SessionContext): { mult: number; note?: string } {
  const pos = s.positionInSession
  const total = Math.max(1, s.totalExercises)
  const positionPct = pos / total
  if (pos === 0) return { mult: 1.10, note: 'First exercise · warm-up rest' }
  if (positionPct >= 0.75) return { mult: 0.85, note: 'Final stretch · push through' }
  return { mult: 1.0 }
}

// ── Main entry point ─────────────────────────────────────────────────────

export function decideNextSet(input: DecisionInput): DecisionResult {
  // 1. Baseline weight + reps from existing progression rule.
  const base = predictNextWeight({
    prevBest: input.prevBest,
    prevSets: input.prevSets,
    repRange: input.repRange,
    properlyEating: input.diet.properlyEating,
  })

  const modDiet = dietModifier(input.diet)
  const modFatigue = fatigueModifier(input.session)
  const modSleep = sleepModifier(input.sleepHours)
  const notes: string[] = []
  if (modDiet.note) notes.push(modDiet.note)
  if (modFatigue.note) notes.push(modFatigue.note)
  if (modSleep.note) notes.push(modSleep.note)

  // 2. Apply combined weight modifier, then snap to nearest catalog increment.
  const equipment = resolveEquipment(input.exerciseName)
  const weightMod = modDiet.mult * modFatigue.mult * modSleep.mult
  const rawWeight = base.weight_kg !== undefined
    ? base.weight_kg * weightMod
    : undefined

  let snapped: number | undefined
  let weightDown: number | undefined
  let weightUp: number | undefined

  if (rawWeight !== undefined) {
    if (equipment.effectiveStack) {
      snapped = snapToStack(equipment.effectiveStack, rawWeight)
      weightDown = nextDownWeight(equipment.effectiveStack, snapped)
      weightUp = nextUpWeight(equipment.effectiveStack, snapped)
    } else {
      // Generic fallback — round to 0.25 and use the legacy 1.25/2.5 rule.
      snapped = Math.round(rawWeight * 4) / 4
      const inc = genericIncrement(snapped)
      weightDown = Math.max(0, Math.round((snapped - inc) * 4) / 4)
      weightUp = Math.round((snapped + inc) * 4) / 4
    }
  }

  // 3. Reps target — straight from the existing predictor.
  const repsTarget = base.reps

  // 4. Rest — base from program × load × rir × diet × position.
  const baseRest = input.programRestSeconds ?? defaultRestForRange(input.repRange)
  const modLoad = loadRestModifier(snapped, input.prevBest)
  const modRIR = rirRestModifier(input.lastSetRIR)
  const modPos = positionRestModifier(input.session)
  // Diet modifier on rest: under-fed → +10%
  const dietRestMult = input.diet.properlyEating ? 1.0 : 1.10
  const restRaw = baseRest * modLoad.mult * modRIR.mult * modPos.mult * dietRestMult
  const restSeconds = Math.max(20, Math.round(restRaw / 5) * 5) // round to 5s

  if (modLoad.note) notes.push(modLoad.note)
  if (modRIR.note) notes.push(modRIR.note)
  if (modPos.note) notes.push(modPos.note)

  return {
    weight_kg: snapped,
    weightDown,
    weightUp,
    repsTarget,
    restSeconds,
    weightSource: equipment.source,
    rationale: base.rationale,
    notes,
    modifiers: {
      diet: modDiet.mult,
      fatigue: modFatigue.mult,
      sleep: modSleep.mult,
      load: modLoad.mult,
      rir: modRIR.mult,
      position: modPos.mult,
    },
  }
}

// Default rest when the program didn't specify — derived from rep range.
function defaultRestForRange(repRange?: string | null): number {
  const r = parseRepRange(repRange)
  if (!r) return 90
  // Strength range (≤6 reps) = 180s; mid (7-12) = 90s; high (13+) = 60s
  if (r.max <= 6) return 180
  if (r.max <= 12) return 90
  return 60
}

// Re-export types we need from the stack module
export type { StackSpec }
