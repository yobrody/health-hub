import { describe, it, expect } from 'vitest'
import { installLocalStorageShim } from './test-helpers'
installLocalStorageShim()
import { analyzeWorkout } from './gym-analysis'
import { weeklyVolumeByMuscle } from './gym-muscles'
import type { WorkoutData } from '../api/client'

// The post-workout scorecard runs at the worst possible moment to throw: the
// instant a session is saved. tsc guarantees the FIELDS exist; it says nothing
// about the VALUES. A NaN or a null where the sheet formats a number renders as
// "NaN%" at best and unmounts the app at worst.
//
// Every field listed here is one PostWorkoutSheet actually reads.

const SHEET_READS = [
  'workoutId', 'title', 'durationMins', 'workingTimeMins', 'totalSets',
  'completedSets', 'totalVolume', 'setsAtTopOfRange', 'setsBelowRange',
  'score', 'headline',
] as const

function assertRenderable(a: Record<string, unknown>, label: string) {
  const bad: string[] = []
  for (const k of SHEET_READS) {
    const v = a[k]
    if (v === undefined || v === null) { bad.push(`${label}: ${k} is ${String(v)}`); continue }
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${label}: ${k} is ${v}`)
  }
  const subs = a.subscores as Record<string, number> | undefined
  if (!subs) bad.push(`${label}: subscores missing`)
  else for (const [k, v] of Object.entries(subs)) {
    if (!Number.isFinite(v)) bad.push(`${label}: subscores.${k} is ${v}`)
  }
  if (!Array.isArray(a.prHits)) bad.push(`${label}: prHits not an array`)
  if (!Array.isArray(a.perMuscle)) bad.push(`${label}: perMuscle not an array`)
  return bad
}

/** The real Push session, 27 Jul 2026 - including a bodyweight-style set. */
const REAL_PUSH: WorkoutData = {
  id: '2026-07-27-7', title: 'Push',
  start_time: '2026-07-27T10:00:00Z', end_time: '2026-07-27T11:20:00Z',
  exercises: [
    { name: 'Seated Shoulder Press (machine)', sets: [
      { weight_kg: 32, reps: 4, rir: 0 }, { weight_kg: 32, reps: 4, rir: 0 }, { weight_kg: 27, reps: 5, rir: 0 }] },
    { name: 'Incline Dumbbell Press', sets: [
      { weight_kg: 16, reps: 10 }, { weight_kg: 16, reps: 5 }, { weight_kg: 14, reps: 11 }] },
    { name: 'Pec Deck', sets: [
      { weight_kg: 45, reps: 19 }, { weight_kg: 45, reps: 16 }, { weight_kg: 45, reps: 10 }] },
    { name: 'Cable Lateral Raise', sets: [
      { weight_kg: 3.4, reps: 9 }, { weight_kg: 3.4, reps: 19 }, { weight_kg: 3.4, reps: 12 }] },
    { name: 'Hanging Knee Raise', sets: [{ reps: 12 }, { reps: 10 }] },
  ],
}

describe('post-workout scorecard survives the finish path', () => {
  it('renders cleanly for the real logged session', () => {
    const a = analyzeWorkout(REAL_PUSH, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'real push')).toEqual([])
  })

  it('survives a FIRST EVER workout - no history, no PRs', () => {
    const a = analyzeWorkout(REAL_PUSH, [], {})
    // volumeDeltaPct is legitimately null with no prior session; the sheet must
    // not be handed NaN instead.
    expect(a.volumeDeltaPct === null || Number.isFinite(a.volumeDeltaPct)).toBe(true)
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'first ever')).toEqual([])
  })

  it('survives a workout with NO completed sets', () => {
    const empty: WorkoutData = { ...REAL_PUSH, id: 'e', exercises: [{ name: 'Pec Deck', sets: [] }] }
    const a = analyzeWorkout(empty, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'no sets')).toEqual([])
  })

  it('survives a workout with no exercises at all', () => {
    const none: WorkoutData = { ...REAL_PUSH, id: 'n', exercises: [] }
    const a = analyzeWorkout(none, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'no exercises')).toEqual([])
  })

  it('survives bodyweight-only work (no weight_kg anywhere)', () => {
    const bw: WorkoutData = { ...REAL_PUSH, id: 'bw', exercises: [
      { name: 'Hanging Knee Raise', sets: [{ reps: 12 }, { reps: 12 }] },
      { name: 'Pull-ups (skill)', sets: [{ reps: 5 }] },
    ] }
    const a = analyzeWorkout(bw, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'bodyweight')).toEqual([])
    expect(a.totalVolume).toBe(0)
  })

  it('survives a zero-duration session (finished instantly)', () => {
    const z: WorkoutData = { ...REAL_PUSH, id: 'z', start_time: '2026-07-27T10:00:00Z', end_time: '2026-07-27T10:00:00Z' }
    const a = analyzeWorkout(z, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'zero duration')).toEqual([])
  })

  it('survives a malformed end_time', () => {
    const m: WorkoutData = { ...REAL_PUSH, id: 'm', end_time: 'not-a-time' }
    const a = analyzeWorkout(m, [], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'bad end_time')).toEqual([])
  })

  it('computes a volume delta against a prior session without exploding', () => {
    const prior: WorkoutData = { ...REAL_PUSH, id: 'prior', start_time: '2026-07-20T10:00:00Z' }
    const a = analyzeWorkout(REAL_PUSH, [prior], {})
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'with prior')).toEqual([])
    expect(a.volumeDeltaPct === null || Number.isFinite(a.volumeDeltaPct)).toBe(true)
  })

  it('handles a prior session of ZERO volume without dividing by zero', () => {
    const zeroVol: WorkoutData = { ...REAL_PUSH, id: 'zv', start_time: '2026-07-20T10:00:00Z',
      exercises: [{ name: 'Hanging Knee Raise', sets: [{ reps: 10 }] }] }
    const a = analyzeWorkout(REAL_PUSH, [zeroVol], {})
    expect(a.volumeDeltaPct === null || Number.isFinite(a.volumeDeltaPct)).toBe(true)
    expect(assertRenderable(a as unknown as Record<string, unknown>, 'zero-volume prior')).toEqual([])
  })

  it('score stays within 0-100 across all of the above', () => {
    const cases: WorkoutData[] = [
      REAL_PUSH,
      { ...REAL_PUSH, id: 'a', exercises: [] },
      { ...REAL_PUSH, id: 'b', exercises: [{ name: 'Pec Deck', sets: [] }] },
      { ...REAL_PUSH, id: 'c', end_time: 'not-a-time' },
    ]
    for (const w of cases) {
      const a = analyzeWorkout(w, [], {})
      expect(a.score).toBeGreaterThanOrEqual(0)
      expect(a.score).toBeLessThanOrEqual(100)
    }
  })
})

describe('weekly volume feeds the sheet safely', () => {
  it('returns a usable array for an empty history', () => {
    const v = weeklyVolumeByMuscle([], 7)
    expect(Array.isArray(v)).toBe(true)
    for (const m of v) expect(Number.isFinite(m.sets)).toBe(true)
  })

  it('never produces NaN sets from bodyweight work', () => {
    const bw: WorkoutData = { ...REAL_PUSH, id: 'bw2', exercises: [
      { name: 'Hanging Knee Raise', sets: [{ reps: 12 }] },
    ] }
    for (const m of weeklyVolumeByMuscle([bw], 7)) {
      expect(Number.isFinite(m.sets)).toBe(true)
      expect(m.sets).toBeGreaterThanOrEqual(0)
    }
  })
})
