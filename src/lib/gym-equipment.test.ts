import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim } from './test-helpers'
installLocalStorageShim()
import {
  enumerateStack, snapToStack, nextUpWeight, nextDownWeight,
  findSeedEquipment, resolveEquipment, learnFromLogs, addManualEquipment,
  genericIncrement, SEED_PADDINGTON,
} from './gym-equipment'
import type { WorkoutData } from '../api/client'

describe('gym-equipment: enumerateStack', () => {
  it('uniform-step stacks enumerate min..max', () => {
    expect(enumerateStack({ min: 5, max: 20, step: 5 })).toEqual([5, 10, 15, 20])
  })
  it('value-list stacks use values', () => {
    expect(enumerateStack({ min: 2.5, max: 7.5, step: 2.5, values: [2.5, 5, 7.5] }))
      .toEqual([2.5, 5, 7.5])
  })
  it('add-ons interleave between base steps', () => {
    const list = enumerateStack({ min: 5, max: 15, step: 5, addOns: [1.25, 2.5] })
    expect(list).toContain(5)
    expect(list).toContain(6.25) // 5 + 1.25
    expect(list).toContain(7.5)  // 5 + 2.5
    expect(list).toContain(10)
    expect(list).toContain(11.25)
    expect(list).toContain(15)
  })
})

describe('gym-equipment: snap / next-up / next-down', () => {
  const stack5 = { min: 5, max: 100, step: 5 }
  it('snaps to nearest', () => {
    expect(snapToStack(stack5, 12)).toBe(10)
    expect(snapToStack(stack5, 13)).toBe(15)
    expect(snapToStack(stack5, 0)).toBe(5)   // clamps to min
    expect(snapToStack(stack5, 200)).toBe(100) // clamps to max
  })
  it('next-up returns strictly greater', () => {
    expect(nextUpWeight(stack5, 5)).toBe(10)
    expect(nextUpWeight(stack5, 9.9)).toBe(10)
    expect(nextUpWeight(stack5, 10)).toBe(15)
    expect(nextUpWeight(stack5, 100)).toBe(100) // clamped
  })
  it('next-down returns strictly less', () => {
    expect(nextDownWeight(stack5, 10)).toBe(5)
    expect(nextDownWeight(stack5, 5)).toBe(5)  // clamped
    expect(nextDownWeight(stack5, 12)).toBe(10)
  })
  it('add-ons surface as next-up half-step', () => {
    const stack = { min: 5, max: 20, step: 5, addOns: [2.5] }
    expect(nextUpWeight(stack, 5)).toBe(7.5)
    expect(nextUpWeight(stack, 7.5)).toBe(10)
  })
})

describe('gym-equipment: seed lookup', () => {
  it('exact name match finds Lat Pulldown', () => {
    expect(findSeedEquipment('Lat Pulldown')?.id).toBe('lat-pulldown')
  })
  it('alias match — case insensitive substring', () => {
    expect(findSeedEquipment('Incline Dumbbell Bench Press')?.id).toBe('dumbbells')
    expect(findSeedEquipment('Cable Triceps Pushdown')?.id).toBe('cable-tricep')
    expect(findSeedEquipment('Seated Cable Row')?.id).toBe('seated-row')
  })
  it('returns undefined for unknown', () => {
    expect(findSeedEquipment('Atlas Stone')).toBeUndefined()
  })
  it('seed catalog covers PROGRAM staples', () => {
    // Smoke check — every named lift in the program should match something
    const names = [
      'Incline Dumbbell Bench Press', 'Lat Pulldown', 'Seated Cable Row',
      'Leg Press', 'Leg Extension', 'Leg Curl', 'Pec Deck',
      'Cable Triceps Pushdown', 'Dumbbell Curl', 'Hanging Knee Raises',
    ]
    for (const n of names) expect(findSeedEquipment(n), `${n} should resolve`).toBeTruthy()
  })
})

