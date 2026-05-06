import { describe, expect, it } from 'vitest'
import { computeAteMacros } from './ate-macros'

describe('computeAteMacros', () => {
  it('returns null when there is no nutrition_per_100g', () => {
    expect(computeAteMacros({ nutrition_per_100g: null })).toBeNull()
    expect(computeAteMacros({ nutrition_per_100g: undefined })).toBeNull()
  })

  it('returns null when nutrition has no kcal', () => {
    expect(computeAteMacros({ nutrition_per_100g: { protein_g: 5 } })).toBeNull()
  })

  it('uses quantity_g first when it is positive', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 60, protein_g: 10 },
      quantity_g: 250,
      unit_size_g: 500,
      typical_size_g: 1000,
    })
    expect(r).toEqual({ kcal: 150, protein_g: 25, portion_g: 250 })
  })

  it('falls back to unit_size_g when quantity_g is missing', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 90, protein_g: 8 },
      unit_size_g: 200,
    })
    expect(r).toEqual({ kcal: 180, protein_g: 16, portion_g: 200 })
  })

  it('falls back to typical_size_g when unit_size_g is missing', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 50, protein_g: 4 },
      typical_size_g: 150,
    })
    expect(r).toEqual({ kcal: 75, protein_g: 6, portion_g: 150 })
  })

  it('defaults to 100g when nothing else is available', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 80, protein_g: 7 },
    })
    expect(r).toEqual({ kcal: 80, protein_g: 7, portion_g: 100 })
  })

  it('handles missing protein_g as zero', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 100 },
      quantity_g: 100,
    })
    expect(r).toEqual({ kcal: 100, protein_g: 0, portion_g: 100 })
  })

  it('skips zero/negative quantity_g and falls through', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 60, protein_g: 10 },
      quantity_g: 0,
      unit_size_g: 500,
    })
    expect(r?.portion_g).toBe(500)
  })

  it('rounds to integers (no decimals leaked into food log)', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 59, protein_g: 10.3 },
      quantity_g: 250,
    })
    // 59 × 2.5 = 147.5 → 148; 10.3 × 2.5 = 25.75 → 26
    expect(r).toEqual({ kcal: 148, protein_g: 26, portion_g: 250 })
  })

  it('typical greek yogurt — 150g of 59 kcal/100g', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 59, protein_g: 10.3 },
      quantity_g: 150,
    })
    expect(r?.kcal).toBe(89)
    expect(r?.protein_g).toBe(15)
  })

  it('typical chicken thigh portion — 200g of 177 kcal/100g', () => {
    const r = computeAteMacros({
      nutrition_per_100g: { kcal: 177, protein_g: 19.3 },
      quantity_g: 200,
    })
    expect(r?.kcal).toBe(354)
    expect(r?.protein_g).toBe(39)
  })
})
