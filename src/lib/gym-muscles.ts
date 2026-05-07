// Exercise → muscle group mapping + weekly volume tracking against the
// MEV / MAV / MRV scheme (Mike Israetel / Renaissance Periodization style).
//
// Volume is "effective sets per week per muscle". Each set counts:
//   • 1.0 for a primary muscle
//   • 0.5 for a secondary muscle
// Rolled up into 7-day windows.

import type { WorkoutData } from '../api/client'

export type MuscleGroup =
  | 'chest' | 'back' | 'side-delts' | 'rear-delts' | 'front-delts'
  | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hams' | 'glutes' | 'calves'
  | 'core'

export interface MuscleTags {
  primary: MuscleGroup[]
  secondary: MuscleGroup[]
}

// Pattern table — match exercise name (lowercase substring) → muscles.
// First match wins, so order from most specific to least.
const PATTERNS: { match: string[]; tags: MuscleTags }[] = [
  // Chest
  { match: ['incline dumbbell bench', 'incline machine press', 'incline bench'],
    tags: { primary: ['chest'], secondary: ['front-delts', 'triceps'] } },
  { match: ['flat machine chest press', 'machine chest press', 'flat bench', 'flat dumbbell bench', 'bench press', 'chest press'],
    tags: { primary: ['chest'], secondary: ['front-delts', 'triceps'] } },
  { match: ['pec deck', 'pec fly', 'chest fly', 'cable fly'],
    tags: { primary: ['chest'], secondary: [] } },
  { match: ['dip'],
    tags: { primary: ['chest', 'triceps'], secondary: ['front-delts'] } },

  // Back
  { match: ['lat pulldown', 'pulldown', 'pull-up', 'pullup', 'pull up', 'chin-up', 'chinup', 'assisted pull'],
    tags: { primary: ['back'], secondary: ['biceps', 'rear-delts'] } },
  { match: ['seated cable row', 'seated row', 'cable row', 'low row', 'hammer row', 'iso row', 'machine row'],
    tags: { primary: ['back'], secondary: ['biceps', 'rear-delts'] } },
  { match: ['barbell row', 'bent-over row', 'pendlay row', 't-bar row'],
    tags: { primary: ['back'], secondary: ['biceps', 'rear-delts'] } },
  { match: ['single-arm dumbbell row', 'single arm row', 'dumbbell row'],
    tags: { primary: ['back'], secondary: ['biceps', 'rear-delts'] } },
  { match: ['deadlift', 'rdl', 'romanian deadlift'],
    tags: { primary: ['back', 'hams', 'glutes'], secondary: ['quads', 'forearms'] } },

  // Shoulders
  { match: ['lateral raise', 'lat raise', 'side raise'],
    tags: { primary: ['side-delts'], secondary: [] } },
  { match: ['rear delt fly', 'reverse pec deck', 'rear delt'],
    tags: { primary: ['rear-delts'], secondary: ['back'] } },
  { match: ['shoulder press', 'overhead press', 'ohp', 'military press', 'dumbbell shoulder'],
    tags: { primary: ['front-delts'], secondary: ['side-delts', 'triceps'] } },
  { match: ['front raise'],
    tags: { primary: ['front-delts'], secondary: [] } },

  // Arms
  { match: ['tricep pushdown', 'cable triceps', 'tricep extension', 'overhead tricep', 'skullcrusher'],
    tags: { primary: ['triceps'], secondary: [] } },
  { match: ['hammer curl'],
    tags: { primary: ['biceps', 'forearms'], secondary: [] } },
  { match: ['dumbbell curl', 'bicep curl', 'cable curl', 'preacher curl', 'incline curl', 'ez curl', 'curl'],
    tags: { primary: ['biceps'], secondary: ['forearms'] } },

  // Legs
  { match: ['leg press', 'hack squat'],
    tags: { primary: ['quads', 'glutes'], secondary: ['hams'] } },
  { match: ['squat', 'front squat', 'goblet squat'],
    tags: { primary: ['quads', 'glutes'], secondary: ['hams', 'core'] } },
  { match: ['leg extension', 'quad extension'],
    tags: { primary: ['quads'], secondary: [] } },
  { match: ['leg curl', 'hamstring curl'],
    tags: { primary: ['hams'], secondary: [] } },
  { match: ['glute trainer', 'glute kickback', 'glute press', 'cable glute', 'hip thrust'],
    tags: { primary: ['glutes'], secondary: ['hams'] } },
  { match: ['lunge', 'split squat', 'bulgarian'],
    tags: { primary: ['quads', 'glutes'], secondary: ['hams'] } },
  { match: ['calf raise', 'calf press'],
    tags: { primary: ['calves'], secondary: [] } },

  // Core
  { match: ['cable crunch', 'ab crunch', 'crunch', 'sit-up', 'situp'],
    tags: { primary: ['core'], secondary: [] } },
  { match: ['hanging knee', 'hanging leg', "captain's chair", 'leg raise'],
    tags: { primary: ['core'], secondary: [] } },
  { match: ['plank', 'side plank', 'ab wheel'],
    tags: { primary: ['core'], secondary: [] } },
]

const FALLBACK: MuscleTags = { primary: [], secondary: [] }

