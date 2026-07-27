import { describe, it, expect } from 'vitest'
import { analyzeWorkout } from './gym-analysis'
import type { WorkoutData, PR } from '../api/client'

const baseTime = '2026-05-07T10:00:00Z'
const endTime = '2026-05-07T11:00:00Z'

const pullDay: WorkoutData = {
  id: 'today', title: 'Pull',
  start_time: baseTime, end_time: endTime,
  exercises: [
    { name: 'Lat Pulldown', sets: [
      { weight_kg: 35, reps: 12 }, { weight_kg: 35, reps: 12 }, { weight_kg: 35, reps: 12 },
    ]},
    { name: 'Dumbbell Curl', sets: [
      { weight_kg: 10, reps: 12 }, { weight_kg: 10, reps: 10 }, { weight_kg: 10, reps: 8 },
    ]},
  ],
}

describe('gym-analysis: analyzeWorkout', () => {
  it('computes total volume and completion', () => {
    const a = analyzeWorkout(pullDay, [], {})
    expect(a.totalVolume).toBe(35 * 12 * 3 + 10 * (12 + 10 + 8))
    expect(a.completedSets).toBe(6)
  })

  it('detects PR when no previous best', () => {
    const a = analyzeWorkout(pullDay, [], {})
    const lp = a.prHits.find(p => p.exerciseName === 'Lat Pulldown')
    expect(lp?.isWeightPR).toBe(true)
  })

  it('detects reps PR at same weight', () => {
    const prevPRs: Record<string, PR> = {
      'Lat Pulldown': { weight_kg: 35, reps: 10, date: '2026-04-01' },
    }
    const a = analyzeWorkout(pullDay, [], prevPRs)
    const lp = a.prHits.find(p => p.exerciseName === 'Lat Pulldown')
    expect(lp?.isRepsPR).toBe(true)
  })

  it('no PR when both equal or below', () => {
    const prevPRs: Record<string, PR> = {
      'Lat Pulldown': { weight_kg: 40, reps: 12, date: '2026-04-01' },
      'Dumbbell Curl': { weight_kg: 12, reps: 12, date: '2026-04-01' },
    }
    const a = analyzeWorkout(pullDay, [], prevPRs)
    expect(a.prHits.length).toBe(0)
  })

  it('computes volume delta vs prior comparable', () => {
    const prior: WorkoutData = {
      ...pullDay,
      id: 'prior',
      start_time: '2026-04-30T10:00:00Z',
      end_time: '2026-04-30T11:00:00Z',
      exercises: [
        { name: 'Lat Pulldown', sets: [
          { weight_kg: 30, reps: 12 }, { weight_kg: 30, reps: 12 }, { weight_kg: 30, reps: 12 },
        ]},
        { name: 'Dumbbell Curl', sets: [
          { weight_kg: 10, reps: 10 }, { weight_kg: 10, reps: 10 }, { weight_kg: 10, reps: 10 },
        ]},
      ],
    }
    const a = analyzeWorkout(pullDay, [prior], {})
    expect(a.volumeDelta).toBeGreaterThan(0)
    expect(a.volumeDeltaPct).toBeGreaterThan(0)
  })

  it('null delta when no prior session', () => {
    const a = analyzeWorkout(pullDay, [], {})
    expect(a.volumeDelta).toBeNull()
    expect(a.volumeDeltaPct).toBeNull()
  })

  it('score is 0-100', () => {
    const a = analyzeWorkout(pullDay, [], {})
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
  })

  it('per-muscle contributions count', () => {
    const a = analyzeWorkout(pullDay, [], {})
    const back = a.perMuscle.find(m => m.muscle === 'back')
    expect(back?.sets).toBe(3) // 3 lat pulldown sets primary
    const biceps = a.perMuscle.find(m => m.muscle === 'biceps')
    expect(biceps?.sets).toBe(3 + 3 * 0.5) // 3 curl primary + 3 lat-pulldown secondary
  })

  it('headline mentions PRs when present', () => {
    const a = analyzeWorkout(pullDay, [], {}) // first ever session, all are PRs
    expect(a.headline).toMatch(/PR/)
  })

  it('top-of-range count tracks program rep range', () => {
    // Lat Pulldown range 6-10 on Pull day — 3×12 is at/above top = 3 at-top
    const a = analyzeWorkout(pullDay, [], {})
    expect(a.setsAtTopOfRange).toBeGreaterThanOrEqual(3)
  })

  it('working time estimate is sane', () => {
    const a = analyzeWorkout(pullDay, [], {})
    expect(a.workingTimeMins).toBeGreaterThan(0)
    expect(a.workingTimeMins).toBeLessThanOrEqual(a.durationMins)
  })
})
