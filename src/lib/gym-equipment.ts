// Gym equipment catalog — Brody's gym (The Gym Group, Paddington).
//
// Hybrid model:
//   1. SEED — pre-seeded standard kit. Most Gym Group sites run Life Fitness
//      Insignia/Optima stacks (5-100kg in 5kg) + Hammer Strength plate-loaded
//      + dumbbells 2.5-50kg by 2.5kg + Olympic plates 1.25/2.5/5/10/15/20/25.
//   2. LEARNED — observed weights from Brody's own logs refine increments
//      and bounds for each exercise (per-machine drift from the seed).
//   3. MANUAL — entries added via the in-gym chat ("there's a hack squat
//      here") that the seed didn't know about.
//
// Lookup precedence: manual > learned > seed > generic fallback.

import type { WorkoutData } from '../api/client'

export type EquipmentType =
  | 'stack'         // selectorised pin stack (most cable + iso machines)
  | 'plate-loaded'  // hammer strength, free-weight leg press
  | 'dumbbell'      // pair from rack
  | 'barbell'       // bar + plates
  | 'cable'         // cable column with smaller stack
  | 'bodyweight'    // pull-ups, dips — weight optional
  | 'machine-fixed' // fixed-resistance (rare)

export interface StackSpec {
  /** Lightest selectable weight (kg). */
  min: number
  /** Heaviest selectable weight (kg). */
  max: number
  /** Increment between selections. Most Life Fitness stacks are 5kg, some
   * cable columns 2.5kg, dumbbells 2.5kg up to 30 then 5kg. Use null when
   * non-uniform — then `values` is authoritative. */
  step: number
  /** Optional explicit list of valid values (overrides step when present).
   * Used for non-uniform stacks: dumbbells often 2.5,5,7.5,10,12.5,15,17.5,
   * 20,22.5,25,27.5,30 then 32.5,35,37.5,40,42.5,45,47.5,50. */
  values?: number[]
  /** Some stacks have a "+1.25kg" or "+2.5kg" magnet add-on for half-stops.
   * When present we expose those as valid weights too. */
  addOns?: number[]
}

export interface Equipment {
  id: string
  /** Display name — matches what the program / user types. */
  name: string
  type: EquipmentType
  /** Canonical names this equipment also covers (e.g. "Lat Pulldown" also
   * matches "Cable Lat Pulldown"). Lowercase, partial-match basis. */
  aliases?: string[]
  stack?: StackSpec
  /** Where this entry came from. Used to label the "next up" button source. */
  source: 'seed' | 'learned' | 'manual'
  notes?: string
}

// ── Stack specs ──────────────────────────────────────────────────────────

const LF_STACK_5KG: StackSpec = { min: 5, max: 100, step: 5, addOns: [1.25, 2.5] }
const LF_STACK_5KG_HEAVY: StackSpec = { min: 5, max: 130, step: 5, addOns: [1.25, 2.5] }
const LF_CABLE_STACK_25: StackSpec = { min: 2.5, max: 80, step: 2.5 }
// Pin-loaded ab/glute machines often start at 2.5 and step in 2.5 up to 50
const LF_ISO_STACK_25: StackSpec = { min: 2.5, max: 80, step: 2.5 }

const DUMBBELL_VALUES: number[] = (() => {
  const v: number[] = []
  for (let kg = 2.5; kg <= 30; kg += 2.5) v.push(kg)
  for (let kg = 32.5; kg <= 50; kg += 2.5) v.push(kg)
  return v
})()
const DUMBBELL_STACK: StackSpec = {
  min: 2.5, max: 50, step: 2.5, values: DUMBBELL_VALUES,
}

// Olympic plates — barbell loads in pairs. We expose increments of 1.25kg
// (one 1.25 plate per side) since that's the smallest realistic add. The
// barbell itself is 20kg.
const BARBELL_STACK: StackSpec = { min: 20, max: 200, step: 1.25 }
// EZ / preacher bar — 7-10kg. Treat as 10kg base, 1.25kg increments.
const EZ_BAR_STACK: StackSpec = { min: 10, max: 60, step: 1.25 }

// ── Seed catalog: The Gym Group Paddington kit ───────────────────────────
// This is a *generous* seed — it covers everything in PROGRAM[*] plus
// common machines Brody might encounter. Misses get added via chat.

