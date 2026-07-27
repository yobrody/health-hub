import { describe, it, expect } from 'vitest'
import { weeklyChangeKg, countStalledLifts, diagnoseProgress } from './progress-diagnosis'

describe('weeklyChangeKg', () => {
  it('needs at least two entries', () => {
    expect(weeklyChangeKg([])).toBeNull()
    expect(weeklyChangeKg([{ date: '2026-07-01', kg: 63 }])).toBeNull()
  })
  it('needs at least a week of span', () => {
    expect(weeklyChangeKg([
      { date: '2026-07-01', kg: 63 }, { date: '2026-07-03', kg: 63.4 },
    ])).toBeNull()
  })
  it('computes real weekly change', () => {
    // 61.2 on 17 Jun -> 63.0 on 27 Jul = 1.8kg over 40 days
    const w = weeklyChangeKg([
      { date: '2026-06-17', kg: 61.2 }, { date: '2026-07-27', kg: 63.0 },
    ])
    expect(w).toBeCloseTo(0.315, 2)
  })
})

describe('countStalledLifts', () => {
  it('counts a lift whose top weight never moves', () => {
    expect(countStalledLifts([{ name: 'Leg Press', topWeights: [60, 60, 60] }])).toBe(1)
  })
  it('does not count a climbing lift', () => {
    expect(countStalledLifts([{ name: 'Lat Pulldown', topWeights: [42, 38, 35] }])).toBe(0)
  })
  it('counts a lift that went backwards', () => {
    expect(countStalledLifts([{ name: 'Pec Deck', topWeights: [40, 45, 45] }])).toBe(1)
  })
  it('ignores lifts with a single session', () => {
    expect(countStalledLifts([{ name: 'New Thing', topWeights: [20] }])).toBe(0)
  })
})

describe('diagnoseProgress', () => {
  const flat = [{ date: '2026-06-01', kg: 63 }, { date: '2026-06-29', kg: 63 }]

  it('asks for more weigh-ins when there is nothing to read', () => {
    expect(diagnoseProgress([], []).kind).toBe('need-data')
  })

  it('calls out food when lifts stall AND weight is flat', () => {
    const d = diagnoseProgress(flat, [
      { name: 'A', topWeights: [30, 30, 30] },
      { name: 'B', topWeights: [17, 17, 17] },
    ])
    expect(d.kind).toBe('eat-more')
    expect(d.headline).toContain('food, not training')
  })

  it('does NOT blame food when weight is flat but lifts are climbing', () => {
    const d = diagnoseProgress(flat, [
      { name: 'A', topWeights: [35, 32, 30] },
      { name: 'B', topWeights: [20, 18, 17] },
    ])
    expect(d.kind).toBe('ok')
  })

  it('flags gaining too fast', () => {
    const d = diagnoseProgress([
      { date: '2026-06-01', kg: 63 }, { date: '2026-06-29', kg: 66 },
    ], [])
    expect(d.kind).toBe('gaining-fast')
  })

  it('reads the real log as slightly above target, not a problem', () => {
    const d = diagnoseProgress([
      { date: '2026-06-17', kg: 61.2 }, { date: '2026-07-27', kg: 63.0 },
    ], [])
    expect(d.kind).toBe('ok')
    expect(d.headline).toContain('slightly above target')
  })
})