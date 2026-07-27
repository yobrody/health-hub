import { describe, expect, it } from 'vitest'
import {
  isProperlyEating, parseRepRange, predictNextWeight, type DailyTotals,
} from './workout-progression'

describe('parseRepRange', () => {
  it('parses "8-12"', () => { expect(parseRepRange('8-12')).toEqual({ min: 8, max: 12 }) })
  it('handles whitespace', () => { expect(parseRepRange('5 - 8')).toEqual({ min: 5, max: 8 }) })
  it('returns null for unparseable', () => {
    expect(parseRepRange('AMRAP')).toBeNull()
    expect(parseRepRange(undefined)).toBeNull()
    expect(parseRepRange(null)).toBeNull()
  })
  it('rejects inverted ranges', () => { expect(parseRepRange('12-8')).toBeNull() })
})

describe('predictNextWeight: baselines', () => {
  it('no history at all', () => {
    expect(predictNextWeight({ prevBest: null, prevSets: [] }))
      .toMatchObject({ weight_kg: undefined, rationale: 'no-history' })
  })
  it('uses prevBest when no last-session sets', () => {
    expect(predictNextWeight({ prevBest: { weight_kg: 80, reps: 8 }, repRange: '8-12' }))
      .toMatchObject({ weight_kg: 80, rationale: 'baseline-pr' })
  })
  it('falls back to last-session weight', () => {
    expect(predictNextWeight({ prevSets: [{ weight_kg: 50, reps: 10 }] }))
      .toMatchObject({ weight_kg: 50, rationale: 'baseline-last' })
  })
  it('holds when inside the range', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 45, reps: 16 },
      prevSets: [{ weight_kg: 45, reps: 19 }, { weight_kg: 45, reps: 16 }],
      repRange: '12-20',
    })
    expect(r.weight_kg).toBe(45)
    expect(r.rationale).not.toBe('bump-progressive-overload')
  })
})

describe('predictNextWeight: food is NOT a gate', () => {
  it('bumps on earned reps with no nutrition input whatsoever', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [{ weight_kg: 80, reps: 12 }, { weight_kg: 80, reps: 12 }],
      repRange: '8-12', nextStackUp: 82.5,
    })
    expect(r).toMatchObject({ weight_kg: 82.5, rationale: 'bump-progressive-overload' })
  })
})

describe('predictNextWeight: RIR gates the jump', () => {
  it('top of range with 0-1 RIR earns the jump', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [{ weight_kg: 80, reps: 12 }, { weight_kg: 80, reps: 12 }],
      repRange: '8-12', lastSessionRIR: 1, nextStackUp: 82.5,
    })
    expect(r.rationale).toBe('bump-progressive-overload')
  })
  it('top of range with exactly 2 RIR holds and says push harder', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [{ weight_kg: 80, reps: 12 }, { weight_kg: 80, reps: 12 }],
      repRange: '8-12', lastSessionRIR: 2, nextStackUp: 82.5,
    })
    expect(r).toMatchObject({ weight_kg: 80, rationale: 'hold-rir-slack' })
  })
  it('unknown RIR still allows the jump', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 80, reps: 12 },
      prevSets: [{ weight_kg: 80, reps: 12 }],
      repRange: '8-12', lastSessionRIR: null, nextStackUp: 82.5,
    })
    expect(r.rationale).toBe('bump-progressive-overload')
  })
})

describe('predictNextWeight: the 10% jump rule', () => {
  // Real case: cable lateral raise at the bottom of an imperial stack.
  // 3.4kg -> 5.7kg is +68%. That is a wall, not a progression.
  it('holds and pushes reps past the top when the next notch is >10%', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 3.4, reps: 20 },
      prevSets: [{ weight_kg: 3.4, reps: 20 }, { weight_kg: 3.4, reps: 20 }],
      repRange: '12-20', nextStackUp: 5.7,
    })
    expect(r.rationale).toBe('hold-jump-too-big')
    expect(r.weight_kg).toBe(3.4)
    expect(r.reps).toBe(21)
    expect(r.note).toContain('68%')
  })
  it('allows the jump when it is inside 10%', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 17, reps: 15 },
      prevSets: [{ weight_kg: 17, reps: 15 }, { weight_kg: 17, reps: 15 }],
      repRange: '10-15', nextStackUp: 18.1,
    })
    expect(r.rationale).toBe('bump-progressive-overload')
  })
})

