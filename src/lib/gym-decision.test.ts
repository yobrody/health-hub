import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim } from './test-helpers'
installLocalStorageShim()
import {
  decideNextSet, dietModifier, fatigueModifier, sleepModifier,
  loadRestModifier, rirRestModifier, positionRestModifier,
  type DecisionInput,
} from './gym-decision'

describe('gym-decision: dietModifier', () => {
  it('full eating → 1.0', () => {
    expect(dietModifier({ properlyEating: true, lastDayKcalPct: 1.02, threeDayKcalPct: 1.0 }).mult).toBe(1.0)
  })
  it('3-day deficit ≥10% → 0.92', () => {
    const r = dietModifier({ properlyEating: false, threeDayKcalPct: 0.85 })
    expect(r.mult).toBe(0.92)
    expect(r.note).toMatch(/3-day/)
  })
  it('light undershoot → 0.985', () => {
    expect(dietModifier({ properlyEating: false, lastDayKcalPct: 0.85, threeDayKcalPct: 0.95 }).mult).toBe(0.985)
  })
  it('big undershoot → 0.95', () => {
    expect(dietModifier({ properlyEating: false, lastDayKcalPct: 0.6, threeDayKcalPct: 0.95 }).mult).toBe(0.95)
  })
  it('no logged intake → neutral 1.0 (never penalise missing data)', () => {
    expect(dietModifier({ properlyEating: false }).mult).toBe(1.0)
    expect(dietModifier({ properlyEating: true }).mult).toBe(1.0)
  })
})

describe('gym-decision: fatigueModifier', () => {
  it('first exercise → 1.0', () => {
    expect(fatigueModifier({ positionInSession: 0, totalExercises: 9, sessionVolumeSoFar: 0 }).mult).toBe(1.0)
  })
  it('2/3 through → 0.95 multiplier', () => {
    const r = fatigueModifier({ positionInSession: 6, totalExercises: 9, sessionVolumeSoFar: 0 })
    expect(r.mult).toBe(0.95)
  })
  it('mid-session → 0.97', () => {
    const r = fatigueModifier({ positionInSession: 4, totalExercises: 9, sessionVolumeSoFar: 0 })
    expect(r.mult).toBe(0.97)
  })
  it('high-volume session compounds tax', () => {
    const r = fatigueModifier({ positionInSession: 6, totalExercises: 9, sessionVolumeSoFar: 5000, avgSessionVolume: 5000 })
    // 0.95 × 0.97 ≈ 0.9215
    expect(r.mult).toBeLessThan(0.93)
  })
})

describe('gym-decision: sleepModifier', () => {
  it('null → 1.0', () => {
    expect(sleepModifier(null).mult).toBe(1.0)
  })
  it('≥7h → 1.0', () => {
    expect(sleepModifier(7.5).mult).toBe(1.0)
  })
  it('6-7h → 0.98', () => {
    expect(sleepModifier(6.5).mult).toBe(0.98)
  })
  it('<6h → 0.95', () => {
    expect(sleepModifier(5).mult).toBe(0.95)
  })
})

describe('gym-decision: rest modifiers', () => {
  it('heavy load >85% est-1RM → +20% rest', () => {
    // 100kg PR × 5 reps → est 1RM ≈ 100 × (1 + 5/30) = 116.67. 100kg = 86%.
    expect(loadRestModifier(100, { weight_kg: 100, reps: 5 }).mult).toBe(1.20)
  })
  it('mid load → 1.0', () => {
    // 100 × (1+10/30) = 133.3. 90kg = 67% → mid band.
    expect(loadRestModifier(90, { weight_kg: 100, reps: 10 }).mult).toBe(1.00)
  })
  it('light load <65% est-1RM → 0.85', () => {
    // 100 × (1+10/30) = 133. 70kg = 52%.
    expect(loadRestModifier(70, { weight_kg: 100, reps: 10 }).mult).toBe(0.85)
  })

  it('RIR ≤1 → +15% rest', () => {
    expect(rirRestModifier(1).mult).toBe(1.15)
    expect(rirRestModifier(0).mult).toBe(1.15)
  })
  it('RIR ≥3 → 0.85', () => {
    expect(rirRestModifier(3).mult).toBe(0.85)
  })
  it('RIR null → 1.0', () => {
    expect(rirRestModifier(null).mult).toBe(1.0)
  })

  it('first exercise → +10% rest', () => {
    expect(positionRestModifier({ positionInSession: 0, totalExercises: 9, sessionVolumeSoFar: 0 }).mult).toBe(1.10)
  })
  it('last quarter → 0.85', () => {
    expect(positionRestModifier({ positionInSession: 7, totalExercises: 9, sessionVolumeSoFar: 0 }).mult).toBe(0.85)
  })
})

