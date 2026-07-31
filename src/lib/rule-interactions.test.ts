import { describe, it, expect } from 'vitest'
import { predictNextWeight, type SetSummary, type PredictRationale } from './workout-progression'

// Rule INTERACTIONS.
//
// Each rule has been tested alone. The engine now has five that can fire on the
// same input - layoff, stall deload, RIR hold, too-light, recalibration and the
// 10% jump rule with its overrun escape - and precedence between them has never
// been asserted. Conflicting rules are where the next real bug lives.

const KG5 = Array.from({ length: 20 }, (_, i) => 7 + i * 5)
const CABLE = Array.from({ length: 21 }, (_, i) => Math.round((2.5 + i * 5) * 0.45359237 * 10) / 10)
const nextUp = (stack: number[], w: number) => stack.find(v => v > w)

const atTop = (w: number, reps: number, n = 3): SetSummary[] =>
  Array.from({ length: n }, () => ({ weight_kg: w, reps }))

describe('precedence when several rules apply at once', () => {
  it('layoff beats everything, including a session that earned a jump', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 27, reps: 10 },
      prevSets: atTop(27, 10), priorSets: atTop(27, 10),
      repRange: '6-10', lastSessionRIR: 0, daysSinceLast: 40,
      recalibrating: true, nextStackUp: 32,
    })
    expect(r.rationale).toBe('deload-layoff')
    expect(r.weight_kg!).toBeLessThan(27)
  })

  it('a two-session stall beats recalibration', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 4 },
      prevSets: atTop(60, 4), priorSets: atTop(60, 4),
      repRange: '8-12', recalibrating: true, nextStackUp: 65,
    })
    expect(r.rationale).toBe('deload-stalled')
  })

  it('RIR slack beats recalibration - a soft set does not earn a big jump', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 12 },
      prevSets: atTop(60, 12),
      repRange: '8-12', recalibrating: true, lastSessionRIR: 2, nextStackUp: 62.5,
    })
    expect(r.rationale).toBe('hold-rir-slack')
    expect(r.weight_kg).toBe(60)
  })

  it('recalibration beats the 10% rule - that is the point of the flag', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 60, reps: 12 },
      prevSets: atTop(60, 12),
      repRange: '8-12', recalibrating: true, nextStackUp: 65, lastSessionRIR: 1,
    })
    expect(r.rationale).toBe('bump-recalibrating')
    expect(r.weight_kg!).toBeGreaterThan(60)
  })

  it('too-light still respects the overrun ladder rather than leaping', () => {
    const r = predictNextWeight({
      prevBest: { weight_kg: 3.4, reps: 20 },
      prevSets: atTop(3.4, 20),
      repRange: '12-20', lastSessionRIR: 4, nextStackUp: 5.7,
    })
    expect(r.rationale).toBe('hold-jump-too-big')
    expect(r.weight_kg).toBe(3.4)
  })
})

