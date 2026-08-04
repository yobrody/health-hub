import { describe, it, expect } from 'vitest'
import { computeReadiness, type ReadinessSleepEntry } from './readiness'

function night(date: string, duration_hrs: number, quality: number, hrv_ms?: number): ReadinessSleepEntry {
  return { date, duration_hrs, quality, hrv_ms }
}

describe('computeReadiness', () => {
  it('returns null with no data (never invents a score)', () => {
    expect(computeReadiness([])).toBeNull()
    expect(computeReadiness(null)).toBeNull()
    expect(computeReadiness(undefined)).toBeNull()
  })

  it('scores a great night as ready (sleep-only, no HRV baseline)', () => {
    const r = computeReadiness([night('2026-08-04', 8.2, 5)])!
    expect(r).not.toBeNull()
    expect(r.usedHrv).toBe(false)
    expect(r.level).toBe('ready')
    expect(r.score).toBeGreaterThanOrEqual(70)
    expect(r.advice).toMatch(/train as planned/i)
  })

  it('scores a poor short night as low recovery', () => {
    const r = computeReadiness([night('2026-08-04', 4.5, 2)])!
    expect(r.level).toBe('low')
    expect(r.score).toBeLessThan(45)
  })

  it('uses the most recent night as "last night"', () => {
    const entries = [night('2026-08-01', 8.5, 5), night('2026-08-04', 4.2, 1)]
    const r = computeReadiness(entries)!
    expect(r.level).toBe('low') // driven by the 4.2h night, not the good one
  })

  it('factors HRV once there is a ≥3-night baseline', () => {
    const entries = [
      night('2026-08-01', 8, 4, 50),
      night('2026-08-02', 8, 4, 52),
      night('2026-08-03', 8, 4, 48),
      night('2026-08-04', 7.5, 4, 34), // last night HRV well below ~50 baseline
    ]
    const r = computeReadiness(entries)!
    expect(r.usedHrv).toBe(true)
    expect(r.factors.some(f => /HRV 34ms vs 50ms baseline · low/.test(f))).toBe(true)
  })

  it('does NOT use HRV with fewer than 3 baseline nights', () => {
    const entries = [
      night('2026-08-03', 8, 4, 50),
      night('2026-08-04', 7.5, 4, 34),
    ]
    const r = computeReadiness(entries)!
    expect(r.usedHrv).toBe(false)
    expect(r.factors.some(f => /HRV/.test(f))).toBe(false)
  })

  it('gives deload advice when short sleep AND HRV are both low', () => {
    const entries = [
      night('2026-08-01', 8, 4, 50),
      night('2026-08-02', 8, 4, 52),
      night('2026-08-03', 8, 4, 48),
      night('2026-08-04', 5, 2, 30),
    ]
    const r = computeReadiness(entries)!
    expect(r.level).toBe('low')
    expect(r.advice).toMatch(/deload|rest day/i)
  })

  it('produces a score in [0,100] for arbitrary inputs', () => {
    for (const [d, q] of [[3, 1], [6, 3], [9, 5], [7.5, 4]] as const) {
      const r = computeReadiness([night('2026-08-04', d, q)])!
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
  })
})
