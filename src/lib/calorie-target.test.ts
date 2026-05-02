import { beforeEach, describe, expect, it } from 'vitest'
import {
  analyzeWeightTrend,
  loadDirection,
  LS_DIRECTION_KEY,
  saveDirection,
  suggestCalorieTarget,
  type Trend,
  type WeightEntry,
} from './calorie-target'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  raw(key: string) { return this.map.get(key) }
}

function isoDay(daysAgo: number, anchor = new Date('2026-05-01T00:00:00Z')): string {
  const d = new Date(anchor.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

describe('loadDirection / saveDirection', () => {
  let storage: MemoryStorage
  beforeEach(() => { storage = new MemoryStorage() })

  it('defaults to maintain when nothing saved', () => {
    expect(loadDirection(storage)).toBe('maintain')
  })
  it('round-trips gain / lose / maintain', () => {
    saveDirection(storage, 'gain')
    expect(storage.raw(LS_DIRECTION_KEY)).toBe('gain')
    expect(loadDirection(storage)).toBe('gain')
  })
  it('rejects bad values', () => {
    storage.setItem(LS_DIRECTION_KEY, 'bulk')
    expect(loadDirection(storage)).toBe('maintain')
  })
})

describe('analyzeWeightTrend', () => {
  it('returns null for empty input', () => {
    expect(analyzeWeightTrend([])).toBeNull()
  })

  it('returns null when only one data point in window', () => {
    expect(analyzeWeightTrend([{ date: isoDay(0), kg: 80 }])).toBeNull()
  })

  it('detects a flat trend at zero kg/week', () => {
    const weights: WeightEntry[] = []
    for (let i = 0; i < 14; i++) weights.push({ date: isoDay(i), kg: 80 })
    const t = analyzeWeightTrend(weights)
    expect(t).not.toBeNull()
    expect(t!.weeklyChangeKg).toBeCloseTo(0, 3)
    expect(t!.reliable).toBe(true)
    expect(t!.current).toBe(80)
    expect(t!.days).toBe(14)
  })

  it('detects a -0.5 kg/week loss trend over 14 days', () => {
    // Weight goes 81 → 80 over 14 days = -1kg in 14 days = -0.5 kg/week
    const weights: WeightEntry[] = []
    for (let i = 0; i < 14; i++) {
      const daysAgo = 13 - i
      weights.push({ date: isoDay(daysAgo), kg: 80 + (daysAgo / 14) })
    }
    const t = analyzeWeightTrend(weights)!
    expect(t.weeklyChangeKg).toBeCloseTo(-0.5, 1)
    expect(t.reliable).toBe(true)
  })

  it('marks unreliable when fewer than 14 distinct days', () => {
    const weights: WeightEntry[] = [
      { date: isoDay(0), kg: 80 },
      { date: isoDay(3), kg: 79.8 },
      { date: isoDay(6), kg: 79.5 },
    ]
    const t = analyzeWeightTrend(weights)!
    expect(t.reliable).toBe(false)
    expect(t.days).toBe(3)
  })

  it('respects the windowDays parameter — older entries excluded', () => {
    const weights: WeightEntry[] = [
      { date: isoDay(60), kg: 70 },  // way old
      { date: isoDay(5), kg: 80 },
      { date: isoDay(0), kg: 80 },
    ]
    const t = analyzeWeightTrend(weights, 14)!
    expect(t.days).toBe(2) // only the two within window
  })
})

describe('suggestCalorieTarget', () => {
  function trend(weeklyChangeKg: number, reliable = true): Trend {
    return { days: 14, current: 80, weeklyChangeKg, reliable }
  }

  it('returns non-actionable when no trend', () => {
    const s = suggestCalorieTarget(2800, null, 'maintain')
    expect(s.actionable).toBe(false)
    expect(s.deltaKcal).toBe(0)
    expect(s.suggested).toBe(2800)
  })

  it('returns non-actionable when trend is unreliable (<14 days)', () => {
    const s = suggestCalorieTarget(2800, trend(0, false), 'maintain')
    expect(s.actionable).toBe(false)
    expect(s.reason).toMatch(/14 days/)
  })

  describe('maintain', () => {
    it('no action when within ±0.2kg/week', () => {
      const s = suggestCalorieTarget(2800, trend(0.1), 'maintain')
      expect(s.actionable).toBe(false)
    })
    it('suggests -100 when trending up beyond +0.2', () => {
      const s = suggestCalorieTarget(2800, trend(0.4), 'maintain')
      expect(s.actionable).toBe(true)
      expect(s.deltaKcal).toBe(-100)
      expect(s.suggested).toBe(2700)
    })
    it('suggests +100 when trending down beyond -0.2', () => {
      const s = suggestCalorieTarget(2800, trend(-0.5), 'maintain')
      expect(s.deltaKcal).toBe(100)
      expect(s.suggested).toBe(2900)
    })
  })

  describe('lose', () => {
    it('no action at -0.5 kg/week (target)', () => {
      const s = suggestCalorieTarget(2400, trend(-0.5), 'lose')
      expect(s.actionable).toBe(false)
    })
    it('suggests -150 when not losing (e.g. 0 kg/week)', () => {
      const s = suggestCalorieTarget(2400, trend(0), 'lose')
      expect(s.deltaKcal).toBe(-150)
      expect(s.suggested).toBe(2250)
    })
    it('suggests +150 when losing too fast (e.g. -1.0 kg/week)', () => {
      const s = suggestCalorieTarget(2400, trend(-1.0), 'lose')
      expect(s.deltaKcal).toBe(150)
      expect(s.suggested).toBe(2550)
    })
  })

  describe('gain', () => {
    it('no action at +0.25 kg/week (target)', () => {
      const s = suggestCalorieTarget(3200, trend(0.25), 'gain')
      expect(s.actionable).toBe(false)
    })
    it('suggests +200 when not gaining', () => {
      const s = suggestCalorieTarget(3200, trend(0), 'gain')
      expect(s.deltaKcal).toBe(200)
      expect(s.suggested).toBe(3400)
    })
    it('suggests -100 when gaining too fast', () => {
      const s = suggestCalorieTarget(3200, trend(0.6), 'gain')
      expect(s.deltaKcal).toBe(-100)
      expect(s.suggested).toBe(3100)
    })
  })

  it('rounds suggestions to nearest 50 kcal', () => {
    // start at 2825 (not on a 50 boundary); maintain rule bumps -100 → 2725, rounded to 2700/2750
    const s = suggestCalorieTarget(2825, trend(0.4), 'maintain')
    expect(s.suggested % 50).toBe(0)
  })
})