export function tagExercise(exerciseName: string): MuscleTags {
  const n = exerciseName.toLowerCase()
  for (const p of PATTERNS) {
    if (p.match.some(m => n.includes(m))) return p.tags
  }
  return FALLBACK
}

// ── Volume landmarks per muscle (sets per week) ──────────────────────────
// Based on Israetel volume guidelines, conservative-side. MAV is rendered
// as a target band on the dashboard; MEV/MRV are the alert thresholds.
export interface VolumeLandmarks {
  mev: number   // minimum effective volume — below this, no growth
  mavLow: number; mavHigh: number  // maximum adaptive volume — productive band
  mrv: number   // maximum recoverable volume — above this, signal deload
}

export const MUSCLE_TARGETS: Record<MuscleGroup, VolumeLandmarks> = {
  chest:        { mev: 8,  mavLow: 12, mavHigh: 16, mrv: 22 },
  back:         { mev: 10, mavLow: 14, mavHigh: 18, mrv: 25 },
  'side-delts': { mev: 8,  mavLow: 12, mavHigh: 18, mrv: 26 },
  'rear-delts': { mev: 6,  mavLow: 10, mavHigh: 14, mrv: 20 },
  'front-delts': { mev: 0, mavLow: 0,  mavHigh: 6,  mrv: 12 }, // mostly hit indirectly
  biceps:       { mev: 6,  mavLow: 8,  mavHigh: 12, mrv: 18 },
  triceps:      { mev: 6,  mavLow: 8,  mavHigh: 12, mrv: 18 },
  forearms:     { mev: 0,  mavLow: 0,  mavHigh: 6,  mrv: 12 },
  quads:        { mev: 8,  mavLow: 12, mavHigh: 16, mrv: 20 },
  hams:         { mev: 6,  mavLow: 8,  mavHigh: 12, mrv: 16 },
  glutes:       { mev: 0,  mavLow: 8,  mavHigh: 12, mrv: 16 },
  calves:       { mev: 8,  mavLow: 12, mavHigh: 15, mrv: 20 },
  core:         { mev: 4,  mavLow: 6,  mavHigh: 12, mrv: 20 },
}

// Order for dashboard display — most-prioritised muscles first.
export const DISPLAY_ORDER: MuscleGroup[] = [
  'chest', 'back', 'side-delts', 'biceps', 'triceps',
  'quads', 'hams', 'glutes', 'calves', 'core',
  'rear-delts', 'front-delts', 'forearms',
]

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', 'side-delts': 'Side Delts', 'rear-delts': 'Rear Delts',
  'front-delts': 'Front Delts', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', quads: 'Quads', hams: 'Hamstrings', glutes: 'Glutes',
  calves: 'Calves', core: 'Core',
}

// ── Volume math ──────────────────────────────────────────────────────────

export interface MuscleVolume {
  muscle: MuscleGroup
  sets: number          // effective sets — primary 1.0, secondary 0.5
  primarySets: number   // primary-only count
  status: VolumeStatus
  landmarks: VolumeLandmarks
}

export type VolumeStatus = 'undertrained' | 'low' | 'on-target' | 'overreaching' | 'mrv'

export function classifyVolume(sets: number, lm: VolumeLandmarks): VolumeStatus {
  if (sets < lm.mev) return 'undertrained'
  if (sets < lm.mavLow) return 'low'
  if (sets <= lm.mavHigh) return 'on-target'
  if (sets < lm.mrv) return 'overreaching'
  return 'mrv'
}

/**
 * Roll workouts into per-muscle effective set counts over the last `days`.
 * Only counts sets where reps > 0 (skipped/unlogged sets don't count).
 */
export function weeklyVolumeByMuscle(
  workouts: WorkoutData[],
  days = 7,
  now: Date = new Date(),
): MuscleVolume[] {
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)

  const counts: Record<MuscleGroup, { primary: number; effective: number }> =
    Object.fromEntries(DISPLAY_ORDER.map(m => [m, { primary: 0, effective: 0 }])) as never

  for (const w of workouts) {
    const t = new Date(w.start_time)
    if (t < cutoff) continue
    for (const ex of w.exercises) {
      const tags = tagExercise(ex.name)
      const validSets = ex.sets.filter(s => (s.reps ?? 0) > 0).length
      if (validSets === 0) continue
      for (const m of tags.primary) {
        counts[m].primary += validSets
        counts[m].effective += validSets
      }
      for (const m of tags.secondary) {
        counts[m].effective += validSets * 0.5
      }
    }
  }

  return DISPLAY_ORDER.map(m => {
    const c = counts[m]
    const lm = MUSCLE_TARGETS[m]
    return {
      muscle: m,
      sets: Math.round(c.effective * 2) / 2, // half-set precision
      primarySets: c.primary,
      status: classifyVolume(c.effective, lm),
      landmarks: lm,
    }
  })
}

export const STATUS_COLOR: Record<VolumeStatus, string> = {
  undertrained: 'var(--orange)',     // alert
  low:          'var(--yellow)',     // build it up
  'on-target':  'var(--green)',      // sweet spot
  overreaching: 'var(--blue)',       // working hard, ok short term
  mrv:          'var(--red)',        // deload signal
}

export const STATUS_LABEL: Record<VolumeStatus, string> = {
  undertrained: 'Undertrained',
  low:          'Building',
  'on-target':  'On target',
  overreaching: 'Pushing',
  mrv:          'Deload',
}
