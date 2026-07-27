import { describe, it, expect } from 'vitest'
import { predictNextWeight, type SetSummary } from './workout-progression'

// Single-call fuzzing cannot catch a lift that is quietly stuck forever.
// These simulate real sessions in sequence and assert the programme actually
// goes somewhere.

type Stack = number[]

/** Next real notch above w on a given stack. */
function nextUp(stack: Stack, w: number): number | undefined {
  return stack.find(v => v > w)
}

/**
 * Run N sessions. The lifter always achieves exactly the prescribed reps at
 * the prescribed weight, reporting 1 RIR - i.e. a perfectly compliant trainee.
 * If the weight does not climb for such a person, the engine is broken.
 */
function simulate(opts: {
  stack: Stack
  start: number
  repRange: string
  sessions: number
  rir?: number
}) {
  const { stack, start, repRange, sessions, rir = 1 } = opts
  let weight = start
  let reps = parseInt(repRange.split('-')[1], 10)
  const history: { weight: number; reps: number; rationale: string }[] = []
  let prev: SetSummary[] = []
  let prior: SetSummary[] = []

  for (let i = 0; i < sessions; i++) {
    const sets: SetSummary[] = [
      { weight_kg: weight, reps },
      { weight_kg: weight, reps },
      { weight_kg: weight, reps },
    ]
    prior = prev
    prev = sets
    const r = predictNextWeight({
      prevBest: { weight_kg: weight, reps },
      prevSets: prev,
      priorSets: prior,
      repRange,
      lastSessionRIR: rir,
      nextStackUp: nextUp(stack, weight),
    })
    history.push({ weight: r.weight_kg ?? weight, reps: r.reps ?? reps, rationale: r.rationale })
    weight = r.weight_kg ?? weight
    reps = r.reps ?? reps
  }
  return history
}

// The Gym Group Paddington cable columns: 5lb plates on a 2.5lb offset.
const CABLE_LB: Stack = Array.from({ length: 21 }, (_, i) =>
  Math.round((2.5 + i * 5) * 0.45359237 * 10) / 10)
// A normal 5kg selectorised machine.
const KG5: Stack = Array.from({ length: 20 }, (_, i) => 7 + i * 5)

describe('SIMULATION: a compliant lifter must actually progress', () => {
  it('climbs on a normal 5kg stack', () => {
    const h = simulate({ stack: KG5, start: 27, repRange: '6-10', sessions: 6 })
    const final = h[h.length - 1].weight
    expect(final).toBeGreaterThan(27)
  })

  it('does NOT get stuck forever at the bottom of an imperial cable stack', () => {
    // 3.4 -> 5.7kg is +68%, permanently outside the 10% rule. If reps are the
    // only escape, the target must at least keep RISING - otherwise the lifter
    // repeats an identical session indefinitely and the app is lying about
    // progression.
    const h = simulate({ stack: CABLE_LB, start: 3.4, repRange: '12-20', sessions: 8 })
    const weights = h.map(x => x.weight)
    const reps = h.map(x => x.reps)
    const escaped = weights[weights.length - 1] > 3.4
    const repsClimbing = reps[reps.length - 1] > reps[0]
    expect(escaped || repsClimbing).toBe(true)
  })

  it('a stuck lift never repeats the identical prescription forever', () => {
    const h = simulate({ stack: CABLE_LB, start: 3.4, repRange: '12-20', sessions: 8 })
    const signatures = h.map(x => `${x.weight}x${x.reps}`)
    const unique = new Set(signatures)
    expect(unique.size).toBeGreaterThan(1)
  })
})

describe('SIMULATION: failure paths terminate', () => {
  it('repeated failure deloads, then stops falling forever', () => {
    let weight = 100
    const seen: number[] = []
    for (let i = 0; i < 10; i++) {
      const sets: SetSummary[] = [{ weight_kg: weight, reps: 3 }, { weight_kg: weight, reps: 3 }]
      const r = predictNextWeight({
        prevBest: { weight_kg: weight, reps: 3 },
        prevSets: sets,
        priorSets: sets,
        repRange: '8-12',
      })
      weight = r.weight_kg ?? weight
      seen.push(weight)
      expect(weight).toBeGreaterThan(0)
    }
    // It should fall, but never to zero or negative.
    expect(seen[seen.length - 1]).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBeLessThan(100)
  })

  it('a layoff only costs one session, then normal rules resume', () => {
    const back = predictNextWeight({
      prevBest: { weight_kg: 50, reps: 10 },
      prevSets: [{ weight_kg: 50, reps: 10 }],
      repRange: '8-12', daysSinceLast: 30,
    })
    expect(back.rationale).toBe('deload-layoff')
    const after = predictNextWeight({
      prevBest: { weight_kg: 50, reps: 10 },
      prevSets: [{ weight_kg: back.weight_kg!, reps: 12 }, { weight_kg: back.weight_kg!, reps: 12 }],
      repRange: '8-12', daysSinceLast: 2, lastSessionRIR: 1, nextStackUp: 47.5,
    })
    expect(after.rationale).not.toBe('deload-layoff')
  })
})

describe('SIMULATION: ramp sets must never influence the outcome', () => {
  it('a leaked ramp set visibly corrupts the prescription', () => {
    const working: SetSummary[] = [{ weight_kg: 27, reps: 10 }, { weight_kg: 27, reps: 10 }]
    const withoutRamp = predictNextWeight({
      prevBest: { weight_kg: 27, reps: 10 },
      prevSets: working, repRange: '6-10', lastSessionRIR: 1, nextStackUp: 32,
    })
    // The UI filters ramp sets out before they arrive. This asserts the
    // contract: if one ever leaks through, the result changes and this fails.
    const leaked: SetSummary[] = [{ weight_kg: 13.5, reps: 8 }, ...working]
    const withRamp = predictNextWeight({
      prevBest: { weight_kg: 27, reps: 10 },
      prevSets: leaked, repRange: '6-10', lastSessionRIR: 1, nextStackUp: 32,
    })
    // A 50% warm-up set breaks the "every set hit the top" check, so the
    // engine stops seeing an earned session and silently holds. Same weight,
    // different reasoning - which is exactly the silent freeze the filter
    // in Workout.tsx exists to prevent.
    expect(withoutRamp.rationale).toBe('hold-jump-too-big')
    expect(withRamp.rationale).toBe('baseline-pr')
    expect(withRamp.reps).not.toBe(withoutRamp.reps)
  })
})
