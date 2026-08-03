import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim } from './test-helpers'
installLocalStorageShim()
import {
  decideNextSet, sleepModifier, loadRestModifier, rirRestModifier,
  positionRestModifier, type DecisionInput,
} from './gym-decision'

describe('gym-decision: rest modifiers', () => {
  it('heavy load >85% est-1RM -> +20% rest', () => {
    expect(loadRestModifier(100, { weight_kg: 100, reps: 5 }).mult).toBe(1.20)
  })
  it('mid load -> 1.0', () => {
    expect(loadRestModifier(90, { weight_kg: 100, reps: 10 }).mult).toBe(1.00)
  })
  it('light load -> 0.85', () => {
    expect(loadRestModifier(70, { weight_kg: 100, reps: 10 }).mult).toBe(0.85)
  })
  it('RIR <=1 -> more rest', () => {
    expect(rirRestModifier(1).mult).toBe(1.15)
    expect(rirRestModifier(0).mult).toBe(1.15)
  })
  it('RIR >=3 -> less rest', () => { expect(rirRestModifier(3).mult).toBe(0.85) })
  it('RIR null -> neutral', () => { expect(rirRestModifier(null).mult).toBe(1.0) })
  it('first exercise -> more rest', () => {
    expect(positionRestModifier({ positionInSession: 0, totalExercises: 9, sessionVolumeSoFar: 0 }).mult).toBe(1.10)
  })
  it('last quarter -> less rest', () => {
    expect(positionRestModifier({ positionInSession: 7, totalExercises: 9, sessionVolumeSoFar: 0 }).mult).toBe(0.85)
  })
  it('poor sleep -> MORE rest, never less weight', () => {
    expect(sleepModifier(5).mult).toBeGreaterThan(1)
    expect(sleepModifier(7.5).mult).toBe(1.0)
    expect(sleepModifier(null).mult).toBe(1.0)
  })
})

describe('gym-decision: decideNextSet', () => {
  beforeEach(() => { localStorage.clear() })

  const baseInput: DecisionInput = {
    exerciseName: 'Lat Pulldown',
    prevBest: { weight_kg: 32, reps: 10 },
    prevSets: [{ weight_kg: 32, reps: 12 }, { weight_kg: 32, reps: 12 }, { weight_kg: 32, reps: 12 }],
    repRange: '8-12',
    programRestSeconds: 90,
    session: { positionInSession: 2, totalExercises: 9, sessionVolumeSoFar: 1500, avgSessionVolume: 6000 },
  }

  it('top of range on a coarse imperial stack holds and builds reps (jump too big)', () => {
    // 32->39kg is +22% (the smallest real notch), which exceeds the 10% cap,
    // so 12 reps isn't enough — the engine holds and tells you to add reps.
    const r = decideNextSet(baseInput)
    expect(r.rationale).toBe('hold-jump-too-big')
    expect(r.weight_kg).toBe(32)
  })

  it('enough rep-overrun earns the big notch and lands on a real weight', () => {
    const r = decideNextSet({ ...baseInput,
      prevBest: { weight_kg: 32, reps: 18 },
      prevSets: [{ weight_kg: 32, reps: 18 }, { weight_kg: 32, reps: 18 }, { weight_kg: 32, reps: 18 }] })
    expect(r.rationale).toBe('bump-overrun')
    expect(r.weight_kg).toBeGreaterThan(32)
    expect([39, 45]).toContain(r.weight_kg)  // a real stack notch, never 36 / 32.5
  })

  it('weightUp and weightDown bracket the chosen weight', () => {
    const r = decideNextSet(baseInput)
    expect(r.weightDown).toBeLessThan(r.weight_kg!)
    expect(r.weightUp).toBeGreaterThan(r.weight_kg!)
  })

  it('SESSION POSITION DOES NOT CHANGE THE WEIGHT', () => {
    const early = decideNextSet({ ...baseInput, session: { positionInSession: 0, totalExercises: 9, sessionVolumeSoFar: 0 } })
    const late = decideNextSet({ ...baseInput, session: { positionInSession: 8, totalExercises: 9, sessionVolumeSoFar: 5500, avgSessionVolume: 6000 } })
    expect(late.weight_kg).toBe(early.weight_kg)
  })

  it('SLEEP DOES NOT CHANGE THE WEIGHT, only rest', () => {
    const rested = decideNextSet({ ...baseInput, sleepHours: 8 })
    const wrecked = decideNextSet({ ...baseInput, sleepHours: 4 })
    expect(wrecked.weight_kg).toBe(rested.weight_kg)
    expect(wrecked.restSeconds).toBeGreaterThanOrEqual(rested.restSeconds)
  })

  it('exactly 2 RIR last session holds the weight', () => {
    const r = decideNextSet({ ...baseInput, lastSessionRIR: 2 })
    expect(r.rationale).toBe('hold-rir-slack')
    expect(r.weight_kg).toBe(32)
  })

  it('long layoff comes back lighter — a real notch down, not rounded back up', () => {
    const r = decideNextSet({ ...baseInput, daysSinceLast: 30 })
    expect(r.rationale).toBe('deload-layoff')
    expect(r.weight_kg).toBeLessThan(32)
    expect(r.weight_kg).toBe(25)  // next real notch below 32 on the 15lb stack
  })

  it('RIR 0 -> longer rest than RIR 3', () => {
    const tough = decideNextSet({ ...baseInput, lastSetRIR: 0 })
    const easy = decideNextSet({ ...baseInput, lastSetRIR: 3 })
    expect(tough.restSeconds).toBeGreaterThan(easy.restSeconds)
  })

  it('rest rounded to 5s and >=20s', () => {
    const r = decideNextSet(baseInput)
    expect(r.restSeconds % 5).toBe(0)
    expect(r.restSeconds).toBeGreaterThanOrEqual(20)
  })

  it('unknown exercise falls back to generic increments', () => {
    const r = decideNextSet({ ...baseInput, exerciseName: 'Mystery Machine', prevBest: { weight_kg: 30, reps: 10 } })
    expect(r.weightSource).toBe('none')
    expect(r.weightUp).toBeGreaterThan(r.weight_kg!)
  })

  it('exposes the rest modifier breakdown', () => {
    const r = decideNextSet(baseInput)
    expect(r.modifiers).toHaveProperty('load')
    expect(r.modifiers).toHaveProperty('rir')
    expect(r.modifiers).not.toHaveProperty('diet')
  })
})