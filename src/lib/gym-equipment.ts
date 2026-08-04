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

// Cable columns at Paddington are IMPERIAL: 5lb plates on a 2.5lb offset.
// Measured session 1 (27 Jul 2026): 3.4 / 5.7 / 7.9 / 14.7 / 17.0 kg are
// exactly 7.5 / 12.5 / 17.5 / 32.5 / 37.5 lb. The previous metric 2.5kg model
// generated weights that do not physically exist on these machines, which is
// why every cable seed was unreachable and had to be walked down by hand.
const LB_TO_KG = 0.45359237
const CABLE_VALUES_LB: number[] = (() => {
  const v: number[] = []
  for (let lb = 2.5; lb <= 102.5; lb += 5) v.push(Math.round(lb * LB_TO_KG * 10) / 10)
  return v
})()
const CABLE_STACK_LB: StackSpec = {
  min: CABLE_VALUES_LB[0],
  max: CABLE_VALUES_LB[CABLE_VALUES_LB.length - 1],
  step: 2.3,
  values: CABLE_VALUES_LB,
}
// The Gym Group Paddington's selectorised stacks are IMPERIAL, shown rounded to
// whole kg — confirmed from Brody's logged notches (session 2026-08-03):
//   Seated Cable Row  = 32 / 39 / 45   → 70 / 85 / 100 lb  (15 lb steps)
//   Rear Delt Fly     = 25 / 32 / 39   → 55 / 70 / 85 lb   (15 lb steps)
//   Calf Raise        = 66             → 145 lb            (15 lb step family)
//   Leg Extension     = 52             → 115 lb            (15 lb step family)
//   Shoulder Press    = 23 / 27 / 32   → 50 / 60 / 70 lb   (10 lb steps)
//   Abdominal Crunch  = 41             → 90 lb             (10 lb step family)
//   Leg Curl          = 36             → 80 lb             (10 lb step family)
// The old metric 5kg / 2.5kg guesses produced weights that don't exist on the
// machine (32.5kg, 36kg) — which is exactly what Brody hit. Model the real
// notches so snap / next-up / next-down land on selectable plates.
function imperialSelectorStack(startLb: number, stepLb: number, endLb: number): StackSpec {
  const values: number[] = []
  for (let lb = startLb; lb <= endLb + 1e-6; lb += stepLb) values.push(Math.round(lb * LB_TO_KG))
  const uniq = Array.from(new Set(values)).sort((a, b) => a - b)
  return { min: uniq[0], max: uniq[uniq.length - 1], step: stepLb === 15 ? 7 : 5, values: uniq }
}
// 15lb family: iso / back / legs — 11,18,25,32,39,45,52,59,66,73,79,86,93,100…
const STACK_15LB: StackSpec = imperialSelectorStack(25, 15, 250)
// 10lb family: pressing / crunch / curl — 9,14,18,23,27,32,36,41,45,50,54,59…
const STACK_10LB: StackSpec = imperialSelectorStack(20, 10, 220)
// Back-compat aliases (names referenced elsewhere) → the real imperial families.
const SHOULDER_PRESS_STACK: StackSpec = STACK_10LB
const AB_CRUNCH_STACK: StackSpec = STACK_10LB
const LF_ISO_STACK_25: StackSpec = STACK_15LB

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
    // 2.5kg steps = one 1.25kg plate per side, the smallest realistic add. The
    // old 1.25 step invented weights like 41.25kg that don't exist on the sled.
    // Self-corrects to Brody's real loads as he logs them.
    stack: { min: 0, max: 400, step: 2.5 }, source: 'seed',
    aliases: ['leg press', 'horizontal leg press', '45 leg press'],
    notes: 'Plate-loaded sled. Sled itself ~30-50kg unloaded depending on machine.' },
  { id: 'hammer-row', name: 'Hammer Row', type: 'plate-loaded',
    stack: { min: 0, max: 200, step: 1.25 }, source: 'seed',
    aliases: ['hammer strength row', 'iso row'] },
  { id: 'hack-squat', name: 'Hack Squat', type: 'plate-loaded',
    stack: { min: 0, max: 250, step: 1.25 }, source: 'seed',
    aliases: ['hack squat'] },

  // Selectorised stacks — Life Fitness Insignia
  { id: 'lat-pulldown', name: 'Lat Pulldown', type: 'stack', stack: STACK_15LB, source: 'seed',
    aliases: ['lat pulldown', 'lat pull down', 'pulldown'] },
  { id: 'seated-row', name: 'Seated Cable Row', type: 'stack', stack: STACK_15LB, source: 'seed',
    aliases: ['seated row', 'seated cable row', 'cable row', 'low row'] },
  { id: 'chest-press-machine', name: 'Flat Machine Chest Press', type: 'stack', stack: STACK_10LB, source: 'seed',
    aliases: ['chest press', 'flat machine chest press', 'machine chest press', 'iso chest press'] },
  { id: 'incline-press-machine', name: 'Incline Machine Press', type: 'stack', stack: STACK_10LB, source: 'seed',
    aliases: ['incline chest press', 'incline machine press', 'incline chest press machine'] },
  { id: 'shoulder-press-machine', name: 'Shoulder Press (machine)', type: 'stack', stack: SHOULDER_PRESS_STACK, source: 'seed',
    aliases: ['shoulder press', 'seated shoulder press', 'shoulder press machine', 'machine shoulder press', 'overhead press machine', 'converging shoulder press', 'converging press'] },
  { id: 'pec-deck', name: 'Pec Deck', type: 'stack', stack: LF_ISO_STACK_25, source: 'seed',
    aliases: ['pec deck', 'pec fly', 'chest fly machine'] },
  { id: 'rear-delt-machine', name: 'Rear Delt Fly (machine)', type: 'stack', stack: LF_ISO_STACK_25, source: 'seed',
    aliases: ['rear delt fly', 'rear delt machine', 'reverse pec deck'] },
  { id: 'leg-extension', name: 'Leg Extension', type: 'stack', stack: STACK_15LB, source: 'seed',
    aliases: ['leg extension', 'quad extension'] },
  { id: 'leg-curl', name: 'Leg Curl', type: 'stack', stack: STACK_10LB, source: 'seed',
    aliases: ['leg curl', 'lying leg curl', 'prone leg curl', 'seated leg curl', 'hamstring curl', 'cable leg curl'] },
  { id: 'calf-raise-machine', name: 'Standing Calf Raise (machine)', type: 'stack', stack: STACK_15LB, source: 'seed',
    aliases: ['standing calf raise', 'calf raise machine', 'seated calf raise'] },
  { id: 'glute-trainer', name: 'Glute Trainer', type: 'stack', stack: STACK_10LB, source: 'seed',
    aliases: ['glute trainer', 'glute kickback machine', 'glute press'] },
  { id: 'ab-crunch-machine', name: 'Abdominal Crunch (machine)', type: 'stack', stack: AB_CRUNCH_STACK, source: 'seed',
    aliases: ['ab crunch', 'abdominal crunch', 'crunch machine'] },
  { id: 'assisted-pullup', name: 'Assisted Pull-Up', type: 'stack', stack: STACK_10LB, source: 'seed',
    aliases: ['assisted pull-up', 'assisted pullup', 'gravitron'],
    notes: 'Counterweight assists the user — heavier number means more help (less BW).' },

  // Cables
  { id: 'cable-tricep', name: 'Cable Triceps Pushdown', type: 'cable', stack: CABLE_STACK_LB, source: 'seed',
    aliases: ['cable tricep pushdown', 'tricep pushdown', 'rope pushdown', 'cable triceps extension'] },
  { id: 'cable-curl', name: 'Cable Curl', type: 'cable', stack: CABLE_STACK_LB, source: 'seed',
    aliases: ['cable curl', 'cable bicep curl'] },
  { id: 'cable-crunch', name: 'Cable Crunch', type: 'cable', stack: STACK_10LB, source: 'seed',
    // Brody's cable crunch runs the 10lb selector family (…36 / 41 / 45…),
    // confirmed 2026-08-04. The generic cable column produced 44.2kg, off-stack.
    aliases: ['cable crunch', 'kneeling cable crunch'] },
  { id: 'cable-glute-kickback', name: 'Cable Glute-Ham Kickback', type: 'cable', stack: CABLE_STACK_LB, source: 'seed',
    aliases: ['cable glute kickback', 'cable kickback'] },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', type: 'cable', stack: CABLE_STACK_LB, source: 'seed',
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
  const raw = exerciseName.toLowerCase()
  // Program names carry qualifiers like "(machine)" / "(plate-loaded)" that
  // aren't in the aliases — strip them so "Seated Shoulder Press (machine)"
  // resolves to its stack instead of falling back to off-stack rounding.
  const n = raw.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const exact = SEED_PADDINGTON.find(e => e.name.toLowerCase() === raw || e.name.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() === n)
  if (exact) return exact
  // Alias substring match against BOTH the raw and paren-stripped name.
  return SEED_PADDINGTON.find(e =>
    e.aliases?.some(a => { const al = a.toLowerCase(); return raw.includes(al) || n.includes(al) }),
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

  if (seed?.stack && learnedEntry?.observedWeights?.length) {
    // Self-correcting notches: union the weights Brody has ACTUALLY selected on
    // this machine into the seed's value list. Even if the seed family is a
    // touch off for a given machine, every weight he's logged becomes a real
    // notch, so snap / +/- land on plates that exist. Fixes the "impossible
    // weight" class (32.5kg, 36kg) permanently as he logs.
    const seedVals = enumerateStack(seed.stack)
    const merged = Array.from(new Set([
      ...seedVals,
      ...learnedEntry.observedWeights.filter(w => w > 0),
    ])).sort((a, b) => a - b)
    const refined: StackSpec = {
      min: merged[0],
      max: merged[merged.length - 1],
      step: seed.stack.step,
      values: merged,
    }
    return { equipment: seed, effectiveStack: refined, source: 'seed' }
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
