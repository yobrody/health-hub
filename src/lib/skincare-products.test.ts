import { beforeEach, describe, expect, it } from 'vitest'
import {
  daysRemaining,
  decrementProduct,
  generateProductId,
  getActiveProduct,
  isLowStock,
  loadProducts,
  lowStockProducts,
  LS_PRODUCTS_KEY,
  reorderUrl,
  saveProducts,
  type Product,
} from './skincare-products'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  raw(key: string) { return this.map.get(key) }
}

const productFixture = (overrides: Partial<Product> = {}): Product => ({
  id: 'p_test',
  step_id: 'moisturize',
  name: 'CeraVe AM',
  bottle_size_ml: 89,
  daily_usage_ml: 1.5,
  remaining_ml: 89,
  added: '2026-04-01T00:00:00Z',
  ...overrides,
})

describe('skincare-products', () => {
  let storage: MemoryStorage

  beforeEach(() => { storage = new MemoryStorage() })

  describe('loadProducts', () => {
    it('returns empty array when no key set', () => {
      expect(loadProducts(storage)).toEqual([])
    })

    it('parses a stored array', () => {
      const products = [productFixture()]
      storage.setItem(LS_PRODUCTS_KEY, JSON.stringify(products))
      expect(loadProducts(storage)).toEqual(products)
    })

    it('returns empty when stored value is corrupt JSON', () => {
      storage.setItem(LS_PRODUCTS_KEY, '{not[json')
      expect(loadProducts(storage)).toEqual([])
    })

    it('returns empty when stored value is not an array', () => {
      storage.setItem(LS_PRODUCTS_KEY, JSON.stringify({ p_x: productFixture() }))
      expect(loadProducts(storage)).toEqual([])
    })

    it('filters out invalid entries while keeping valid ones', () => {
      storage.setItem(LS_PRODUCTS_KEY, JSON.stringify([
        productFixture(),
        { not: 'a product' },
        { ...productFixture(), step_id: 'unknown' }, // bad step
        { ...productFixture(), bottle_size_ml: 'huge' }, // bad type
      ]))
      expect(loadProducts(storage)).toHaveLength(1)
    })
  })

  describe('saveProducts', () => {
    it('serializes the array under the canonical key', () => {
      saveProducts(storage, [productFixture()])
      expect(JSON.parse(storage.raw(LS_PRODUCTS_KEY) ?? '[]')).toHaveLength(1)
    })
  })

  describe('getActiveProduct', () => {
    it('returns null when no products for the step', () => {
      expect(getActiveProduct([], 'moisturize')).toBeNull()
      expect(getActiveProduct([productFixture({ step_id: 'spf' })], 'moisturize')).toBeNull()
    })

    it('returns the most recently-added product for the step', () => {
      const old = productFixture({ id: 'old', added: '2026-01-01T00:00:00Z' })
      const newer = productFixture({ id: 'newer', added: '2026-04-01T00:00:00Z' })
      const newest = productFixture({ id: 'newest', added: '2026-05-01T00:00:00Z' })
      const out = getActiveProduct([old, newer, newest], 'moisturize')
      expect(out?.id).toBe('newest')
    })

    it('ignores products of other steps', () => {
      const moist = productFixture({ id: 'moist', step_id: 'moisturize' })
      const spf = productFixture({ id: 'spf', step_id: 'spf', added: '2030-01-01T00:00:00Z' })
      expect(getActiveProduct([moist, spf], 'moisturize')?.id).toBe('moist')
    })
  })

  describe('decrementProduct', () => {
    it('decrements the named product by ml', () => {
      const p = productFixture({ remaining_ml: 89 })
      const out = decrementProduct([p], p.id, 2)
      expect(out[0].remaining_ml).toBe(87)
    })

    it('clamps at 0, never negative', () => {
      const p = productFixture({ remaining_ml: 1 })
      expect(decrementProduct([p], p.id, 5)[0].remaining_ml).toBe(0)
    })

    it('returns the same array reference if productId not found', () => {
      const products = [productFixture()]
      expect(decrementProduct(products, 'missing', 1)).toBe(products)
    })

    it('no-ops on zero or negative ml without mutating', () => {
      const products = [productFixture({ remaining_ml: 50 })]
      expect(decrementProduct(products, 'p_test', 0)).toBe(products)
      expect(decrementProduct(products, 'p_test', -10)).toBe(products)
    })

    it('does not mutate the input array', () => {
      const before: Product[] = [productFixture({ remaining_ml: 100 })]
      decrementProduct(before, 'p_test', 5)
      expect(before[0].remaining_ml).toBe(100)
    })
  })

  describe('daysRemaining', () => {
    it('returns mL / daily for normal usage', () => {
      expect(daysRemaining(productFixture({ remaining_ml: 30, daily_usage_ml: 1.5 }))).toBe(20)
    })
    it('returns 0 when empty', () => {
      expect(daysRemaining(productFixture({ remaining_ml: 0, daily_usage_ml: 1.5 }))).toBe(0)
    })
    it('returns Infinity when daily_usage_ml is zero (config error)', () => {
      expect(daysRemaining(productFixture({ daily_usage_ml: 0 }))).toBe(Infinity)
    })
  })

  describe('isLowStock', () => {
    it('returns true when ≤ 14 days remain at default threshold', () => {
      expect(isLowStock(productFixture({ remaining_ml: 21, daily_usage_ml: 1.5 }))).toBe(true)
    })
    it('returns false when > 14 days remain', () => {
      expect(isLowStock(productFixture({ remaining_ml: 30, daily_usage_ml: 1.5 }))).toBe(false)
    })
    it('respects custom threshold', () => {
      expect(isLowStock(productFixture({ remaining_ml: 30, daily_usage_ml: 1.5 }), 25)).toBe(true)
    })
    it('returns false for products with 0 daily usage (config error — Infinity > anything)', () => {
      expect(isLowStock(productFixture({ daily_usage_ml: 0 }))).toBe(false)
    })
  })

  describe('lowStockProducts', () => {
    it('filters down to low-stock products only', () => {
      const products = [
        productFixture({ id: 'a', remaining_ml: 5 }),  // low
        productFixture({ id: 'b', remaining_ml: 89 }), // fine
        productFixture({ id: 'c', remaining_ml: 21 }), // low at 1.5/day → 14 days exactly
      ]
      const low = lowStockProducts(products)
      expect(low.map(p => p.id)).toEqual(['a', 'c'])
    })
  })

  describe('reorderUrl', () => {
    it('uses saved amazon_url when present', () => {
      const url = 'https://www.amazon.co.uk/dp/B07ABC123'
      expect(reorderUrl(productFixture({ amazon_url: url }))).toBe(url)
    })
    it('trims whitespace on saved url', () => {
      expect(reorderUrl(productFixture({ amazon_url: '  https://x.com  ' }))).toBe('https://x.com')
    })
    it('falls back to amazon.co.uk search by name when no url saved', () => {
      const url = reorderUrl(productFixture({ name: 'CeraVe AM' }))
      expect(url).toBe('https://www.amazon.co.uk/s?k=CeraVe%20AM')
    })
    it('treats empty/whitespace amazon_url as missing', () => {
      const url = reorderUrl(productFixture({ name: 'Foo', amazon_url: '   ' }))
      expect(url.startsWith('https://www.amazon.co.uk/s?k=')).toBe(true)
    })
  })

  describe('generateProductId', () => {
    it('returns a string starting with p_', () => {
      expect(generateProductId()).toMatch(/^p_[a-z0-9_]+$/)
    })
    it('returns different ids on subsequent calls', () => {
      const ids = new Set([generateProductId(), generateProductId(), generateProductId()])
      expect(ids.size).toBe(3)
    })
  })
})
