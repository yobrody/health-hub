import { describe, it, expect } from 'vitest'
import {
  tagExercise, classifyVolume, weeklyVolumeByMuscle, MUSCLE_TARGETS,
} from './gym-muscles'
import type { WorkoutData } from '../api/client'

describe('gym-muscles: tagExercise', () => {
  it('lat pulldown → back primary, biceps + rear-delts secondary', () => {
    const t = tagExercise('Lat Pulldown')
    expect(t.primary).toContain('back')
    expect(t.secondary).toContain('biceps')
    expect(t.secondary).toContain('rear-delts')
  })
  it('dumbbell curl → biceps primary, forearms secondary', () => {
    const t = tagExercise('Dumbbell Curl')
    expect(t.primary).toEqual(['biceps'])
    expect(t.secondary).toContain('forearms')
  })
  it('hammer curl → biceps + forearms primary (more specific)', () => {
    const t = tagExercise('Hammer Curls')
    expect(t.primary).toContain('biceps')
    expect(t.primary).toContain('forearms')
  })
  it('leg press → quads + glutes primary, hams secondary', () => {
    const t = tagExercise('Leg Press')
    expect(t.primary).toContain('quads')
    expect(t.primary).toContain('glutes')
    expect(t.secondary).toContain('hams')
  })
  it('lateral raise → side-delts only', () => {
    const t = tagExercise('Dumbbell Lateral Raise')
    expect(t.primary).toEqual(['side-delts'])
  })
  it('rear delt fly → rear-delts primary', () => {
    const t = tagExercise('Rear Delt Fly (machine)')
    expect(t.primary).toContain('rear-delts')
  })
  it('cable crunch → core', () => {
    expect(tagExercise('Cable Crunch').primary).toEqual(['core'])
  })
  it('unknown exercise returns empty tags', () => {
    expect(tagExercise('Atlas Stone')).toEqual({ primary: [], secondary: [] })
  })
})

describe('gym-muscles: classifyVolume', () => {
  const lm = MUSCLE_TARGETS.chest
  it('below MEV → undertrained', () => {
    expect(classifyVolume(lm.mev - 1, lm)).toBe('undertrained')
  })
  it('between MEV and MAV-low → low', () => {
    expect(classifyVolume(lm.mev, lm)).toBe('low')
    expect(classifyVolume(lm.mavLow - 0.5, lm)).toBe('low')
  })
  it('within MAV band → on-target', () => {
    expect(classifyVolume(lm.mavLow, lm)).toBe('on-target')
    expect(classifyVolume(lm.mavHigh, lm)).toBe('on-target')
  })
  it('above MAV but below MRV → overreaching', () => {
    expect(classifyVolume(lm.mavHigh + 1, lm)).toBe('overreaching')
  })
  it('at or above MRV → mrv', () => {
    expect(classifyVolume(lm.mrv, lm)).toBe('mrv')
    expect(classifyVolume(lm.mrv + 5, lm)).toBe('mrv')
  })
})

describe('gym-muscles: weeklyVolumeByMuscle', () => {
  const now = new Date('2026-05-07T12:00:00Z')
  const recentWorkout: WorkoutData = {
    id: 'w1', title: 'Upper A', start_time: '2026-05-06T10:00:00Z', end_time: '2026-05-06T11:00:00Z',
    exercises: [
      { name: 'Lat Pulldown', sets: [
        { weight_kg: 35, reps: 10 }, { weight_kg: 35, reps: 10 }, { weight_kg: 35, reps: 8 },
      ]},
      { name: 'Dumbbell Curl', sets: [
        { weight_kg: 8, reps: 12 }, { weight_kg: 8, reps: 12 }, { weight_kg: 8, reps: 10 },
      ]},
    ],
  }

  it('counts primary sets at 1.0 each', () => {
    const v = weeklyVolumeByMuscle([recentWorkout], 7, now)
    const back = v.find(x => x.muscle === 'back')!
    expect(back.primarySets).toBe(3)
  })

  it('counts secondary contributions at 0.5 each', () => {
    const v = weeklyVolumeByMuscle([recentWorkout], 7, now)
    // Lat pulldown 3 sets primary back → biceps gets 3 × 0.5 = 1.5 secondary
    // Dumbbell curl 3 sets primary biceps → biceps gets 3 × 1.0 = 3 primary
    // Total effective biceps = 1.5 + 3 = 4.5
    const biceps = v.find(x => x.muscle === 'biceps')!
    expect(biceps.primarySets).toBe(3)
    expect(biceps.sets).toBe(4.5)
  })

  it('ignores workouts older than the window', () => {
    const old: WorkoutData = {
      ...recentWorkout, id: 'w2', start_time: '2026-04-01T10:00:00Z', end_time: '2026-04-01T11:00:00Z',
    }
    const v = weeklyVolumeByMuscle([old], 7, now)
    expect(v.find(x => x.muscle === 'back')!.sets).toBe(0)
  })

  it('skips sets without reps', () => {
    const skipped: WorkoutData = {
      id: 'w3', title: 'Upper A', start_time: '2026-05-06T10:00Z', end_time: '2026-05-06T11:00Z',
      exercises: [{ name: 'Lat Pulldown', sets: [{ weight_kg: 35 }] }], // no reps
    }
    const v = weeklyVolumeByMuscle([skipped], 7, now)
    expect(v.find(x => x.muscle === 'back')!.sets).toBe(0)
  })

  it('returns all display-order muscles even at zero', () => {
    const v = weeklyVolumeByMuscle([], 7, now)
    expect(v.length).toBeGreaterThan(8)
    expect(v.every(x => x.sets === 0)).toBe(true)
    expect(v.every(x => x.status === 'undertrained' || x.landmarks.mev === 0)).toBe(true)
  })
})
