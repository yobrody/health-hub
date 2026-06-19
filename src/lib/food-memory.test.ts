import { describe, it, expect } from 'vitest'
import { normalizeKey, upsertFood, rankFoods, capFoods, type FoodMemoryItem } from './food-memory'

describe('normalizeKey', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeKey('  Greek   Yogurt ')).toBe('greek yogurt')
  })
})

describe('upsertFood', () => {
  it('adds a new item with count 1', () => {
    const out = upsertFood([], { name: 'Eggs', kcal: 140, protein_g: 12 }, 1000)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'eggs', name: 'Eggs', kcal: 140, protein_g: 12, count: 1, lastUsed: 1000 })
  })

  it('bumps count and refreshes recency for an existing item (case-insensitive)', () => {
    const a = upsertFood([], { name: 'Eggs', kcal: 140, protein_g: 12 }, 1000)
    const b = upsertFood(a, { name: 'eggs', kcal: 150, protein_g: 13 }, 2000)
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ count: 2, kcal: 150, protein_g: 13, lastUsed: 2000 })
  })

  it('keeps prior carbs/fat when a later log omits them', () => {
    const a = upsertFood([], { name: 'Toast', kcal: 90, protein_g: 3, carbs_g: 17, fat_g: 1 }, 1000)
    const b = upsertFood(a, { name: 'Toast', kcal: 95, protein_g: 3 }, 2000)
    expect(b[0].carbs_g).toBe(17)
    expect(b[0].fat_g).toBe(1)
  })

  it('ignores blank names and rounds/clamps macros', () => {
    expect(upsertFood([], { name: '   ', kcal: 100, protein_g: 5 }, 1000)).toHaveLength(0)
    const out = upsertFood([], { name: 'X', kcal: 100.7, protein_g: -3 }, 1000)
    expect(out[0]).toMatchObject({ kcal: 101, protein_g: 0 })
  })
})

describe('rankFoods', () => {
  const items: FoodMemoryItem[] = [
    { key: 'a', name: 'A', kcal: 1, protein_g: 0, count: 1, lastUsed: 50 },
    { key: 'b', name: 'B', kcal: 1, protein_g: 0, count: 5, lastUsed: 10 },
    { key: 'c', name: 'C', kcal: 1, protein_g: 0, count: 5, lastUsed: 90 },
  ]
  it('orders by count desc, then recency desc', () => {
    expect(rankFoods(items).map(i => i.key)).toEqual(['c', 'b', 'a'])
  })
  it('applies a limit', () => {
    expect(rankFoods(items, { limit: 1 }).map(i => i.key)).toEqual(['c'])
  })
  it('filters by substring query', () => {
    expect(rankFoods(items, { query: 'B' }).map(i => i.key)).toEqual(['b'])
  })
})

describe('capFoods', () => {
  it('keeps the top-ranked items when over cap', () => {
    const items: FoodMemoryItem[] = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`, name: `k${i}`, kcal: 1, protein_g: 0, count: i, lastUsed: i,
    }))
    const out = capFoods(items, 2)
    expect(out).toHaveLength(2)
    expect(out.map(i => i.count)).toEqual([4, 3]) // highest-count survive
  })
  it('returns input unchanged when under cap', () => {
    const items: FoodMemoryItem[] = [{ key: 'a', name: 'A', kcal: 1, protein_g: 0, count: 1, lastUsed: 1 }]
    expect(capFoods(items, 10)).toBe(items)
  })
})