describe('no rule combination produces an absurd weight', () => {
  // A percentage cap is the wrong invariant. At the bottom of an imperial
  // cable stack 1.1kg and 3.4kg are ADJACENT notches - +209% - so a cap would
  // either fail on correct behaviour or force permanent stagnation, which is
  // the deadlock this engine was just fixed for. The real safety property is
  // that it never skips past the next notch and never halves without cause.
  it('never jumps beyond one notch, and never invents a weight', () => {
    const bad: string[] = []
    const rirs = [undefined, 0, 1, 2, 3, 4]
    const days = [undefined, 1, 11, 40]
    const recal = [false, true]
    const ranges = ['6-10', '8-12', '12-20']
    for (const stack of [KG5, CABLE]) {
      for (const w of stack.slice(0, 8)) {
        for (const reps of [3, 8, 12, 20, 30]) {
          for (const rir of rirs) for (const d of days) for (const rc of recal) for (const range of ranges) {
            const r = predictNextWeight({
              prevBest: { weight_kg: w, reps },
              prevSets: atTop(w, reps), priorSets: atTop(w, reps),
              repRange: range, lastSessionRIR: rir, daysSinceLast: d,
              recalibrating: rc, nextStackUp: nextUp(stack, w),
            })
            const out = r.weight_kg
            if (out === undefined) continue
            const notch = nextUp(stack, w)
            // recalibration is deliberately allowed a bigger, unsnapped jump
            const ceiling = Math.max(notch ?? w, w * 1.15)
            if (out > ceiling + 0.01) bad.push(`OVERSHOT ${w}->${out} ceiling ${ceiling} (${r.rationale})`)
            if (out < w && !r.rationale.startsWith('deload')) bad.push(`CUT ${w}->${out} (${r.rationale})`)
            if (out < w * 0.8) bad.push(`TOO DEEP ${w}->${out} (${r.rationale})`)
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('every rationale it can emit is one we know about', () => {
    const known = new Set<PredictRationale>([
      'no-history', 'baseline-pr', 'baseline-last',
      'bump-progressive-overload', 'bump-recalibrating', 'bump-too-light', 'bump-overrun',
      'hold-build-reps', 'hold-rir-slack', 'hold-jump-too-big',
      'deload-stalled', 'deload-layoff',
    ])
    const seen = new Set<string>()
    for (const w of [3.4, 17, 27, 60]) {
      for (const reps of [2, 6, 10, 15, 31]) {
        for (const rir of [undefined, 0, 2, 4]) {
          for (const d of [undefined, 40]) {
            for (const rc of [false, true]) {
              const r = predictNextWeight({
                prevBest: { weight_kg: w, reps },
                prevSets: atTop(w, reps), priorSets: atTop(w, reps),
                repRange: '8-12', lastSessionRIR: rir, daysSinceLast: d,
                recalibrating: rc, nextStackUp: nextUp(KG5, w),
              })
              seen.add(r.rationale)
              expect(known.has(r.rationale)).toBe(true)
            }
          }
        }
      }
    }
    // Make sure the sweep is actually exercising the interesting branches.
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })
})

describe('the overrun ladder terminates', () => {
  it('a lift stuck behind the 10% rule always escapes eventually', () => {
    // Bottom of the imperial cable stack: 3.4 -> 5.7kg is +68%, permanently
    // outside the 10% rule. Reps must climb and then cash in.
    let weight = 3.4
    let reps = 20
    let escaped = false
    const seen: string[] = []
    for (let i = 0; i < 25; i++) {
      const r = predictNextWeight({
        prevBest: { weight_kg: weight, reps },
        prevSets: atTop(weight, reps),
        repRange: '12-20', lastSessionRIR: 1, nextStackUp: nextUp(CABLE, weight),
      })
      seen.push(`${r.weight_kg}x${r.reps}`)
      if ((r.weight_kg ?? weight) > weight) { escaped = true; break }
      weight = r.weight_kg ?? weight
      reps = r.reps ?? reps
    }
    expect(escaped).toBe(true)
    // and it must not have repeated the same prescription while climbing
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('escapes on a normal 5kg stack too, and lands inside the rep range', () => {
    let weight = 27, reps = 10
    let final: { w?: number; reps?: number; why?: string } = {}
    for (let i = 0; i < 20; i++) {
      const r = predictNextWeight({
        prevBest: { weight_kg: weight, reps },
        prevSets: atTop(weight, reps),
        repRange: '6-10', lastSessionRIR: 1, nextStackUp: nextUp(KG5, weight),
      })
      if ((r.weight_kg ?? weight) > weight) { final = { w: r.weight_kg, reps: r.reps, why: r.rationale }; break }
      weight = r.weight_kg ?? weight
      reps = r.reps ?? reps
    }
    expect(final.w).toBe(32)
    expect(final.why).toBe('bump-overrun')
    // restarting above the range top would make the jump meaningless
    expect(final.reps).toBeLessThanOrEqual(10)
  })
})
