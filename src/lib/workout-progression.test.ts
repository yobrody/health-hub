import { describe, expect, it } from 'vitest'
import {
  isProperlyEating,
  parseRepRange,
  predictNextWeight,
  type DailyTotals,
} from './workout-progression'

describe('parseRepRange', () => {
  it('parses "8-12"', () => {
    expect(parseRepRange('8-12')).toEqual({ min: 8, max: 12 })
  })
  it('handles whitespace and "5 - 8"', () => {
    expect(parseRepRange('5 - 8')).toEqual({ min: 5, max: 8 })
  })
  it('returns null for unparseable strings', () => {
    expect(parseRepRange('AMRAP')).toBeNull()
    expect(parseRepRange('')).toBeNull()
    expect(parseRepRange(undefined)).toBeNull()
    expect(parseRepRange(null)).toBeNull()
  })
  it('rejects inverted ranges', () => {
    expect(parseRepRange('12-8')).toBeNull()
  })
})

describe('predictNextWeight', () => {
  it('returns undefined weight when there is no history at all', () => {
    expect(
      predictNextWeight({ prevBest: null, prevSets: [], properlyEating: true }),
    ).toMatchObject({ weight_kg: undefined, rationale: 'no-history' })
  })

  it('uses prevBest when provided and no last-session sets', () => {
    expect(
      predictNextWeight({
        prevBest: { weight_kg: 80, reps: 8 },
        properlyEating: true,
        repRange: '8-12',
      }),
    ).toMatchObject({ weight_kg: 80, reps: 8, rationale: 'baseline-pr' })
  })

  it('bumps weight by 2.5kg when all sets hit rep-range top AND user is properly eating (≥40kg)', () => {
    const result = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [
        { weight_kg: 80, reps: 12 },
        { weight_kg: 80, reps: 12 },
        { weight_kg: 80, reps: 12 },
      ],
      repRange: '8-12',
      properlyEating: true,
    })
    expect(result).toMatchObject({ weight_kg: 82.5, reps: 12, rationale: 'bump-progressive-overload' })
  })

  it('uses smaller +1.25kg increment for sub-40kg lifts', () => {
    const result = predictNextWeight({
      prevBest: { weight_kg: 25, reps: 12 },
      prevSets: [
        { weight_kg: 25, reps: 12 },
        { weight_kg: 25, reps: 12 },
      ],
      repRange: '8-12',
      properlyEating: true,
    })
    expect(result).toMatchObject({ weight_kg: 26.25, rationale: 'bump-progressive-overload' })
  })

  it('holds weight (no bump) when all reps hit but user is NOT properly eating', () => {
    const result = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [
        { weight_kg: 80, reps: 12 },
        { weight_kg: 80, reps: 12 },
      ],
      repRange: '8-12',
      properlyEating: false,
    })
    expect(result).toMatchObject({ weight_kg: 80, rationale: 'hold-eat-more' })
  })

  it('holds weight when all sets are below rep-range minimum (build reps first)', () => {
    const result = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 6 },
      prevSets: [
        { weight_kg: 80, reps: 6 },
        { weight_kg: 80, reps: 5 },
      ],
      repRange: '8-12',
      properlyEating: true,
    })
    expect(result).toMatchObject({ weight_kg: 80, reps: 8, rationale: 'hold-build-reps' })
  })

  it('does not bump on partial-top performance (one set hit max, others did not)', () => {
    const result = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [
        { weight_kg: 80, reps: 12 },
        { weight_kg: 80, reps: 10 },
        { weight_kg: 80, reps: 9 },
      ],
      repRange: '8-12',
      properlyEating: true,
    })
    expect(result.rationale).not.toBe('bump-progressive-overload')
    expect(result.weight_kg).toBe(80)
  })

  it('rounds bumped weights to nearest 0.25kg', () => {
    // 17.5 (sub-40kg) + 1.25 = 18.75 — already on a quarter
    const result = predictNextWeight({
      prevBest: { weight_kg: 17.5, reps: 12 },
      prevSets: [
        { weight_kg: 17.5, reps: 12 },
        { weight_kg: 17.5, reps: 12 },
      ],
      repRange: '8-12',
      properlyEating: true,
    })
    expect(result.weight_kg).toBe(18.75)
  })

  it('falls back to last-session weight when no prevBest', () => {
    const result = predictNextWeight({
      prevSets: [{ weight_kg: 50, reps: 10 }],
      properlyEating: true,
    })
    expect(result).toMatchObject({ weight_kg: 50, reps: 10, rationale: 'baseline-last' })
  })
})

describe('isProperlyEating', () => {
  const goals = { calories: 2800, protein: 140 }

  it('returns false when there are no logged days', () => {
    expect(isProperlyEating([], goals)).toBe(false)
    expect(
      isProperlyEating([{ date: '2026-05-01', total_kcal: 2800, total_protein_g: 140, logged: false }], goals),
    ).toBe(false)
  })

  it('returns true when latest logged day hit ≥95% of both targets', () => {
    const history: DailyTotals[] = [
      { date: '2026-05-01', total_kcal: 2700, total_protein_g: 135, logged: true }, // 96% / 96%
    ]
    expect(isProperlyEating(history, goals)).toBe(true)
  })

  it('returns false when calories were too low', () => {
    const history: DailyTotals[] = [
      { date: '2026-05-01', total_kcal: 1800, total_protein_g: 140, logged: true },
    ]
    expect(isProperlyEating(history, goals)).toBe(false)
  })

  it('returns false when protein was too low', () => {
    const history: DailyTotals[] = [
      { date: '2026-05-01', total_kcal: 2800, total_protein_g: 80, logged: true },
    ]
    expect(isProperlyEating(history, goals)).toBe(false)
  })

  it('uses the LATEST logged day, ignoring older ones', () => {
    const history: DailyTotals[] = [
      // Old bad day (shouldn't poison the result)
      { date: '2026-04-29', total_kcal: 1500, total_protein_g: 60, logged: true },
      // Latest day — good
      { date: '2026-05-01', total_kcal: 2800, total_protein_g: 145, logged: true },
    ]
    expect(isProperlyEating(history, goals)).toBe(true)
  })

  it('skips unlogged days when finding the latest', () => {
    const history: DailyTotals[] = [
      { date: '2026-05-02', total_kcal: 0, total_protein_g: 0, logged: false }, // today, not logged
      { date: '2026-05-01', total_kcal: 2800, total_protein_g: 140, logged: true }, // yesterday, good
    ]
    expect(isProperlyEating(history, goals)).toBe(true)
  })

  it('treats missing protein as 0', () => {
    const history: DailyTotals[] = [
      { date: '2026-05-01', total_kcal: 2800, logged: true }, // no protein
    ]
    expect(isProperlyEating(history, goals)).toBe(false)
  })
})
