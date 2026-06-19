// Personal food memory — the core of "the app gets smarter as you log".
// Every food log (manual, AI, …) upserts a record here keyed by the food's
// normalized name, storing your macros + how often/recently you log it. The
// "Your usual" one-tap chips read this back, ranked, so re-logging a familiar
// food is instant and uses YOUR numbers (no AI guess). Pure list ops are
// unit-tested; persistence is a thin localStorage layer on top.

export interface FoodMemoryItem {
  key: string          // normalized name (dedup key)
  name: string         // display name (as last logged)
  kcal: number
  protein_g: number
  carbs_g?: number
  fat_g?: number
  count: number        // times logged — drives ranking
  lastUsed: number     // ms epoch — recency tiebreak
}

export interface RememberInput {
  name: string
  kcal: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
}

export const MEMORY_CAP = 200
const STORAGE_KEY = 'food_memory_v1'

export function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ── Pure list ops (unit-tested) ─────────────────────────────────────────────

/** Insert or update a food by normalized name. Existing → bump count, refresh
 *  recency, take the latest macros (your most recent value wins), but keep a
 *  previously-known carb/fat if the new log omits them. */
export function upsertFood(items: FoodMemoryItem[], input: RememberInput, now: number): FoodMemoryItem[] {
  const key = normalizeKey(input.name)
  if (!key) return items
  const next: FoodMemoryItem = {
    key,
    name: input.name.trim(),
    kcal: Math.max(0, Math.round(input.kcal || 0)),
    protein_g: Math.max(0, Math.round(input.protein_g ?? 0)),
    carbs_g: input.carbs_g != null ? Math.max(0, Math.round(input.carbs_g)) : undefined,
    fat_g: input.fat_g != null ? Math.max(0, Math.round(input.fat_g)) : undefined,
    count: 1,
    lastUsed: now,
  }
  const idx = items.findIndex(i => i.key === key)
  if (idx === -1) return [...items, next]
  const prev = items[idx]
  const merged: FoodMemoryItem = {
    ...next,
    count: prev.count + 1,
    carbs_g: next.carbs_g ?? prev.carbs_g,
    fat_g: next.fat_g ?? prev.fat_g,
  }
  const out = items.slice()
  out[idx] = merged
  return out
}

/** Rank by frequency, then recency. Optional substring `query` and `limit`. */
export function rankFoods(items: FoodMemoryItem[], opts: { query?: string; limit?: number } = {}): FoodMemoryItem[] {
  const q = opts.query ? normalizeKey(opts.query) : ''
  const filtered = q ? items.filter(i => i.key.includes(q)) : items
  const sorted = [...filtered].sort((a, b) => (b.count - a.count) || (b.lastUsed - a.lastUsed))
  return typeof opts.limit === 'number' ? sorted.slice(0, opts.limit) : sorted
}

/** Keep only the top `cap` items by rank when the store grows too large. */
export function capFoods(items: FoodMemoryItem[], cap: number = MEMORY_CAP): FoodMemoryItem[] {
  return items.length <= cap ? items : rankFoods(items, { limit: cap })
}

// ── localStorage-backed persistence + one-time legacy migration ─────────────

function load(): FoodMemoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function save(items: FoodMemoryItem[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { /* quota */ }
}

let migrationChecked = false
/** Seed the store once from the legacy `recent_foods` list so existing users
 *  keep their history. Runs only when the new store is still empty. */
function migrateLegacyOnce(items: FoodMemoryItem[]): FoodMemoryItem[] {
  if (migrationChecked || items.length > 0) { migrationChecked = true; return items }
  migrationChecked = true
  try {
    const raw = localStorage.getItem('recent_foods')
    if (!raw) return items
    const legacy = JSON.parse(raw) as Array<{ desc?: string; kcal?: number; protein_g?: number }>
    if (!Array.isArray(legacy) || legacy.length === 0) return items
    let acc: FoodMemoryItem[] = []
    const now = Date.now()
    // Reverse so the oldest is applied first and recency ordering stays sane.
    for (const l of [...legacy].reverse()) {
      if (l?.desc) acc = upsertFood(acc, { name: l.desc, kcal: l.kcal ?? 0, protein_g: l.protein_g ?? 0 }, now)
    }
    save(acc)
    return acc
  } catch { return items }
}

/** Record a logged food. Safe to call from any log path; never throws. */
export function rememberFood(input: RememberInput): void {
  try {
    let items = migrateLegacyOnce(load())
    items = capFoods(upsertFood(items, input, Date.now()))
    save(items)
  } catch { /* non-fatal */ }
}

/** Ranked "your usual" foods for one-tap re-logging. */
export function getUsualFoods(opts: { query?: string; limit?: number } = {}): FoodMemoryItem[] {
  return rankFoods(migrateLegacyOnce(load()), opts)
}
