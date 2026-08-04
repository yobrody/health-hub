import { describe, it, expect } from 'vitest'
import { suggestGoals, weightProgressTone, GAIN_SURPLUS_KCAL, LOSE_DEFICIT_KCAL } from './goal-suggestions'

describe('weightProgressTone — gain is good for a bulker', () => {
  it('treats gaining weight as good progress when bulking', () => {
    expect(weightProgressTone(0.8, 'gain')).toBe('good')
  })
  it('treats losing weight as off-track when bulking', () => {
    expect(weightProgressTone(-0.8, 'gain')).toBe('bad')
  })
  it('mirrors the logic when cutting', () => {
    expect(weightProgressTone(-0.8, 'lose')).toBe('good')
    expect(weightProgressTone(0.8, 'lose')).toBe('bad')
  })
  it('is neutral for maintenance drift and near-zero change', () => {
    expect(weightProgressTone(0.5, 'maintain')).toBe('neutral')
    expect(weightProgressTone(0.05, 'gain')).toBe('neutral')
    expect(weightProgressTone(-0.05, 'lose')).toBe('neutral')
  })
})

describe('suggestGoals — calories', () => {
  it('adds a lean-bulk surplus over TDEE when gaining', () => {
    const s = suggestGoals(2400, 62, 'gain')
    expect(s.calorieDelta).toBe(GAIN_SURPLUS_KCAL)
    expect(s.calories).toBe(2400 + GAIN_SURPLUS_KCAL)
    expect(s.calories).toBeGreaterThan(2400)
  })

  it('subtracts a deficit when losing', () => {
    const s = suggestGoals(2400, 62, 'lose')
    expect(s.calorieDelta).toBe(-LOSE_DEFICIT_KCAL)
    expect(s.calories).toBe(2400 - LOSE_DEFICIT_KCAL)
  })

  it('holds at TDEE when maintaining', () => {
    const s = suggestGoals(2400, 62, 'maintain')
    expect(s.calorieDelta).toBe(0)
    expect(s.calories).toBe(2400)
  })

  it('rounds the calorie target to the nearest 50', () => {
    // 2413 + 200 = 2613 → rounds to 2600
    const s = suggestGoals(2413, 62, 'gain')
    expect(s.calories % 50).toBe(0)
  })
})

describe('suggestGoals — protein', () => {
  it('uses ~2.0 g/kg bodyweight for muscle gain', () => {
    const s = suggestGoals(2400, 62, 'gain')
    expect(s.proteinPerKg).toBe(2.0)
    expect(s.protein).toBe(Math.round(62 * 2.0)) // 124
    expect(s.proteinRange).toEqual([Math.round(62 * 1.8), Math.round(62 * 2.2)]) // [112, 136]
  })

  it('uses a higher g/kg when cutting to spare muscle', () => {
    const s = suggestGoals(2400, 62, 'lose')
    expect(s.proteinPerKg).toBeGreaterThanOrEqual(2.2)
    expect(s.protein).toBeGreaterThan(suggestGoals(2400, 62, 'maintain').protein)
  })

  it('scales protein with bodyweight, not a fixed number', () => {
    const light = suggestGoals(2400, 60, 'gain')
    const heavy = suggestGoals(2400, 90, 'gain')
    expect(heavy.protein).toBeGreaterThan(light.protein)
  })
})

describe('suggestGoals — honest guards (no fabricated numbers)', () => {
  it('returns zeroed protein when bodyweight is missing/invalid', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const s = suggestGoals(2400, bad, 'gain')
      expect(s.protein).toBe(0)
      expect(s.proteinRange).toEqual([0, 0])
      expect(s.hasWeight).toBe(false)
    }
  })

  it('returns zeroed calories when TDEE is missing/invalid', () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      const s = suggestGoals(bad, 62, 'gain')
      expect(s.calories).toBe(0)
      expect(s.calorieDelta).toBe(0)
      expect(s.hasTdee).toBe(false)
    }
  })

  it('flags both present when inputs are valid', () => {
    const s = suggestGoals(2400, 62, 'gain')
    expect(s.hasTdee).toBe(true)
    expect(s.hasWeight).toBe(true)
  })
})
