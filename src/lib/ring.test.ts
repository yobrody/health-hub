import { describe, it, expect } from 'vitest'
import { ringProgress } from './ring'

describe('ringProgress', () => {
  it('returns a clamped fraction when the goal is a real positive number', () => {
    expect(ringProgress(50, 100)).toBe(0.5)
    expect(ringProgress(150, 100)).toBe(1) // clamped
    expect(ringProgress(0, 100)).toBe(0)
  })

  it('returns null (no honest basis) when the goal is missing', () => {
    // The whole point: a failed goals fetch must NOT draw a filled ring
    // against a fabricated default. null => render empty ring + "—".
    expect(ringProgress(50, null)).toBeNull()
    expect(ringProgress(50, undefined)).toBeNull()
  })

  it('returns null when the goal is zero or negative (not a real target)', () => {
    expect(ringProgress(50, 0)).toBeNull()
    expect(ringProgress(50, -100)).toBeNull()
  })

  it('returns null when the goal is NaN', () => {
    expect(ringProgress(50, Number.NaN)).toBeNull()
  })
})
