import { describe, it, expect } from 'vitest'
import { evaluateProgressionFeedback } from './workout-progression'

// Topped-out, clean machine notch (Triceps Pushdown: 17kg → 18.1kg is +6.5%,
// inside the 10% rule) with only ~1 rep left in the tank → a genuine, EARNED
// increase. This is the case that should fire confetti.
const toppedClean = {
  name: 'Triceps Pushdown',
  repRange: '10–15',
  sets: [{ weight_kg: 17, reps: 15 }, { weight_kg: 17, reps: 15 }, { weight_kg: 17, reps: 15 }],
  lastSetRIR: 1,
  nextStackUp: 18.1,
}

describe('evaluateProgressionFeedback', () => {
  it('flags an EARNED jump when all sets top the range with nothing left in the tank', () => {
    const fb = evaluateProgressionFeedback(toppedClean)
    expect(fb.earned).toBe(true)
    expect(fb.fromKg).toBe(17)
    expect(fb.toKg).toBe(18.1)
    expect(fb.message).toContain('18.1')
  })

  it('does NOT celebrate when you topped the range but left reps in the tank', () => {
    // 2+ RIR at the top → the engine holds the weight ("push harder"). No jump,
    // no confetti — celebrating a soft set would be a lie.
    const fb = evaluateProgressionFeedback({ ...toppedClean, lastSetRIR: 2 })
    expect(fb.earned).toBe(false)
    expect(fb.toKg).toBeUndefined()
  })

  it('still counts a too-light set (3+ RIR) as an earned jump', () => {
    // Capped by the rep range, not by strength → the weight is simply too light.
    const fb = evaluateProgressionFeedback({ ...toppedClean, lastSetRIR: 3 })
    expect(fb.earned).toBe(true)
  })

  it('does not celebrate when the next real notch is an oversized jump', () => {
    // Shoulder press 27kg → next stack 32kg is +18.5%, outside the 10% rule at
    // only 10 reps. The engine says "build reps first" — real progress, but not
    // a weight jump, so no confetti.
    const fb = evaluateProgressionFeedback({
      name: 'Seated Shoulder Press (machine)',
      repRange: '6–10',
      sets: [{ weight_kg: 27, reps: 10 }, { weight_kg: 27, reps: 10 }, { weight_kg: 27, reps: 10 }],
      lastSetRIR: 1,
      nextStackUp: 32,
    })
    expect(fb.earned).toBe(false)
    // But there IS something encouraging to say (keep building).
    expect(fb.message.length).toBeGreaterThan(0)
  })

  it('does not celebrate an inside-the-range session', () => {
    const fb = evaluateProgressionFeedback({
      name: 'Cable Curl', repRange: '10–15',
      sets: [{ weight_kg: 15, reps: 12 }, { weight_kg: 15, reps: 11 }],
      lastSetRIR: 1,
    })
    expect(fb.earned).toBe(false)
  })
})
