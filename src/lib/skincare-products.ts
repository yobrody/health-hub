// Skincare product inventory: tracks bottle size + daily usage so the user gets
// a "running low" warning before they actually run out, and a one-tap deep-link
// to reorder from a saved Amazon URL.
//
// Storage is localStorage (matches the existing `skincare_log` pattern) — keyed
// per device for now. Sync via FastAPI is a follow-up.

export type StepId = 'cleanse' | 'moisturize' | 'spf' | 'treat'

export type Product = {
  id: string
  step_id: StepId
  name: string
  /** Bottle size in mL when full (the size from the receipt). */
  bottle_size_ml: number
  /** mL used per single application (one AM use OR one PM use). */
  daily_usage_ml: number
  /** mL currently remaining. Decremented on each step completion. */
  remaining_ml: number
  /** Optional saved product URL — used as the reorder deep-link target. */
  amazon_url?: string
  /** ISO datetime the product was added. */
  added: string
}

export const LS_PRODUCTS_KEY = 'skincare_products'

const VALID_STEPS: ReadonlySet<StepId> = new Set(['cleanse', 'moisturize', 'spf', 'treat'])

function isProduct(p: unknown): p is Product {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.step_id === 'string' &&
    VALID_STEPS.has(o.step_id as StepId) &&
    typeof o.name === 'string' &&
    typeof o.bottle_size_ml === 'number' &&
    typeof o.daily_usage_ml === 'number' &&
    typeof o.remaining_ml === 'number' &&
    typeof o.added === 'string'
  )
}

export function loadProducts(storage: Pick<Storage, 'getItem'>): Product[] {
  try {
    const raw = storage.getItem(LS_PRODUCTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isProduct)
  } catch {
    return []
  }
}

export function saveProducts(storage: Pick<Storage, 'setItem'>, products: Product[]): void {
  try {
    storage.setItem(LS_PRODUCTS_KEY, JSON.stringify(products))
  } catch {
    /* quota / access — silently drop, the next save will retry */
  }
}

/**
 * Active product for a step = the most recently-added product for that step.
 * (Multiple products per step is allowed — e.g. a finishing-up old bottle and
 * the new one — but only the newest gets decremented on completion.)
 */
export function getActiveProduct(products: Product[], stepId: StepId): Product | null {
  const forStep = products.filter(p => p.step_id === stepId)
  if (forStep.length === 0) return null
  // Most recent first (added is ISO datetime, lexicographically sortable).
  return [...forStep].sort((a, b) => b.added.localeCompare(a.added))[0]
}

/** Returns a new array with the named product's `remaining_ml` reduced by `ml`,
 *  clamped at 0. Other products are returned unchanged. Returns the same array
 *  reference (safely) if the productId isn't present, so callers can no-op. */
export function decrementProduct(
  products: Product[],
  productId: string,
  ml: number,
): Product[] {
  if (ml <= 0) return products
  let mutated = false
  const next = products.map(p => {
    if (p.id !== productId) return p
    mutated = true
    return { ...p, remaining_ml: Math.max(0, p.remaining_ml - ml) }
  })
  return mutated ? next : products
}

/** Estimated days remaining at the current pace. Returns Infinity when the
 *  product reports zero daily usage (config error — surface big number not NaN). */
export function daysRemaining(product: Product): number {
  if (product.daily_usage_ml <= 0) return Infinity
  return product.remaining_ml / product.daily_usage_ml
}

/** "Running low" = ≤ 14 days at current pace by default. Tunable. */
export function isLowStock(product: Product, thresholdDays = 14): boolean {
  return daysRemaining(product) <= thresholdDays
}

/** All products across all steps that are currently below the threshold. Used
 *  by Today.tsx to surface a unified "running low" banner. */
export function lowStockProducts(products: Product[], thresholdDays = 14): Product[] {
  return products.filter(p => isLowStock(p, thresholdDays))
}

/**
 * Build an Amazon search URL for a product when no saved URL exists. The user
 * can override per-product via `amazon_url` (paste once, used forever). This
 * fallback uses amazon.co.uk because the user is UK-based — change DEFAULT_TLD
 * if that ever stops being true.
 */
const DEFAULT_TLD = 'co.uk'

export function reorderUrl(product: Product): string {
  if (product.amazon_url && product.amazon_url.trim()) return product.amazon_url.trim()
  const q = encodeURIComponent(product.name)
  return `https://www.amazon.${DEFAULT_TLD}/s?k=${q}`
}

/** Generate a short id when adding a product. Random + timestamp to avoid
 *  collisions across same-second adds. */
export function generateProductId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