export const SEED_PADDINGTON: Equipment[] = [
  // Free weights
  { id: 'dumbbells', name: 'Dumbbell', type: 'dumbbell', stack: DUMBBELL_STACK, source: 'seed',
    aliases: ['dumbbell', 'db', 'incline dumbbell', 'flat dumbbell', 'seated dumbbell'] },
  { id: 'barbell', name: 'Barbell', type: 'barbell', stack: BARBELL_STACK, source: 'seed',
    aliases: ['barbell', 'olympic bar', 'squat', 'deadlift', 'bench press (barbell)', 'overhead press (barbell)'] },
  { id: 'ez-bar', name: 'EZ Bar', type: 'barbell', stack: EZ_BAR_STACK, source: 'seed',
    aliases: ['ez bar', 'ez curl', 'preacher curl'] },

  // Hammer Strength / plate-loaded
  { id: 'leg-press', name: 'Leg Press', type: 'plate-loaded',
    stack: { min: 0, max: 400, step: 1.25 }, source: 'seed',
    aliases: ['leg press', 'horizontal leg press', '45 leg press'],
    notes: 'Plate-loaded sled. Sled itself ~30-50kg unloaded depending on machine.' },
  { id: 'hammer-row', name: 'Hammer Row', type: 'plate-loaded',
    stack: { min: 0, max: 200, step: 1.25 }, source: 'seed',
    aliases: ['hammer strength row', 'iso row'] },
  { id: 'hack-squat', name: 'Hack Squat', type: 'plate-loaded',
    stack: { min: 0, max: 250, step: 1.25 }, source: 'seed',
    aliases: ['hack squat'] },

  // Selectorised stacks — Life Fitness Insignia
  { id: 'lat-pulldown', name: 'Lat Pulldown', type: 'stack', stack: LF_STACK_5KG_HEAVY, source: 'seed',
    aliases: ['lat pulldown', 'lat pull down', 'pulldown'] },
  { id: 'seated-row', name: 'Seated Cable Row', type: 'stack', stack: LF_STACK_5KG_HEAVY, source: 'seed',
    aliases: ['seated row', 'seated cable row', 'cable row', 'low row'] },
  { id: 'chest-press-machine', name: 'Flat Machine Chest Press', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['chest press', 'flat machine chest press', 'machine chest press', 'iso chest press'] },
  { id: 'incline-press-machine', name: 'Incline Machine Press', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['incline machine press', 'incline chest press machine'] },
  { id: 'shoulder-press-machine', name: 'Shoulder Press (machine)', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['shoulder press machine', 'machine shoulder press', 'overhead press machine'] },
  { id: 'pec-deck', name: 'Pec Deck', type: 'stack', stack: LF_ISO_STACK_25, source: 'seed',
    aliases: ['pec deck', 'pec fly', 'chest fly machine'] },
  { id: 'rear-delt-machine', name: 'Rear Delt Fly (machine)', type: 'stack', stack: LF_ISO_STACK_25, source: 'seed',
    aliases: ['rear delt fly', 'rear delt machine', 'reverse pec deck'] },
  { id: 'leg-extension', name: 'Leg Extension', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['leg extension', 'quad extension'] },
  { id: 'leg-curl', name: 'Leg Curl', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['leg curl', 'lying leg curl', 'seated leg curl', 'hamstring curl'] },
  { id: 'calf-raise-machine', name: 'Standing Calf Raise (machine)', type: 'stack', stack: LF_STACK_5KG_HEAVY, source: 'seed',
    aliases: ['standing calf raise', 'calf raise machine', 'seated calf raise'] },
  { id: 'glute-trainer', name: 'Glute Trainer', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['glute trainer', 'glute kickback machine', 'glute press'] },
  { id: 'ab-crunch-machine', name: 'Abdominal Crunch (machine)', type: 'stack', stack: LF_ISO_STACK_25, source: 'seed',
    aliases: ['ab crunch', 'abdominal crunch', 'crunch machine'] },
  { id: 'assisted-pullup', name: 'Assisted Pull-Up', type: 'stack', stack: LF_STACK_5KG, source: 'seed',
    aliases: ['assisted pull-up', 'assisted pullup', 'gravitron'],
    notes: 'Counterweight assists the user — heavier number means more help (less BW).' },

  // Cables
  { id: 'cable-tricep', name: 'Cable Triceps Pushdown', type: 'cable', stack: LF_CABLE_STACK_25, source: 'seed',
    aliases: ['cable tricep pushdown', 'tricep pushdown', 'rope pushdown', 'cable triceps extension'] },
  { id: 'cable-curl', name: 'Cable Curl', type: 'cable', stack: LF_CABLE_STACK_25, source: 'seed',
    aliases: ['cable curl', 'cable bicep curl'] },
  { id: 'cable-crunch', name: 'Cable Crunch', type: 'cable', stack: LF_CABLE_STACK_25, source: 'seed',
    aliases: ['cable crunch', 'kneeling cable crunch'] },
  { id: 'cable-glute-kickback', name: 'Cable Glute-Ham Kickback', type: 'cable', stack: LF_CABLE_STACK_25, source: 'seed',
    aliases: ['cable glute kickback', 'cable kickback'] },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', type: 'cable', stack: LF_CABLE_STACK_25, source: 'seed',
    aliases: ['cable lateral raise', 'cable lat raise'] },

  // Bodyweight
  { id: 'pullup', name: 'Pull-Up', type: 'bodyweight', source: 'seed',
    aliases: ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup'] },
  { id: 'dip', name: 'Dip', type: 'bodyweight', source: 'seed',
    aliases: ['dip', 'parallel bar dip'] },
  { id: 'hanging-knee-raise', name: 'Hanging Knee Raises', type: 'bodyweight', source: 'seed',
    aliases: ['hanging knee raise', 'hanging leg raise', "captain's chair"] },
  { id: 'plank', name: 'Plank', type: 'bodyweight', source: 'seed',
    aliases: ['plank', 'side plank'] },
]