describe('gym-decision: decideNextSet integration', () => {
  beforeEach(() => { localStorage.clear() })

  const baseInput: DecisionInput = {
    exerciseName: 'Lat Pulldown',
    prevBest: { weight_kg: 35, reps: 10 },
    prevSets: [{ weight_kg: 35, reps: 12 }, { weight_kg: 35, reps: 12 }, { weight_kg: 35, reps: 12 }],
    repRange: '8-12',
    programRestSeconds: 90,
    diet: { properlyEating: true, lastDayKcalPct: 1.0, threeDayKcalPct: 1.0 },
    session: { positionInSession: 2, totalExercises: 9, sessionVolumeSoFar: 1500, avgSessionVolume: 6000 },
  }

  it('properly eating + all sets at top → bumps weight, snaps to stack', () => {
    const r = decideNextSet(baseInput)
    expect(r.rationale).toBe('bump-progressive-overload')
    expect(r.weight_kg).toBeGreaterThan(35) // bumped
    // Lat Pulldown stack is 5kg step → bumped value should be a multiple of 5 (or +1.25/2.5 add-on)
    expect(r.weight_kg! % 1.25).toBe(0)
  })

  it('weightUp & weightDown bracket the chosen weight', () => {
    const r = decideNextSet(baseInput)
    expect(r.weightDown).toBeLessThan(r.weight_kg!)
    expect(r.weightUp).toBeGreaterThan(r.weight_kg!)
  })

  it('not eating + all sets at top → holds, suggests eat more', () => {
    const r = decideNextSet({
      ...baseInput,
      diet: { properlyEating: false, lastDayKcalPct: 0.7, threeDayKcalPct: 0.85 },
    })
    expect(r.rationale).toBe('hold-eat-more')
    expect(r.notes.some(n => n.includes('3-day'))).toBe(true)
  })

  it('late in session reduces predicted weight via fatigue mod', () => {
    const earlyR = decideNextSet({ ...baseInput, session: { positionInSession: 0, totalExercises: 9, sessionVolumeSoFar: 0 } })
    const lateR = decideNextSet({ ...baseInput, session: { positionInSession: 8, totalExercises: 9, sessionVolumeSoFar: 5500, avgSessionVolume: 6000 } })
    expect(lateR.weight_kg).toBeLessThanOrEqual(earlyR.weight_kg ?? Infinity)
  })

  it('RIR 0 → longer rest than RIR 3', () => {
    const tough = decideNextSet({ ...baseInput, lastSetRIR: 0 })
    const easy = decideNextSet({ ...baseInput, lastSetRIR: 3 })
    expect(tough.restSeconds).toBeGreaterThan(easy.restSeconds)
  })

  it('first exercise → longer rest than middle', () => {
    const first = decideNextSet({ ...baseInput, session: { ...baseInput.session, positionInSession: 0 } })
    const mid = decideNextSet({ ...baseInput, session: { ...baseInput.session, positionInSession: 3 } })
    expect(first.restSeconds).toBeGreaterThan(mid.restSeconds)
  })

  it('snaps to learned stack when no seed match', () => {
    // Cold start, no learned data, no seed for this name → falls back to generic
    const r = decideNextSet({
      ...baseInput,
      exerciseName: 'Mystery Machine',
      prevBest: { weight_kg: 30, reps: 10 },
    })
    expect(r.weightSource).toBe('none')
    expect(r.weightUp).toBeGreaterThan(r.weight_kg!)
  })

  it('rest is rounded to nearest 5s and ≥20s', () => {
    const r = decideNextSet(baseInput)
    expect(r.restSeconds % 5).toBe(0)
    expect(r.restSeconds).toBeGreaterThanOrEqual(20)
  })

  it('exposes modifier breakdown for UI debugging', () => {
    const r = decideNextSet(baseInput)
    expect(r.modifiers).toHaveProperty('diet')
    expect(r.modifiers).toHaveProperty('fatigue')
    expect(r.modifiers).toHaveProperty('rir')
  })
})
