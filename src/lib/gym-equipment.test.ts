import { describe, it, expect } from 'vitest'
import { resolveEquipment, snapToStack, nextUpWeight, nextDownWeight, enumerateStack } from './gym-equipment'

// Regression: The Gym Group Paddington's selectorised stacks are imperial
// (15lb / 10lb steps), shown rounded to whole kg. The old metric model produced
// weights that don't exist on the machine (32.5kg, 36kg) — exactly what Brody
// hit on 2026-08-03. These lock the real notches in.

describe('imperial stacks land on real notches', () => {
  it('Seated Cable Row exposes 32 / 39 / 45 and never 36', () => {
    const st = resolveEquipment('Seated Cable Row').effectiveStack!
    const vals = enumerateStack(st)
    expect(vals).toContain(32)
    expect(vals).toContain(39)
    expect(vals).toContain(45)
    expect(vals).not.toContain(36)
    // Stepping up from 39 lands on 45, not an invented 40/41.
    expect(nextUpWeight(st, 39)).toBe(45)
    expect(nextDownWeight(st, 39)).toBe(32)
  })

  it('Rear Delt Fly exposes 25 / 32 / 39 and never 32.5', () => {
    const st = resolveEquipment('Rear Delt Fly (machine)').effectiveStack!
    const vals = enumerateStack(st)
    expect(vals).toContain(25)
    expect(vals).toContain(32)
    expect(vals).toContain(39)
    expect(vals).not.toContain(32.5)
    expect(nextUpWeight(st, 32)).toBe(39)
    expect(nextDownWeight(st, 32)).toBe(25)
  })

  it('Shoulder Press exposes the 10lb family 23 / 27 / 32', () => {
    const st = resolveEquipment('Converging Shoulder Press').effectiveStack!
    const vals = enumerateStack(st)
    expect(vals).toContain(23)
    expect(vals).toContain(27)
    expect(vals).toContain(32)
  })

  it('snapping any target always lands on a selectable weight', () => {
    const st = resolveEquipment('Seated Cable Row').effectiveStack!
    const vals = new Set(enumerateStack(st))
    for (const target of [30, 33, 36, 40, 43, 48]) {
      expect(vals.has(snapToStack(st, target))).toBe(true)
    }
  })
})