// ── Lookup ────────────────────────────────────────────────────────────────

const LEARNED_KEY = 'gym_catalog_learned_v1'
const MANUAL_KEY = 'gym_catalog_manual_v1'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
function writeJSON(key: string, value: unknown) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* quota — silently drop, the catalog is best-effort */ }
}

export function getManualEquipment(): Equipment[] {
  return readJSON<Equipment[]>(MANUAL_KEY, [])
}
export function addManualEquipment(eq: Omit<Equipment, 'source'>) {
  const list = getManualEquipment()
  const next: Equipment = { ...eq, source: 'manual' }
  // Replace by id if already present.
  const idx = list.findIndex(e => e.id === eq.id)
  if (idx >= 0) list[idx] = next
  else list.push(next)
  writeJSON(MANUAL_KEY, list)
  return next
}

export interface LearnedEntry {
  exerciseName: string
  observedWeights: number[]   // distinct weights ever logged
  inferredStep?: number       // smallest non-zero gap
  inferredMin?: number
  inferredMax?: number
  /** When we don't have a seed match this gets used as the equipment. */
  type?: EquipmentType
}

export function getLearnedCatalog(): Record<string, LearnedEntry> {
  return readJSON<Record<string, LearnedEntry>>(LEARNED_KEY, {})
}

/**
 * Walk the workout history and infer per-exercise stack characteristics from
 * the weights actually logged. Smallest gap between distinct weights becomes
 * the inferred step. Min/max are factual.
 *
 * Idempotent — overwrite the entire learned blob each call. Cheap.
 */
export function learnFromLogs(workouts: WorkoutData[]): Record<string, LearnedEntry> {
  const byEx: Record<string, Set<number>> = {}
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const set = byEx[ex.name] ?? (byEx[ex.name] = new Set())
      for (const s of ex.sets) {
        if (typeof s.weight_kg === 'number' && s.weight_kg > 0) set.add(s.weight_kg)
      }
    }
  }
  const out: Record<string, LearnedEntry> = {}
  for (const [name, set] of Object.entries(byEx)) {
    const sorted = Array.from(set).sort((a, b) => a - b)
    if (sorted.length === 0) continue
    let step: number | undefined
    if (sorted.length >= 2) {
      let smallest = Infinity
      for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i] - sorted[i - 1]
        if (d > 0 && d < smallest) smallest = d
      }
      step = smallest === Infinity ? undefined : Math.round(smallest * 4) / 4
    }
    out[name] = {
      exerciseName: name,
      observedWeights: sorted,
      inferredStep: step,
      inferredMin: sorted[0],
      inferredMax: sorted[sorted.length - 1],
    }
  }
  writeJSON(LEARNED_KEY, out)
  return out
}

/** Match an exercise name to seed equipment by name + alias. Lowercase, includes-based. */
export function findSeedEquipment(exerciseName: string): Equipment | undefined {
  const n = exerciseName.toLowerCase()
  // 1. Exact name match
  const exact = SEED_PADDINGTON.find(e => e.name.toLowerCase() === n)
  if (exact) return exact
  // 2. Alias substring match
  return SEED_PADDINGTON.find(e =>
    e.aliases?.some(a => n.includes(a.toLowerCase())),
  )
}

export interface ResolvedEquipment {
  equipment: Equipment | null
  /** Effective stack to use for next-up/next-down. May come from learned data
   * even when equipment is null (eg new machine added by chat with no seed). */
  effectiveStack: StackSpec | null
  source: 'manual' | 'learned' | 'seed' | 'generic' | 'none'
}

