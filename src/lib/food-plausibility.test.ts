import { describe, expect, it } from 'vitest'
import { checkFoodPlausibility } from './food-plausibility'

describe('checkFoodPlausibility', () => {
  it('flags the 702 kcal / 54g protein scrambled-eggs hallucination', () => {
    // The real motivating bug: 3 scrambled eggs logged as 702/54 (should be ~234/19).
    const r = checkFoodPlausibility({ kcal: 702, protein_g: 54, description: '3 scrambled eggs' })
    expect(r.ok).toBe(false)
    expect(r.warnings.length).toBeGreaterThanOrEqual(1)
    // 54g protein > 50g ceiling should trip the outlier check.
    expect(r.warnings.some(w => w.includes('lot of protein'))).toBe(true)
  })

  it('passes a correct 3-egg estimate (234 kcal / 19g protein / 1g carb / 16g fat)', () => {
    const r = checkFoodPlausibility({ kcal: 234, protein_g: 19, carbs_g: 1, fat_g: 16 })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('flags protein exceeding total calories', () => {
    // 30g protein = 120 kcal of protein alone, but only 90 kcal stated.
    const r = checkFoodPlausibility({ kcal: 90, protein_g: 30 })
    expect(r.ok).toBe(false)
    expect(r.warnings.some(w => w.includes('Protein exceeds total calories'))).toBe(true)
  })

  it('flags an Atwater mismatch when macros do not line up with kcal', () => {
    // Macros imply 4*10 + 4*10 + 9*10 = 170 kcal, but 500 is stated.
    const r = checkFoodPlausibility({ kcal: 500, protein_g: 10, carbs_g: 10, fat_g: 10 })
    expect(r.ok).toBe(false)
    expect(r.warnings.some(w => w.includes("don't line up"))).toBe(true)
  })

  it('skips the Atwater check when carbs/fat are missing (no false positive)', () => {
    // 234 kcal with only protein known — derived total can't be computed, so
    // the Atwater check must not fire.
    const r = checkFoodPlausibility({ kcal: 234, protein_g: 19 })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('flags unusually high calories for a single item', () => {
    const r = checkFoodPlausibility({ kcal: 1500, protein_g: 40 })
    expect(r.ok).toBe(false)
    expect(r.warnings.some(w => w.includes('Unusually high calories'))).toBe(true)
  })

  it('does not throw or warn on NaN / undefined macros', () => {
    const r = checkFoodPlausibility({ kcal: NaN, protein_g: undefined, carbs_g: undefined, fat_g: undefined })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('allows a large but consistent meal within Atwater tolerance', () => {
    // 4*40 + 4*60 + 9*30 = 670; stated 680 — within max(60, 680*0.35) slack.
    const r = checkFoodPlausibility({ kcal: 680, protein_g: 40, carbs_g: 60, fat_g: 30 })
    expect(r.ok).toBe(true)
  })
})
