import { describe, it, expect } from 'vitest'
import { computeWeightTrend, type WeightEntry } from './weight-trend'

// Anchor "now" to a fixed timestamp so 7d-ago math is deterministic.
// 2026-05-07 12:00 UTC.
const NOW = new Date('2026-05-07T12:00:00Z').getTime()

function daysAgo(n: number): string {
  // ISO date n days before NOW, in UTC.
  const d = new Date(NOW - n * 86400000)
  return d.toISOString().slice(0, 10)
}

describe('computeWeightTrend', () => {
  it('returns nulls when the log is empty', () => {
    const r = computeWeightTrend([], NOW)
    expect(r.latest).toBeUndefined()
    expect(r.delta).toBeNull()
    expect(r.entries).toEqual([])
  })

  it('returns latest with null delta on a single entry', () => {
    const entries: WeightEntry[] = [{ date: daysAgo(0), kg: 64.2 }]
    const r = computeWeightTrend(entries, NOW)
    expect(r.latest?.kg).toBe(64.2)
    expect(r.delta).toBeNull()
  })

  it('returns latest with null delta when no entry sits in the 7d window', () => {
    // Two entries, both within the last 2 days — no point near 7d-ago.
    const entries: WeightEntry[] = [
      { date: daysAgo(0), kg: 64.0 },
      { date: daysAgo(1), kg: 64.1 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.latest?.kg).toBe(64.0)
    expect(r.delta).toBeNull()
  })

  it('computes delta against an entry exactly 7 days ago', () => {
    const entries: WeightEntry[] = [
      { date: daysAgo(7), kg: 64.0 },
      { date: daysAgo(0), kg: 64.6 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.latest?.kg).toBe(64.6)
    // 64.6 - 64.0 = 0.6 (allow tiny float noise from UTC midpoint math)
    expect(r.delta).toBeCloseTo(0.6, 5)
  })

  it('uses an entry within the ±3-day window when 7d-exact is missing', () => {
    // No entry on day 7, but day 9 should match (window goes to -3d from ref).
    const entries: WeightEntry[] = [
      { date: daysAgo(9), kg: 65.0 },
      { date: daysAgo(0), kg: 64.2 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.latest?.kg).toBe(64.2)
    expect(r.delta).toBeCloseTo(-0.8, 5)
  })

  it('does not pick an entry too recent (3 days ago) for the 7d delta', () => {
    // Day 3 is well inside the ±3d-of-7d window? It's not — ref is 7d ago,
    // window is ref+1 to ref-3, i.e. 6d-ago through 10d-ago. Day 3 is too
    // recent and must be ignored.
    const entries: WeightEntry[] = [
      { date: daysAgo(3), kg: 64.0 },
      { date: daysAgo(0), kg: 64.6 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.delta).toBeNull()
  })

  it('sorts unsorted input', () => {
    const entries: WeightEntry[] = [
      { date: daysAgo(0), kg: 64.5 },
      { date: daysAgo(7), kg: 64.0 },
      { date: daysAgo(3), kg: 64.3 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.entries.map(e => e.date)).toEqual([daysAgo(7), daysAgo(3), daysAgo(0)])
    expect(r.latest?.kg).toBe(64.5)
  })

  it('returns negative delta when weight is dropping', () => {
    const entries: WeightEntry[] = [
      { date: daysAgo(7), kg: 65.0 },
      { date: daysAgo(0), kg: 64.4 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.delta).toBeCloseTo(-0.6, 5)
  })

  it('uses the most recent entry as latest, not the largest', () => {
    const entries: WeightEntry[] = [
      { date: daysAgo(7), kg: 80.0 },  // higher but older
      { date: daysAgo(0), kg: 64.2 },
    ]
    const r = computeWeightTrend(entries, NOW)
    expect(r.latest?.kg).toBe(64.2)
  })

  it('does not mutate the input array', () => {
    const entries: WeightEntry[] = [
      { date: daysAgo(0), kg: 64.5 },
      { date: daysAgo(7), kg: 64.0 },
    ]
    const before = entries.map(e => e.date)
    computeWeightTrend(entries, NOW)
    expect(entries.map(e => e.date)).toEqual(before)
  })
})
