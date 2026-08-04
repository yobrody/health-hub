import { describe, expect, it } from 'vitest'
import { isLikelyPackaged, sharedBrandToken } from './packaged-food'

describe('isLikelyPackaged', () => {
  it('flags the Tesco Chicken Club box (the real front-of-pack bug)', () => {
    // Sample 3 from the scan telemetry: a boxed supermarket sandwich, no label
    // read, that got confident-but-wrong macros (5g carbs for a sandwich).
    expect(isLikelyPackaged('Tesco The Chicken Club Beechwood Smoked Bacon')).toBe(true)
  })

  it('flags well-known packaged brands even without a retailer name', () => {
    expect(isLikelyPackaged('For Goodness Shakes Protein Chocolate')).toBe(true)
    expect(isLikelyPackaged('Grenade Carb Killa Caramel')).toBe(true)
    expect(isLikelyPackaged('Graham’s The Family Dairy Quark')).toBe(true)
  })

  it('flags other UK supermarket own-brands', () => {
    expect(isLikelyPackaged('Aldi Brooklea Greek Yogurt')).toBe(true)
    expect(isLikelyPackaged("Sainsbury's Basmati Rice")).toBe(true)
    expect(isLikelyPackaged('M&S Chicken Tikka')).toBe(true)
  })

  it('does NOT flag genuinely generic plated / whole foods', () => {
    // These are the honest AI-estimate cases — a plate of food or a whole fruit.
    expect(isLikelyPackaged('chicken breast')).toBe(false)
    expect(isLikelyPackaged('banana')).toBe(false)
    expect(isLikelyPackaged('bread roll')).toBe(false)
    expect(isLikelyPackaged('ketchup')).toBe(false)
    expect(isLikelyPackaged('brown rice')).toBe(false)
    expect(isLikelyPackaged('scrambled eggs')).toBe(false)
  })

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(isLikelyPackaged('  TESCO the chicken club  ')).toBe(true)
    expect(isLikelyPackaged('tesco')).toBe(true)
  })

  it('matches retailer tokens only as whole words (no false substring hits)', () => {
    // "coops" contains "coop" but shouldn't trip the retailer match; and a plain
    // food that happens to contain a brand substring must stay generic.
    expect(isLikelyPackaged('chicken coop eggs')).toBe(false)
    expect(isLikelyPackaged('aldente pasta')).toBe(false) // not "Aldi"
  })

  it('handles empty / non-string input safely', () => {
    expect(isLikelyPackaged('')).toBe(false)
    expect(isLikelyPackaged(undefined)).toBe(false)
    expect(isLikelyPackaged(null)).toBe(false)
  })
})

describe('sharedBrandToken', () => {
  it('confirms a short-brand match the keyword check would miss', () => {
    // "Pret" is 4 letters (survives the ≥4 filter) but "M&S"/"Co-op" would not,
    // so brand overlap is the reliable signal for those.
    expect(sharedBrandToken('M&S Chicken Tikka', 'Chicken Tikka Masala — M&S')).toBe(true)
    expect(sharedBrandToken('Co-op Meal Deal Wrap', 'Co-op Chicken Wrap')).toBe(true)
  })

  it('is false when the two strings share no known brand', () => {
    expect(sharedBrandToken('Tesco Chicken Club', 'Sainsbury’s Chicken Salad')).toBe(false)
    expect(sharedBrandToken('banana', 'apple')).toBe(false)
  })

  it('is false when neither string carries a brand at all', () => {
    expect(sharedBrandToken('chicken breast', 'grilled chicken')).toBe(false)
  })
})
