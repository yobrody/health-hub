import { describe, it, expect, beforeEach } from 'vitest'
import { classifyFreshness, resetStaleness } from './staleness'

// A response served from the SW cache carries an OLD `Date` header (when it was
// cached); a fresh network response's Date ≈ now. We self-calibrate for
// client/server clock skew by tracking the freshest gap seen.
describe('classifyFreshness', () => {
  beforeEach(() => resetStaleness())

  it("is 'unknown' when there's no usable Date header", () => {
    expect(classifyFreshness(null, 1_000_000)).toBe('unknown')
    expect(classifyFreshness('not a date', 1_000_000)).toBe('unknown')
  })

  it("treats a response whose Date ≈ now as fresh (even with constant skew)", () => {
    const now = Date.parse('2026-08-17T12:00:00Z')
    // Server clock 30s behind the client (skew), but response is live.
    expect(classifyFreshness('2026-08-17T11:59:30Z', now)).toBe('fresh')
  })

  it('flags a clearly old cached response as stale', () => {
    const now = Date.parse('2026-08-17T12:00:00Z')
    // First, a fresh response calibrates the skew baseline (~0).
    classifyFreshness('2026-08-17T12:00:00Z', now)
    // Then a response dated 10 minutes ago = served from cache = stale.
    expect(classifyFreshness('2026-08-17T11:50:00Z', now)).toBe('stale')
  })

  it('self-corrects the baseline when the first response was itself cached', () => {
    const now = Date.parse('2026-08-17T12:00:00Z')
    // First seen is a 10-min-old cache hit → provisional baseline.
    classifyFreshness('2026-08-17T11:50:00Z', now)
    // A subsequent genuinely-fresh response resets the baseline down…
    expect(classifyFreshness('2026-08-17T12:00:00Z', now)).toBe('fresh')
    // …and now the old one is correctly stale again.
    expect(classifyFreshness('2026-08-17T11:50:00Z', now)).toBe('stale')
  })
})
