import { describe, it, expect } from 'vitest'
import { strengthTargetFor, MOVEMENT_RATIOS } from './strength-targets'

describe('strengthTargetFor', () => {
  it('gives a bodyweight-ratio target for a compound, scaled to the GOAL weight', () => {
    // Lat pulldown ratio is 0.85 → at a 72kg goal, target ≈ 61kg.
    const t = strengthTargetFor('Lat Pulldown', 72)
    expect(t).not.toBeNull()
    expect(t!.basis).toBe('bw-ratio')
    // 72 * 0.85 = 61.2, snapped to the nearest 0.5kg = 61.0.
    expect(t!.targetKg).toBe(61)
    expect(t!.ratio).toBe(MOVEMENT_RATIOS.pulldown)
  })

  it('snaps the target to a clean 0.5kg increment', () => {
    const t = strengthTargetFor('Leg Press', 71)
    expect(t).not.toBeNull()
    // Whatever the raw value, it must land on a 0.5 boundary.
    expect(t!.targetKg * 2).toBe(Math.round(t!.targetKg * 2))
  })

  it('reports progress toward the target when a current best is known', () => {
    const t = strengthTargetFor('Lat Pulldown', 72, { currentBestKg: 38 })
    expect(t!.progressPct).toBeCloseTo(38 / (72 * MOVEMENT_RATIOS.pulldown), 2)
  })

  it('clamps progress at 1 when already past the target', () => {
    const t = strengthTargetFor('Seated Shoulder Press (machine)', 72, { currentBestKg: 999 })
    expect(t!.progressPct).toBe(1)
  })

  it('scales an isolation target by bodyweight from the current best (no invented absolute)', () => {
    // Cable Curl has no honest external standard → keep pace with bodyweight:
    // at 62kg lifting 15kg, the 72kg target is 15 * 72/62 ≈ 17.4kg.
    const t = strengthTargetFor('Cable Curl', 72, { currentWeightKg: 62, currentBestKg: 15 })
    expect(t).not.toBeNull()
    expect(t!.basis).toBe('personal-scale')
    expect(t!.targetKg).toBeCloseTo(15 * (72 / 62), 0)
  })

  it('returns null for an isolation with no history to scale from', () => {
    // Nothing to ground a number on → honest "no target", never a guess.
    expect(strengthTargetFor('Cable Curl', 72)).toBeNull()
    expect(strengthTargetFor('Cable Curl', 72, { currentBestKg: 15 })).toBeNull() // no current weight
  })

  it('does not misclassify isolations that share words with compounds', () => {
    // "Overhead Cable Triceps Extension" contains "Overhead" but is NOT a press.
    const ext = strengthTargetFor('Overhead Cable Triceps Extension', 72, { currentWeightKg: 62, currentBestKg: 3.4 })
    expect(ext!.basis).toBe('personal-scale')
    // "Leg Extension" contains "Leg" but is NOT a leg press.
    const legExt = strengthTargetFor('Leg Extension', 72, { currentWeightKg: 62, currentBestKg: 52 })
    expect(legExt!.basis).toBe('personal-scale')
    // "Calf Press on Leg Press" is calves, not the leg-press pattern.
    const calf = strengthTargetFor('Calf Press on Leg Press', 72, { currentWeightKg: 62, currentBestKg: 66 })
    expect(calf!.basis).toBe('personal-scale')
  })
})
