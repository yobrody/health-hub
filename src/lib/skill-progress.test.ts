import { describe, it, expect } from 'vitest'
import { skillBests, ladderRung, SKILL_WORKOUT_TITLE } from './skill-progress'
import { SKILL_LADDER } from '../program'
import type { WorkoutData } from '../api/client'

const skillSession = (sets: Record<string, { reps?: number; duration_seconds?: number }[]>, date = '2026-07-28'): WorkoutData => ({
  id: date, title: SKILL_WORKOUT_TITLE,
  start_time: date + 'T08:00:00Z', end_time: date + 'T08:12:00Z',
  exercises: Object.keys(sets).map(name => ({ name, sets: sets[name] })),
})

describe('skillBests', () => {
  it('reads holds in seconds and reps separately', () => {
    const b = skillBests([skillSession({
      'Chest-to-wall handstand hold': [{ duration_seconds: 18 }, { duration_seconds: 24 }],
      'Pike pushups': [{ reps: 6 }, { reps: 5 }],
    })])
    expect(b['Chest-to-wall handstand hold']).toMatchObject({ value: 24, unit: 'sec' })
    expect(b['Pike pushups']).toMatchObject({ value: 6, unit: 'reps' })
  })

  it('keeps the best across sessions, not the latest', () => {
    const b = skillBests([
      skillSession({ 'Pike pushups': [{ reps: 4 }] }, '2026-08-01'),
      skillSession({ 'Pike pushups': [{ reps: 9 }] }, '2026-07-28'),
    ])
    expect(b['Pike pushups'].value).toBe(9)
  })

  it('ignores non-skill workouts entirely', () => {
    const push: WorkoutData = {
      id: 'x', title: 'Push', start_time: '2026-07-27T10:00:00Z', end_time: '2026-07-27T11:00:00Z',
      exercises: [{ name: 'Pike pushups', sets: [{ reps: 99 }] }],
    }
    expect(skillBests([push])).toEqual({})
  })

  it('returns nothing before the first session', () => {
    expect(skillBests([])).toEqual({})
  })
})

describe('ladderRung', () => {
  it('nothing cleared yet', () => {
    const r = ladderRung(0, SKILL_LADDER.hold)
    expect(r.cleared).toBe(0)
    expect(r.next).toBe(20)
    expect(r.pct).toBe(0)
  })
  it('measures progress from the rung below, not from zero', () => {
    // 30s: cleared 20, chasing 45. Halfway is 32.5s, so 30 should be under half.
    const r = ladderRung(30, SKILL_LADDER.hold)
    expect(r.cleared).toBe(1)
    expect(r.next).toBe(45)
    expect(r.pct).toBeCloseTo(10 / 25, 2)
  })
  it('tops out', () => {
    const r = ladderRung(75, SKILL_LADDER.hold)
    expect(r.cleared).toBe(3)
    expect(r.next).toBeNull()
    expect(r.pct).toBe(1)
  })
  it('works on the rep ladder', () => {
    const r = ladderRung(7, SKILL_LADDER.reps)
    expect(r.cleared).toBe(1)
    expect(r.next).toBe(10)
  })
})