describe('gym-equipment: resolveEquipment precedence', () => {
  beforeEach(() => { localStorage.clear() })

  it('seed alone resolves with seed stack', () => {
    const r = resolveEquipment('Lat Pulldown')
    expect(r.source).toBe('seed')
    expect(r.equipment?.id).toBe('lat-pulldown')
    expect(r.effectiveStack?.step).toBe(5)
  })

  it('learned data widens seed bounds', () => {
    const learned = {
      'Lat Pulldown': {
        exerciseName: 'Lat Pulldown',
        observedWeights: [40, 45, 50, 130],
        inferredStep: 5,
        inferredMin: 40,
        inferredMax: 130,
      },
    }
    const r = resolveEquipment('Lat Pulldown', learned, [])
    expect(r.source).toBe('seed')
    expect(r.effectiveStack?.max).toBeGreaterThanOrEqual(130) // widened
  })

  it('manual override beats seed', () => {
    addManualEquipment({
      id: 'lat-pulldown',
      name: 'Lat Pulldown',
      type: 'stack',
      stack: { min: 10, max: 70, step: 2.5 },
      aliases: ['lat pulldown'],
    })
    const r = resolveEquipment('Lat Pulldown')
    expect(r.source).toBe('manual')
    expect(r.effectiveStack?.step).toBe(2.5)
  })

  it('learned-only when no seed match', () => {
    const learned = {
      'Belt-Driven Sled': {
        exerciseName: 'Belt-Driven Sled',
        observedWeights: [40, 60, 80],
        inferredStep: 20,
        inferredMin: 40,
        inferredMax: 80,
      },
    }
    const r = resolveEquipment('Belt-Driven Sled', learned, [])
    expect(r.source).toBe('learned')
    expect(r.effectiveStack?.step).toBe(20)
  })

  it('returns none when nothing matches', () => {
    const r = resolveEquipment('Mystery Machine', {}, [])
    expect(r.source).toBe('none')
    expect(r.effectiveStack).toBeNull()
  })
})

describe('gym-equipment: learnFromLogs', () => {
  beforeEach(() => { localStorage.clear() })
  it('infers step from smallest gap', () => {
    const workouts: WorkoutData[] = [{
      id: 'w1', title: 'Upper A', start_time: '2026-05-01T10:00Z', end_time: '2026-05-01T11:00Z',
      exercises: [{
        name: 'Lat Pulldown',
        sets: [
          { weight_kg: 30, reps: 10 },
          { weight_kg: 35, reps: 10 },
          { weight_kg: 40, reps: 8 },
        ],
      }],
    }]
    const learned = learnFromLogs(workouts)
    expect(learned['Lat Pulldown'].inferredStep).toBe(5)
    expect(learned['Lat Pulldown'].inferredMin).toBe(30)
    expect(learned['Lat Pulldown'].inferredMax).toBe(40)
  })
  it('handles single-weight history (no step)', () => {
    const workouts: WorkoutData[] = [{
      id: 'w1', title: 'Upper A', start_time: '2026-05-01T10:00Z', end_time: '2026-05-01T11:00Z',
      exercises: [{ name: 'Pec Deck', sets: [{ weight_kg: 39, reps: 15 }] }],
    }]
    const learned = learnFromLogs(workouts)
    expect(learned['Pec Deck'].observedWeights).toEqual([39])
    expect(learned['Pec Deck'].inferredStep).toBeUndefined()
  })
  it('skips zero-weight bodyweight sets', () => {
    const workouts: WorkoutData[] = [{
      id: 'w1', title: 'Upper B', start_time: '2026-05-01T10:00Z', end_time: '2026-05-01T11:00Z',
      exercises: [{ name: 'Pull-Up', sets: [{ reps: 8 }, { reps: 6 }] }],
    }]
    const learned = learnFromLogs(workouts)
    expect(learned['Pull-Up']).toBeUndefined()
  })
})

describe('gym-equipment: genericIncrement', () => {
  it('1.25 below 40, 2.5 at/above', () => {
    expect(genericIncrement(20)).toBe(1.25)
    expect(genericIncrement(39.99)).toBe(1.25)
    expect(genericIncrement(40)).toBe(2.5)
    expect(genericIncrement(80)).toBe(2.5)
  })
})

describe('gym-equipment: SEED_PADDINGTON sanity', () => {
  it('all entries have unique ids', () => {
    const ids = SEED_PADDINGTON.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every stack has min ≤ max and positive step', () => {
    for (const e of SEED_PADDINGTON) {
      if (!e.stack) continue
      expect(e.stack.min, e.id).toBeLessThanOrEqual(e.stack.max)
      expect(e.stack.step, e.id).toBeGreaterThan(0)
    }
  })
})