describe('predictNextWeight: stalls and layoffs', () => {
  it('one session below the bottom holds', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 32, reps: 4 },
      prevSets: [{ weight_kg: 32, reps: 4 }, { weight_kg: 32, reps: 4 }],
      repRange: '6-10',
    })
    expect(r).toMatchObject({ weight_kg: 32, rationale: 'hold-build-reps' })
  })
  it('two sessions below the bottom drops 15%', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 100, reps: 4 },
      prevSets: [{ weight_kg: 100, reps: 4 }],
      priorSets: [{ weight_kg: 100, reps: 5 }],
      repRange: '6-10',
    })
    expect(r).toMatchObject({ weight_kg: 85, rationale: 'deload-stalled' })
  })
  it('layoff over 10 days comes back 10% lighter', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 50, reps: 10 },
      prevSets: [{ weight_kg: 50, reps: 10 }],
      repRange: '8-12', daysSinceLast: 21,
    })
    expect(r).toMatchObject({ weight_kg: 45, rationale: 'deload-layoff' })
  })
  it('layoff takes priority over everything else', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 50, reps: 12 },
      prevSets: [{ weight_kg: 50, reps: 12 }, { weight_kg: 50, reps: 12 }],
      repRange: '8-12', daysSinceLast: 30, nextStackUp: 52.5,
    })
    expect(r.rationale).toBe('deload-layoff')
  })
  it('short gaps do not trigger the layoff rule', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 50, reps: 10 },
      prevSets: [{ weight_kg: 50, reps: 10 }],
      repRange: '8-12', daysSinceLast: 4,
    })
    expect(r.rationale).not.toBe('deload-layoff')
  })
})

describe('predictNextWeight: recalibrating seeds', () => {
  // Leg press is seeded 60kg deliberately low. Normal rules would crawl it
  // up 2.5kg a session; recalibration finds the real weight in one or two.
  it('jumps ~15% instead of one notch', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 12 },
      prevSets: [{ weight_kg: 60, reps: 12 }, { weight_kg: 60, reps: 12 }],
      repRange: '8-12', nextStackUp: 62.5, recalibrating: true,
    })
    expect(r.rationale).toBe('bump-recalibrating')
    expect(r.weight_kg).toBe(69)
  })
  it('does NOT override the 2+ RIR hold', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 12 },
      prevSets: [{ weight_kg: 60, reps: 12 }],
      repRange: '8-12', recalibrating: true, lastSessionRIR: 2,
    })
    expect(r.rationale).toBe('hold-rir-slack')
  })
  it('does NOT fire when reps are inside the range', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 10 },
      prevSets: [{ weight_kg: 60, reps: 10 }],
      repRange: '8-12', recalibrating: true,
    })
    expect(r.rationale).not.toBe('bump-recalibrating')
  })
})