/**
 * Resolve the equipment + effective stack for an exercise name, using
 * precedence: manual > learned-refined seed > seed > learned-only > generic.
 */
export function resolveEquipment(
  exerciseName: string,
  learned: Record<string, LearnedEntry> = getLearnedCatalog(),
  manual: Equipment[] = getManualEquipment(),
): ResolvedEquipment {
  const n = exerciseName.toLowerCase()

  // Manual entry by name or alias
  const m = manual.find(e =>
    e.name.toLowerCase() === n ||
    e.aliases?.some(a => n.includes(a.toLowerCase())),
  )
  if (m) return { equipment: m, effectiveStack: m.stack ?? null, source: 'manual' }

  const seed = findSeedEquipment(exerciseName)
  const learnedEntry = learned[exerciseName]

  if (seed && learnedEntry?.inferredStep && learnedEntry.inferredStep > 0) {
    // Refine seed bounds with observed data — keep step from seed (more reliable
    // than a 1-or-2-sample inference) but widen min/max to accommodate observations.
    const stack = seed.stack
    if (stack) {
      const refined: StackSpec = {
        ...stack,
        min: Math.min(stack.min, learnedEntry.inferredMin ?? stack.min),
        max: Math.max(stack.max, learnedEntry.inferredMax ?? stack.max),
      }
      return { equipment: seed, effectiveStack: refined, source: 'seed' }
    }
  }
  if (seed) return { equipment: seed, effectiveStack: seed.stack ?? null, source: 'seed' }
  if (learnedEntry && learnedEntry.observedWeights.length > 0) {
    return {
      equipment: null,
      effectiveStack: {
        min: learnedEntry.inferredMin ?? learnedEntry.observedWeights[0],
        max: learnedEntry.inferredMax ?? learnedEntry.observedWeights[learnedEntry.observedWeights.length - 1],
        step: learnedEntry.inferredStep ?? 2.5,
        values: learnedEntry.observedWeights.length >= 3 ? learnedEntry.observedWeights : undefined,
      },
      source: 'learned',
    }
  }
  return { equipment: null, effectiveStack: null, source: 'none' }
}

// ── Snapping & next-up/next-down ─────────────────────────────────────────

/**
 * Build the full sorted list of valid weights for a stack.
 * For uniform-step stacks: enumerate min..max by step.
 * For value-list stacks: use values directly.
 * Add-ons (magnet half-stops): inserted between every adjacent pair.
 */
export function enumerateStack(stack: StackSpec): number[] {
  const base: number[] = []
  if (stack.values && stack.values.length > 0) {
    base.push(...stack.values)
  } else {
    for (let kg = stack.min; kg <= stack.max + 1e-6; kg += stack.step) {
      base.push(Math.round(kg * 4) / 4)
    }
  }
  if (!stack.addOns || stack.addOns.length === 0) return base
  // For each pair of adjacent base values, insert base+addOn for each addOn
  // value (typically 1.25, 2.5).
  const out = new Set<number>(base)
  for (let i = 0; i < base.length - 1; i++) {
    for (const ao of stack.addOns) {
      const v = Math.round((base[i] + ao) * 4) / 4
      if (v < base[i + 1]) out.add(v)
    }
  }
  return Array.from(out).sort((a, b) => a - b)
}

/** Snap to nearest valid stack value. */
export function snapToStack(stack: StackSpec, kg: number): number {
  if (kg <= stack.min) return stack.min
  if (kg >= stack.max) return stack.max
  const list = enumerateStack(stack)
  let best = list[0]
  let bestD = Math.abs(list[0] - kg)
  for (const v of list) {
    const d = Math.abs(v - kg)
    if (d < bestD) { best = v; bestD = d }
  }
  return best
}

/** Next selectable weight strictly heavier than `kg`. Returns max if at top. */
export function nextUpWeight(stack: StackSpec, kg: number): number {
  const list = enumerateStack(stack)
  for (const v of list) if (v > kg + 1e-6) return v
  return list[list.length - 1] ?? kg
}

/** Next selectable weight strictly lighter than `kg`. Returns min if at bottom. */
export function nextDownWeight(stack: StackSpec, kg: number): number {
  const list = enumerateStack(stack)
  for (let i = list.length - 1; i >= 0; i--) if (list[i] < kg - 1e-6) return list[i]
  return list[0] ?? kg
}

/**
 * Generic fallback when we have no equipment data at all. Mirrors the existing
 * predictNextWeight rule: <40kg → 1.25 step, ≥40kg → 2.5 step.
 */
export function genericIncrement(currentKg: number): number {
  return currentKg >= 40 ? 2.5 : 1.25
}