describe('predictNextWeight: anchors on the settled weight, not the PR', () => {
  // Real session, 27 Jul 2026. Failed at 32kg twice, dropped to 27kg.
  // A PR-anchored engine would prescribe 32kg again - the exact weight
  // just demonstrated to be too heavy.
  it('uses the weight you dropped down to, not the one you failed at', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 32, reps: 4 },
      prevSets: [
        { weight_kg: 32, reps: 4 },
        { weight_kg: 32, reps: 4 },
        { weight_kg: 27, reps: 5 },
      ],
      repRange: '6-10',
    })
    expect(r.weight_kg).toBe(27)
    expect(r.rationale).toBe('hold-build-reps')
  })

  // Overhead cable extension: walked 14.7 -> 7.9 -> 5.7 -> 3.4kg.
  it('survives a long walk-down to the real working weight', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 7.9, reps: 4 },
      prevSets: [
        { weight_kg: 7.9, reps: 4 },
        { weight_kg: 5.7, reps: 4 },
        { weight_kg: 3.4, reps: 10 },
      ],
      repRange: '12-15',
    })
    expect(r.weight_kg).toBe(3.4)
  })

  it('still uses the PR when there is no session history', () => {
    const r = predictNextWeight({ prevBest: { weight_kg: 80, reps: 8 }, repRange: '8-12' })
    expect(r.weight_kg).toBe(80)
  })

  it('ignores zero-rep failed attempts when finding the settled weight', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 40, reps: 8 },
      prevSets: [{ weight_kg: 30, reps: 10 }, { weight_kg: 40, reps: 0 }],
      repRange: '8-12',
    })
    expect(r.weight_kg).toBe(30)
  })
})

describe('predictNextWeight: the four effort tiers stay distinct', () => {
  // Tier -> RIR mapping used by the rest screen: easy 4, good 2, hard 1, fail 0.
  const atTop = {
    prevBest: { weight_kg: 80, reps: 12 },
    prevSets: [{ weight_kg: 80, reps: 12 }, { weight_kg: 80, reps: 12 }],
    repRange: '8-12',
    nextStackUp: 82.5,
  }

  it('Too easy (RIR 4) goes UP - the range is capping you, not your strength', () => {
    const r = predictNextWeight({ ...atTop, lastSessionRIR: 4 })
    expect(r.rationale).toBe('bump-too-light')
    expect(r.weight_kg).toBe(82.5)
  })

  it('Just right (RIR 2) holds and asks for a harder effort', () => {
    const r = predictNextWeight({ ...atTop, lastSessionRIR: 2 })
    expect(r.rationale).toBe('hold-rir-slack')
    expect(r.weight_kg).toBe(80)
  })

  it('Hard (RIR 1) earns the normal jump', () => {
    const r = predictNextWeight({ ...atTop, lastSessionRIR: 1 })
    expect(r.rationale).toBe('bump-progressive-overload')
  })

  it('Too easy and Just right must NOT produce the same weight', () => {
    const easy = predictNextWeight({ ...atTop, lastSessionRIR: 4 })
    const good = predictNextWeight({ ...atTop, lastSessionRIR: 2 })
    expect(easy.weight_kg).not.toBe(good.weight_kg)
  })

  it('too-light still respects the 10% jump rule', () => {
    // Bottom of an imperial cable stack: 3.4 -> 5.7kg is +68%.
    const r = predictNextWeight({
      prevBest: { weight_kg: 3.4, reps: 20 },
      prevSets: [{ weight_kg: 3.4, reps: 20 }],
      repRange: '12-20', nextStackUp: 5.7, lastSessionRIR: 4,
    })
    expect(r.rationale).toBe('hold-jump-too-big')
  })
})

describe('isProperlyEating', () => {
  const goals = { calories: 2800, protein: 140 }
  it('false with no logged days', () => { expect(isProperlyEating([], goals)).toBe(false) })
  it('true when latest logged day hit both targets', () => {
    const h: DailyTotals[] = [{ date: '2026-05-01', total_kcal: 2700, total_protein_g: 135, logged: true }]
    expect(isProperlyEating(h, goals)).toBe(true)
  })
  it('false when calories too low', () => {
    expect(isProperlyEating([{ date: '2026-05-01', total_kcal: 1800, total_protein_g: 140, logged: true }], goals)).toBe(false)
  })
  it('false when protein missing', () => {
    expect(isProperlyEating([{ date: '2026-05-01', total_kcal: 2800, logged: true }], goals)).toBe(false)
  })
  it('uses the latest logged day', () => {
    const h: DailyTotals[] = [
      { date: '2026-04-29', total_kcal: 1500, total_protein_g: 60, logged: true },
      { date: '2026-05-01', total_kcal: 2800, total_protein_g: 145, logged: true },
    ]
    expect(isProperlyEating(h, goals)).toBe(true)
  })
})