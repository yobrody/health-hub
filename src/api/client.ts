// Default to same-origin Pages Functions: keeps secrets server-side.
import { showToast } from '../toast'
import { addItem, bumpTries, dropExpired, loadOutbox, saveOutbox, newId, replayQueue, type OutboxItem } from '../lib/outbox'

// For local debugging you can still set VITE_API_BASE to an absolute URL.
const BASE = import.meta.env.VITE_API_BASE || '/api'
const KEY: string | undefined = import.meta.env.VITE_API_KEY || undefined

// ── Backend connectivity tracking ──────────────────────────────────────────
// Passive: every API call reports reachability. A thrown fetch (network down /
// server unreachable) flips us to 'offline'; a 5xx to 'degraded'; any response
// (including 4xx) means the server is reachable → 'online'. <ConnectionBanner>
// subscribes so the user always knows when their data may be stale.
export type ConnStatus = 'online' | 'offline' | 'degraded'
let _conn: ConnStatus = 'online'
const _connSubs = new Set<(s: ConnStatus) => void>()
export function getConnStatus(): ConnStatus { return _conn }
export function subscribeConn(fn: (s: ConnStatus) => void): () => void {
  _connSubs.add(fn)
  return () => { _connSubs.delete(fn) }
}
function setConn(s: ConnStatus) {
  if (s === _conn) return
  _conn = s
  for (const fn of _connSubs) { try { fn(s) } catch { /* ignore subscriber errors */ } }
}
// Active recovery probe — the banner calls this while we're not 'online' so it
// clears itself the instant the server returns. Any HTTP response means
// reachable; a thrown fetch means still down.
export async function probeBackend(): Promise<boolean> {
  try {
    await fetch(`${BASE}/today`, { method: 'HEAD', cache: 'no-store' })
    setConn('online')
    void flushOutbox() // we're back — drain anything captured while offline
    return true
  } catch {
    setConn('offline')
    return false
  }
}

// ── Offline outbox ──────────────────────────────────────────────────────────
// A mutating call that can't reach the server is captured and replayed on
// reconnect, so a log is never lost on a flaky connection. Callers opt a method
// in by passing `queueLabel` to request(); on a network failure that request is
// enqueued and a QueuedError is thrown (callers handle it like any failure, but
// the data is now safe). The banner reads the pending count via subscribeOutbox.
export class QueuedError extends Error {
  readonly queued = true
  constructor() { super('Saved offline — will sync when you reconnect.') }
}
export function isQueuedError(e: unknown): boolean { return e instanceof QueuedError }

let _outbox: OutboxItem[] = loadOutbox()
const _outboxSubs = new Set<(items: OutboxItem[]) => void>()
export function getOutbox(): OutboxItem[] { return _outbox }
export function getOutboxCount(): number { return _outbox.length }
export function subscribeOutbox(fn: (items: OutboxItem[]) => void): () => void {
  _outboxSubs.add(fn)
  return () => { _outboxSubs.delete(fn) }
}
function commitOutbox(next: OutboxItem[]) {
  _outbox = next
  saveOutbox(_outbox)
  for (const fn of _outboxSubs) { try { fn(_outbox) } catch { /* ignore */ } }
}

let _flushing = false
// Replay queued mutations in order. Stops at the first network failure (still
// offline); server-rejected items get a try bumped and are dropped once they
// exceed MAX_TRIES so they can't wedge the queue.
export async function flushOutbox(): Promise<number> {
  if (_flushing || _outbox.length === 0) return 0
  _flushing = true
  let synced = 0
  try {
    const outcome = await replayQueue(
      _outbox,
      it => request<unknown>(it.path, { method: it.method, body: it.body }).then(() => undefined),
      e => e instanceof QueuedError || isNetworkError(e),
    )
    // Rebuild from the *current* queue (not the snapshot) so writes enqueued
    // mid-flush survive: drop the synced ids, bump the rejected ones, prune.
    let next = _outbox.filter(i => !outcome.syncedIds.includes(i.id))
    for (const id of outcome.bumpedIds) next = bumpTries(next, id)
    commitOutbox(dropExpired(next))
    synced = outcome.syncedIds.length
  } finally {
    _flushing = false
  }
  if (synced > 0) {
    showToast(`Synced ${synced} change${synced > 1 ? 's' : ''}`, 'ok')
    // Nudge listening pages (Today, Nutrition, …) to refresh now that the
    // queued writes landed.
    try { window.dispatchEvent(new CustomEvent('data-synced')) } catch { /* non-DOM env */ }
  }
  return synced
}

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /network|fetch|Failed to fetch/i.test(e.message))
}

// Gateway / timeout statuses that mean "the write never reached or completed at
// the origin" — safe to queue and replay (this is the 522 the proxy returns
// when Cloudflare can't reach the VPS). We deliberately do NOT queue 500 (the
// origin may have partially processed) or 4xx (a real client error).
const TRANSIENT_STATUS = new Set([408, 502, 503, 504, 522, 524])

function enqueueWrite(path: string, method: string, body: string | undefined, label: string) {
  // Dedup: don't enqueue an identical pending write twice (an impatient
  // double-tap, or the same blip hit on a retry).
  const dup = _outbox.some(i => i.path === path && i.method === method && i.body === body)
  if (!dup) commitOutbox(addItem(_outbox, { id: newId(), path, method, body, label, ts: Date.now(), tries: 0 }))
}

type ReqOpts = RequestInit & { queueLabel?: string }

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const h = new Headers(opts.headers)
  // Only attach the key when explicitly configured (e.g. direct-to-VPS debugging).
  if (KEY) h.set('X-Health-Key', KEY)
  if (!h.has('Content-Type')) h.set('Content-Type', 'application/json')

  const method = opts.method || 'GET'
  const body = typeof opts.body === 'string' ? opts.body : undefined

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers: h })
  } catch (e) {
    setConn('offline') // network error / server unreachable
    if (opts.queueLabel) { enqueueWrite(path, method, body, opts.queueLabel); throw new QueuedError() }
    throw e
  }
  setConn(res.status >= 500 ? 'degraded' : 'online') // any response = reachable
  if (!res.ok) {
    // A transient gateway blip on a queueable write → capture & replay instead
    // of losing it (the 522/timeout case from the proxy hop).
    if (opts.queueLabel && TRANSIENT_STATUS.has(res.status)) {
      enqueueWrite(path, method, body, opts.queueLabel)
      throw new QueuedError()
    }
    throw new Error(`API error ${res.status}: ${await res.text()}`)
  }
  // Opportunistic drain: any successful call means we're back — replay pending.
  if (!_flushing && _outbox.length > 0) void flushOutbox()
  return res.json()
}

// Some VPS endpoints wrap arrays as { value: T[], Count: N }
function unwrap<T>(r: T[] | { value: T[] }): T[] {
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object' && 'value' in r && Array.isArray((r as { value: T[] }).value))
    return (r as { value: T[] }).value
  return []
}

// Convert File to base64 string (data-URL strip)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult | null> {
  const apiUrl = import.meta.env.VITE_BARCODE_API_URL
  const apiKey = import.meta.env.VITE_BARCODE_API_KEY

  // Paid provider path (configurable). Expected response:
  // { name: string, kcal?: number, protein_g?: number, carbs_g?: number, fat_g?: number }
  if (apiUrl && apiKey) {
    try {
      const res = await fetch(`${apiUrl}?barcode=${encodeURIComponent(barcode)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (res.ok) {
        const data = await res.json() as BarcodeLookupResult
        if (data?.name) return data
      }
    } catch { /* paid provider unreachable; fall through to OpenFoodFacts */ }
  }

  // Fallback for development/demo.
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    const data = await res.json()
    if (data.status === 1 && data.product) {
      const p = data.product
      const name: string = p.product_name_en || p.product_name || `Product ${barcode}`
      const kcal100: number | null = p.nutriments?.['energy-kcal_100g']
        ?? (p.nutriments?.energy_100g ? p.nutriments.energy_100g / 4.184 : null)
      const servingG = parseFloat(p.serving_quantity) || 100
      const kcal = kcal100 ? Math.round(kcal100 * servingG / 100) : undefined
      // 200px image. Prefer image_small_url (200px); fall back to front_small or thumb.
      const image_url: string | undefined =
        p.image_small_url || p.image_front_small_url || p.image_thumb_url || undefined
      return { name, kcal, image_url }
    }
  } catch { /* OpenFoodFacts unreachable; barcode lookup unavailable */ }

  return null
}

export const api = {
  // Today
  getToday: () => request<TodayData>('/today'),

  // Food
  addFood: (entry: FoodEntryInput) => request('/food', { method: 'POST', body: JSON.stringify(entry), queueLabel: 'food' }),
  // date lets past-day entries be deleted (backend always supported it but the
  // client never sent it); description disambiguates two same-minute entries.
  deleteFood: (time: string, meal: string, opts?: { date?: string; description?: string }) =>
    request('/food/delete', { method: 'POST', body: JSON.stringify({ time, meal, ...opts }) }),
  recalculateFood: (name: string, original_name: string) =>
    request<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number | null; confidence: string; note: string }>(
      '/food/recalculate', { method: 'POST', body: JSON.stringify({ name, original_name }) }
    ),
  /** Per-item food history. /today ignores its date param and /timeline
   * collapses a day to a meal count, so neither can answer what was actually
   * eaten over a fortnight. */
  getFoodLog: (days = 14) =>
    request<{ days: number; count: number; entries: FoodLogRow[] }>(`/food/log?days=${days}`),

  getFoodHistory: (days = 7) =>
    request<HistoryDay[] | { value: HistoryDay[] }>(`/food/history?days=${days}`).then(unwrap),

  // Fridge
  getFridge: () => request<FridgeData>('/fridge'),
  addFridgeItem: (name: string, section: string, meta?: AddFridgeItemMeta) =>
    request('/fridge/item', { method: 'POST', body: JSON.stringify({ name, section, ...meta }) }),
  // Default exact-match (case-insensitive). Pass contains=true to fall back
  // to substring match when the user-facing name might differ from storage
  // (whitespace, weird casing). The substring path can nuke multiple rows
  // — only used as a fallback after exact returned 404.
  removeFridgeItem: (name: string, opts?: { contains?: boolean }) =>
    request(`/fridge/item/${encodeURIComponent(name)}${opts?.contains ? '?contains=true' : ''}`, { method: 'DELETE' }),
  // Atomic decrement of a fridge item's remaining grams or count. Used when a
  // Home meal is logged via camera so the fridge inventory stays current.
  consumeFridgeItem: (name: string, input: { grams?: number; count?: number }) =>
    request<{ ok: boolean; name: string; section: string; quantity_g: number | null; quantity_count: number | null }>(
      `/fridge/item/${encodeURIComponent(name)}/consume`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  scanReceipt: async (file: File): Promise<ScanResult> => {
    const image = await fileToBase64(file)
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (KEY) headers.set('X-Health-Key', KEY)
    const res = await fetch(`${BASE}/fridge/scan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image, mimeType: file.type || 'image/jpeg' }),
    })
    if (!res.ok) throw new Error(`Scan failed: ${res.status}`)
    return res.json()
  },

  // Smart food log — natural language to AI nutrition estimate.
  // The estimator honours cooking method / portion stated in the free text, so
  // callers augment `description` (e.g. ", cooked in 1 tbsp sunflower oil") to
  // re-estimate. It returns the assumptions it made in portion_detail /
  // confidence_reason so the UI can surface them before logging.
  smartFoodLog: async (description: string): Promise<SmartFoodResult> => {
    const r = await fetch(`${BASE}/food/smart`, {
      method: 'POST',
      headers: (() => { const h = new Headers({ 'Content-Type': 'application/json' }); if (KEY) h.set('X-Health-Key', KEY); return h })(),
      body: JSON.stringify({ description }),
    })
    if (!r.ok) throw new Error(`Smart food failed: ${r.status}`)
    return r.json() as Promise<SmartFoodResult>
  },

  // AI meals — cheap listing of names + kcal estimates
  // Natural-language assistant. Type one freeform line ("3 eggs and bacon
  // and a can of pineapple from Aldi"); Gemini parses it into structured
  // log_food + add_fridge actions. Frontend displays the summary + action
  // count, then executes each action via existing endpoints on confirm.
  parseAct: (prompt: string) =>
    request<AiActResponse>('/ai/act', { method: 'POST', body: JSON.stringify({ prompt }) }),

  // Reverse macro solver. Pass the day's remaining targets so the coach fits
  // portions to what's left (protein-prioritised). Returns a plan + log actions.
  coachSolve: (prompt: string, remaining: { kcal: number; protein_g: number }) =>
    request<CoachResponse>('/ai/coach', { method: 'POST', body: JSON.stringify({ prompt, remaining }) }),

  // Shopping-list notepad per-item intelligence: OFF product + photo + stores.
  shopLookup: (q: string) =>
    request<ShopLookupResult>(`/shop/lookup?q=${encodeURIComponent(q)}`),

  // Gym coach — one endpoint, two kinds (machine-question, workout-summary).
  gymCoachMachine: (question: string, knownEquipment: string[]) =>
    request<GymCoachMachineResponse>('/ai/gym-coach', { method: 'POST', body: JSON.stringify({ kind: 'machine-question', question, knownEquipment }) }),
  gymCoachSummary: (analysis: unknown, weeklyVolume: unknown) =>
    request<GymCoachSummaryResponse>('/ai/gym-coach', { method: 'POST', body: JSON.stringify({ kind: 'workout-summary', analysis, weeklyVolume }) }),

  // Parse a freeform pasted routine (ChatGPT/website/notes) into structured exercises.
  parseRoutine: (text: string) =>
    request<ParsedRoutine>('/ai/parse-routine', { method: 'POST', body: JSON.stringify({ text }) }),

  /** Freeform description of a FINISHED session -> logged sets. */
  parseSession: (text: string, known?: string[]) =>
    request<ParsedSession>('/ai/parse-session', { method: 'POST', body: JSON.stringify({ text, known }) }),

  getMealSuggestions: () => request<{ meals: Meal[] }>('/ai/meals', { method: 'POST' }),
  // Detailed recipe + full macros for a single meal idea. Called on tap-to-expand
  // so we don't pay the recipe-generation token cost for ideas the user ignores.
  getMealDetail: (name: string, ingredients: string[]) =>
    request<MealDetail>('/ai/meal-detail', { method: 'POST', body: JSON.stringify({ name, ingredients }) }),

  // Meal planning — full day plan for tomorrow
  generateMealPlan: (opts?: { target_kcal?: number; target_protein?: number; swap?: string; existing_plan?: PlannedMeal[] }) =>
    request<MealPlanResponse | { meal: PlannedMeal }>('/ai/meal-plan', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  getMealPlan: (planDate: string) =>
    request<MealPlanResponse>(`/ai/meal-plan/${planDate}`),
  useMealPlan: (planDate: string, meals: PlannedMeal[]) =>
    request<{ ok: boolean; date: string; meals_added: number }>('/ai/meal-plan/use', { method: 'POST', body: JSON.stringify({ date: planDate, meals }) }),

  // Multi-item food photo analysis. Mode = "home" cross-references the user's
  // fridge inventory and returns per-item grams_used for depletion. Mode = "out"
  // skips the fridge entirely — used for restaurant / takeaway / unknown meals.
  analyzeFoodV2: async (
    file: File,
    fridgeData: FridgeData | null,
    description = '',
    mode: 'home' | 'out' = 'home',
  ): Promise<FoodAnalysisV2> => {
    const image = await fileToBase64(file)
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (KEY) headers.set('X-Health-Key', KEY)
    const res = await fetch(`${BASE}/ai/analyze-food`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image,
        mimeType: file.type || 'image/jpeg',
        description,
        mode,
        // Only ship the fridge payload when the user opted into home mode —
        // saves bytes and stops the model getting confused on an out meal.
        fridge: mode === 'home' ? fridgeData : null,
      }),
    })
    if (!res.ok) throw new Error(`AI error: ${res.status}`)
    return res.json()
  },

  // Scan self-improvement telemetry: fire-and-forget a thumbnail + the result
  // the app produced, so a periodic review can spot scanner mistakes without
  // the user reporting anything. Best-effort — never blocks or throws.
  logScanSample: (thumb: string, type: string, result: unknown): void => {
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (KEY) headers.set('X-Health-Key', KEY)
      void fetch(`${BASE}/scan-samples`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ thumb, type, result }),
        keepalive: true,
      }).catch(() => { /* telemetry is best-effort */ })
    } catch { /* never let telemetry break a scan */ }
  },

  // Upload photo thumbnail to R2, returns permanent URL
  uploadPhoto: async (dataUrl: string, mime = 'image/jpeg'): Promise<string> => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (KEY) headers.set('X-Health-Key', KEY)
    const res = await fetch(`${BASE}/photos/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: dataUrl, mime }),
    })
    if (!res.ok) throw new Error(`Photo upload failed: ${res.status}`)
    const { url } = await res.json() as { key: string; url: string }
    return url
  },

  // Log fridge item usage to Airtable + KV
  logFridgeUsage: (input: UsageLogInput) =>
    request<{ ok: boolean; avg_days: number; sample_count: number }>(
      '/fridge/usage-log', { method: 'POST', body: JSON.stringify(input) }
    ),

  // Get learned shelf life for named items from KV
  getShelfLife: (items: string[]) =>
    request<ShelfLifeMap>(`/fridge/shelf-life?items=${items.map(encodeURIComponent).join(',')}`),

  // Resolve an Open Food Facts product image URL by name (server-side, with
  // KV cache + relevance check). Used after a fridge item is added by name
  // (receipt scan or hand-add) to backfill a photo asynchronously without
  // blocking the add UI. Returns { photo_url: string | null }.
  lookupPhoto: (name: string) =>
    request<{ photo_url: string | null; source: string }>(
      '/fridge/photo-lookup', { method: 'POST', body: JSON.stringify({ name }) },
    ),

  // One-shot backfill: walks every existing fridge item and resolves a
  // photo_url for any that don't have one yet. Polite to OFF (~350ms gap
  // between external lookups; cached results read instantly). Safe to call
  // repeatedly — only items missing a cached entry hit OFF.
  backfillPhotos: () =>
    request<{ walked: number; resolved: number; missed: number; looked_up_external: number; items: Array<{ name: string; zone: string; photo_url: string | null; source: string }> }>(
      '/fridge/photo-backfill', { method: 'POST' },
    ),

  // Slot positions on the cartoon shelves. Server is source of truth so a
  // layout edit on one device shows up on the next. Map is name → {zone,shelf,col}.
  getSlots: () => request<SlotMap>('/fridge/slots'),
  putSlots: (slots: SlotMap) =>
    request<{ ok: boolean; count: number }>('/fridge/slots', {
      method: 'PUT', body: JSON.stringify(slots),
    }),

  // Full enriched record for the detail modal: identity + KV metadata + recent prices.
  getFridgeItem: (name: string) =>
    request<FridgeItemDetail>(`/fridge/item/${encodeURIComponent(name)}`),

  // Background AI enrichment. Cascade is server-side: OFF barcode → OFF text
  // search → Gemini Flash. `hints` lets receipt-scan callers attach the
  // current store/cost/size so price history gets appended.
  enrichItem: (input: { name: string; barcode?: string; hints?: EnrichHints; force?: boolean }) =>
    request<EnrichResult>('/fridge/enrich', { method: 'POST', body: JSON.stringify(input) }),

  enrichBatch: (items: Array<{ name: string; barcode?: string; hints?: EnrichHints }>, force = false) =>
    request<{ ok: boolean; results: Record<string, EnrichedRecord | { error: string }> }>(
      '/fridge/enrich-batch', { method: 'POST', body: JSON.stringify({ items, force }) },
    ),

  enrichBackfill: (force = false) =>
    request<{ ok: boolean; scanned: number; enriched: number; skipped: number; errors: Array<{ name: string; error: string }> }>(
      '/fridge/enrich-backfill', { method: 'POST', body: JSON.stringify({ force }) },
    ),

  // AI food photo analysis (legacy single-item)
  analyzeFood: async (file: File, description: string): Promise<FoodAnalysis> => {
    const image = await fileToBase64(file)
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (KEY) headers.set('X-Health-Key', KEY)
    const res = await fetch(`${BASE}/ai/analyze-food`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image, mimeType: file.type || 'image/jpeg', description }),
    })
    if (!res.ok) throw new Error(`AI error: ${res.status}`)
    // The endpoint returns { foods:[...], confidence, source, needs_label }.
    // Collapse to the single-entry shape this caller logs: one product → that
    // item; a multi-item plate → summed into one entry. Carry source/needs_label
    // so the UI can flag estimates and prompt for the nutrition label.
    const data = await res.json() as { foods?: Array<{ name: string; kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number }>; confidence?: 'high' | 'medium' | 'low'; source?: 'label' | 'estimate'; needs_label?: boolean }
    const foods = Array.isArray(data.foods) ? data.foods : []
    const sum = foods.reduce((a, f) => ({
      kcal: a.kcal + (f.kcal || 0), protein_g: a.protein_g + (f.protein_g || 0),
      carbs_g: a.carbs_g + (f.carbs_g || 0), fat_g: a.fat_g + (f.fat_g || 0),
    }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
    const name = foods.length === 0 ? '' : foods.length === 1 ? foods[0].name : foods.map(f => f.name).join(', ')
    return {
      name, ...sum, description,
      confidence: data.confidence || (foods.length ? 'medium' : 'low'),
      source: data.source, needs_label: data.needs_label,
    }
  },
  lookupBarcode,

  // Smart scan — unified barcode/receipt/food detection
  smartScan: async (file: File): Promise<SmartScanResult> => {
    const image = await fileToBase64(file)
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (KEY) headers.set('X-Health-Key', KEY)
    const res = await fetch(`${BASE}/scan/smart`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image, mimeType: file.type || 'image/jpeg' }),
    })
    if (!res.ok) throw new Error(`Smart scan failed: ${res.status}`)
    return res.json()
  },

  // Food database search (Open Food Facts)
  searchFood: (q: string) => request<FoodSearchResponse>(`/food/search?q=${encodeURIComponent(q)}`),

  // Adaptive TDEE (MacroFactor-style)
  getAdaptiveTDEE: () => request<AdaptiveTDEEData>('/tdee/adaptive'),

  // Body metrics
  getTDEE: () => request<TDEEData>('/tdee'),
  // Body profile behind the TDEE math. Without this call both TDEE cards run
  // on the hardcoded 80kg/180cm/25y defaults in main.py.
  updateTdeeProfile: (data: { height_cm?: number; age?: number; sex?: string; activity_level?: string; weight_kg?: number; goal_direction?: string }) => {
    const qs = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    return request<{ ok: boolean; profile: Record<string, unknown> }>(`/tdee/profile?${qs}`, { method: 'PUT' })
  },
  getLatestMetric: () => request<{ metric: BodyMetric | null }>('/metrics/latest'),
  getMetrics: (days = 90) => request<{ metrics: BodyMetric[] }>(`/metrics?days=${days}`),
  addMetric: (data: { weight_kg?: number; body_fat_pct?: number; waist_cm?: number }) =>
    request<{ ok: boolean }>('/metrics', { method: 'POST', body: JSON.stringify(data) }),

  // Sleep
  getSleepStats: (days = 7) => request<SleepStats>(`/sleep/stats?days=${days}`),
  getSleep: (days = 30) => request<{ entries: SleepEntry[] }>(`/sleep?days=${days}`),
  logSleep: (data: { bedtime: string; wake_time: string; quality: number; hrv_ms?: number }) =>
    request<{ ok: boolean }>('/sleep', { method: 'POST', body: JSON.stringify(data) }),

  // Push notifications (real web-push — see lib/push.ts)
  getPushKey: () => request<{ publicKey: string }>('/push/vapid_public'),
  pushSubscribe: (sub: unknown) =>
    request<{ ok: boolean }>('/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (body: { endpoint: string }) =>
    request<{ ok: boolean }>('/push/unsubscribe', { method: 'POST', body: JSON.stringify(body) }),
  getPushPrefs: (endpoint: string) =>
    request<{ subscribed: boolean; prefs: PushPrefs }>(`/push/prefs?endpoint=${encodeURIComponent(endpoint)}`),
  setPushPrefs: (body: { endpoint: string; prefs: Partial<PushPrefs> }) =>
    request<{ ok: boolean; prefs: PushPrefs }>('/push/prefs', { method: 'PUT', body: JSON.stringify(body) }),

  // Timeline
  getTimeline: (days = 7) => request<{ events: TimelineEvent[] }>(`/timeline?days=${days}`),

  // Workouts — VPS returns { value: WorkoutData[], Count: N }, unwrap it
  getWorkouts: (limit = 30) =>
    request<WorkoutData[] | { value: WorkoutData[] }>(`/workouts?limit=${limit}`).then(unwrap),
  saveWorkout: (workout: WorkoutInput) =>
    request<{ ok: boolean; id: string }>('/workouts', { method: 'POST', body: JSON.stringify(workout) }),
  // Replace a finished workout in place — same id, new contents.
  updateWorkout: (id: string, workout: WorkoutInput) =>
    request<{ ok: boolean; id: string }>(`/workouts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(workout) }),
  deleteWorkout: (id: string) =>
    request<{ ok: boolean }>(`/workouts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getPRs: () => request<Record<string, PR>>('/workouts/prs'),

  // Goals
  getGoals: () => request<GoalsResponse>('/goals'),
  updateGoals: (update: GoalsUpdateInput) =>
    request('/goals', { method: 'PUT', body: JSON.stringify(update) }),

  // User profile
  getProfile: () => request<UserProfile>('/users/profile'),
  saveProfile: (profile: UserProfile) =>
    request('/users/profile', { method: 'POST', body: JSON.stringify(profile) }),

  // Stats
  getWeekStats: () => request<WeekStats>('/stats/week'),

  // Insights
  getInsights: () => request<InsightsResponse>('/insights'),

  // Weekly report
  getWeeklyReport: () => request<WeeklyReport>('/report/weekly'),

  // Recent foods
  getRecentFoods: (days = 7) => request<RecentFoodsResponse>(`/food/recent?days=${days}`),

  // Lists (groceries, errands, etc.)
  getList: (name: string) => request<ListData>(`/lists/${name}`),
  addListItem: (listName: string, text: string) =>
    request<{ ok: boolean; item: ListItemData }>(`/lists/${listName}/items`, { method: 'POST', body: JSON.stringify({ text }), queueLabel: 'list item' }),
  toggleListItem: (listName: string, itemId: string) =>
    request<{ ok: boolean; item: ListItemData }>(`/lists/${listName}/items/${itemId}`, { method: 'PATCH' }),
  deleteListItem: (listName: string, itemId: string) =>
    request<{ ok: boolean }>(`/lists/${listName}/items/${itemId}`, { method: 'DELETE' }),
  clearList: (listName: string) =>
    request<{ ok: boolean }>(`/lists/${listName}`, { method: 'DELETE' }),

  // Body weight log — VPS-backed so it syncs across devices and the AI
  // assistant can read history. Goals page also mirrors to localStorage as
  // a hot cache for offline / first-paint.
  getWeightLog: (days = 60) =>
    request<{ entries: { date: string; kg: number; logged_at?: string }[] }>(`/weight?days=${days}`),
  addWeightEntry: (kg: number, date?: string) =>
    request<{ ok: boolean; date: string; kg: number }>('/weight', {
      method: 'POST',
      body: JSON.stringify({ kg, date }),
    }),

  // Recipe calculator
  calculateRecipe: (ingredients: string[], servings: number) =>
    request<RecipeResult>('/recipes/calculate', {
      method: 'POST',
      body: JSON.stringify({ ingredients, servings }),
    }),

  // Water tracking
  getWater: (date?: string) =>
    request<WaterData>(date ? `/water?d=${date}` : '/water'),
  logWater: (ml: number, label?: string, date?: string) =>
    request<{ ok: boolean; total_ml: number; entry: WaterEntry }>('/water', {
      method: 'POST',
      body: JSON.stringify({ ml, label, date }),
      queueLabel: 'water',
    }),

  // Routines (skincare, vitamins, etc — single-tap daily check-ins with streak)
  getRoutine: (name: string) => request<RoutineData>(`/routines/${encodeURIComponent(name)}`),
  logRoutine: (name: string) =>
    request<{ ok: boolean; date: string }>(`/routines/${encodeURIComponent(name)}/log`, { method: 'POST', queueLabel: 'routine' }),

  // Agenda
  getAgendaToday: () => request<AgendaData>('/agenda/today'),
  addAgendaItem: (title: string, notes?: string) =>
    request<{ ok: boolean; item: AgendaItemData }>('/agenda', { method: 'POST', body: JSON.stringify({ title, notes }), queueLabel: 'task' }),
  toggleAgendaItem: (itemId: string) =>
    request<{ ok: boolean; item: AgendaItemData }>(`/agenda/${itemId}`, { method: 'PATCH' }),
  deleteAgendaItem: (itemId: string) =>
    request<{ ok: boolean }>(`/agenda/${itemId}`, { method: 'DELETE' }),
}

// ---- Types ----
export interface AddFridgeItemMeta {
  size?: string | null
  cost?: number | null
  store?: string | null
  unit_size_g?: number | null
  quantity_g?: number | null
  unit_count?: number | null
  quantity_count?: number | null
  // OFF product image URL when available (typically from barcode scan).
  // Stored alongside other extended metadata in KV; surfaces on the item card.
  photo_url?: string | null
}
export interface ScannedItem {
  name: string
  size: string | null
  unit_size_g?: number | null
  unit_count?: number | null
  cost: number | null
  section: string
}
export interface ScanResult { items?: ScannedItem[]; store?: { name: string; location: string | null } | null; error?: string; raw?: string }

// Smart scan — unified result from POST /scan/smart
export interface ScanFoodItem {
  name: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  grams?: number | null
  /** Provenance of the numbers: 'database' = matched a real Open Food Facts
   *  product (trustworthy); 'label' = read off a printed panel; 'estimate' = AI
   *  guess. Absent = a plain AI estimate (the historical default). */
  source?: 'estimate' | 'database' | 'label'
  /** True for a packaged product we could NOT verify against the database — the
   *  UI must not present the guessed macros as fact; it asks for the label. */
  needsLabel?: boolean
  /** Full per-portion micro map when matched to a database product. */
  nutrients?: NutrientMap
}
export type SmartScanResult =
  | { type: 'barcode'; code: string | null }
  | { type: 'receipt'; items: ScannedItem[]; store?: { name: string; location: string | null } | null }
  | { type: 'food'; foods: ScanFoodItem[]; confidence: 'high' | 'medium' | 'low'; source?: 'label' | 'estimate'; needs_label?: boolean }
export interface FoodAnalysis {
  name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number
  description: string; confidence: 'high' | 'medium' | 'low'
  // 'label' = read from a printed nutrition panel (trustworthy); 'estimate' = guessed.
  source?: 'label' | 'estimate'
  // Packaged product we couldn't read a label for — UI should prompt to snap it.
  needs_label?: boolean
}
// Result from POST /food/smart — natural-language nutrition estimate. The
// estimator states its assumptions (cooking method, portion size) in
// portion_detail / confidence_reason so the UI can surface them before logging.
export interface SmartFoodResult {
  meal: string
  matched_product?: string | null
  brand_or_shop?: string | null
  portion_detail?: string | null
  kcal: number
  protein_g: number
  carbs_g?: number
  fat_g?: number
  fiber_g?: number
  sugar_g?: number
  sodium_mg?: number
  nutrients?: NutrientMap
  confidence: 'high' | 'medium' | 'low'
  confidence_reason?: string | null
  description: string
}
export interface FoodAnalysisV2 {
  mode?: 'home' | 'out'
  foods: Array<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number }>
  fridge_matches: Array<FridgeItem & { zone: string; grams_used?: number | null }>
  confidence: 'high' | 'medium' | 'low'
  // 'label' = read from a printed nutrition panel (trustworthy); 'estimate' = guessed.
  source?: 'label' | 'estimate'
  // True for a packaged product we couldn't read a label for — prompt the user to snap it.
  needs_label?: boolean
}
export interface UsageLogInput { item_name: string; zone: string; date_added: string | null }
export interface ShelfLifeMap { [item_name: string]: { avg_days: number; sample_count: number } }
export interface DiaryEntry { datetime: string; thumbnail: string; foods: FoodAnalysisV2['foods'] }
export interface BarcodeLookupResult {
  name: string
  brand?: string
  serving_size?: string
  kcal?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  per_100g?: { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number; salt_g?: number; sodium_mg?: number }
  /** Full per-100g micro/macro map from Open Food Facts. */
  nutrients_per_100g?: NutrientMap
  image_url?: string
}
export interface TodayData { date: string; entries: FoodEntry[]; total_kcal: number; goals: Goals }
/** Arbitrary per-portion micro/macro nutrients: saturated_fat_g, salt_g,
 * calcium_mg, iron_mg, potassium_mg, vitamin_c_mg, etc. Whatever the source
 * supplied — nothing is fabricated. */
export type NutrientMap = Record<string, number>
export interface FoodEntry { time: string; meal: string; items: string; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number; sodium_mg?: number; confidence?: string; context?: 'home' | 'out'; place?: string; nutrients?: NutrientMap }
export interface FoodEntryInput { meal: string; description: string; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number; sodium_mg?: number; confidence?: string; time?: string; date?: string; context?: 'home' | 'out'; place?: string; nutrients?: NutrientMap }
export interface FoodLogRow { date: string; time?: string; meal?: string; items?: string; kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number; sodium_mg?: number; context?: 'home' | 'out'; place?: string; nutrients?: NutrientMap }
export interface HistoryDay { date: string; total_kcal: number; total_protein_g?: number; logged: boolean }
export interface Goals { calories: number; protein: number; gym_days: number }
export interface GoalsResponse { content: string; parsed: Goals }
export interface GoalsUpdateInput { calories?: number; protein?: number; gym_days?: number; notes?: string }
export interface FridgeData { fridge: FridgeItem[]; pantry: FridgeItem[]; condiments: FridgeItem[]; freezer: FridgeItem[] }
export interface FridgeItem {
  name: string
  added: string | null
  size?: string | null
  cost?: number | null
  store?: string | null
  // Pack size + remaining quantity used by the photo-log Home flow to decrement
  // inventory as meals are eaten. Both unit_size_* are set when the item is added
  // (typically from the receipt scan). quantity_* tracks what's left.
  unit_size_g?: number | null
  quantity_g?: number | null
  unit_count?: number | null
  quantity_count?: number | null
  // Resolved product image URL, typically from Open Food Facts. Set when:
  //   - The item was added via barcode scan (the OFF product API call returns one)
  //   - The /api/fridge/photo-lookup name-search resolved a confident match
  //   - The /api/fridge/photo-backfill admin call walked the existing fridge
  // Falls back to the emoji map on the card when null/empty/broken.
  photo_url?: string | null
}

export type Zone = 'fridge' | 'pantry' | 'freezer' | 'condiments'
export interface SlotPos { zone: Zone; shelf: number; col: number }
export type SlotMap = Record<string, SlotPos>

export interface NutritionPer100g {
  kcal?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  fiber_g?: number
  sugar_g?: number
}

export interface EnrichedRecord {
  name?: string | null
  brand?: string | null
  photo_url?: string | null
  barcode?: string | null
  nutrition_per_100g?: NutritionPer100g | null
  typical_size_g?: number | null
  typical_unit_count?: number | null
  packaging?: string | null
  shelf_life_days_sealed?: number | null
  shelf_life_days_opened?: number | null
  allergens?: string[] | null
  categories?: string[] | null
  size?: string | null
  cost?: number | null
  store?: string | null
  source?: string | null
  confidence?: 'high' | 'medium' | 'low' | 'unknown'
  enriched_at?: number | null
}

export interface PriceEntry { date: string; store: string | null; cost: number; size: string | null }

export interface EnrichHints { store?: string | null; cost?: number | null; size?: string | null; date?: string | null }

export interface EnrichResult {
  ok: boolean
  meta: EnrichedRecord
  recent_prices: PriceEntry[]
  source: 'enriched' | 'cache'
}

// Returned by GET /fridge/item/{name} — the rich payload the detail modal renders.
// Structured action returned by /api/ai/act — Gemini parses a freeform user
// message into one or more of these.
export type AiAction =
  // `date` is optional ISO YYYY-MM-DD. Gemini fills it when the user says
  // "yesterday", "last night", "this morning", etc.; otherwise unset = today.
  | { type: 'log_food'; name: string; count: number; kcal: number; protein_g: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number; sodium_mg?: number; meal: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner'; date?: string; matched_product?: string; brand_or_shop?: string; confidence?: 'high' | 'medium' | 'low'; confidence_reason?: string }
  | { type: 'add_fridge'; name: string; section: 'fridge' | 'freezer' | 'pantry' | 'condiments'; store?: string; size?: string; unit_size_g?: number; unit_count?: number; cost?: number }
  // Glasses of water (1-12). Frontend writes to localStorage water_intake;
  // backend has no notion of hydration today.
  | { type: 'log_water'; count: number }
  // Mark a daily routine done — calls /routines/{name}/log on the VPS.
  | { type: 'mark_routine'; name: 'meditate' | 'vitamins' | 'journal' | 'read' | 'stretch' }
  // Add a task to today's plan — calls POST /agenda.
  | { type: 'add_agenda'; title: string; priority: 'low' | 'normal' | 'urgent' }
  // Add an item to a list — calls POST /lists/{list}/items.
  | { type: 'add_list_item'; list: 'groceries' | 'errands' | 'shopping'; text: string }
  // Log a body-weight reading — calls POST /weight. date optional (YYYY-MM-DD).
  // Same-day re-logs overwrite, matching the morning weigh-in convention.
  | { type: 'log_weight'; kg: number; date?: string }
  // Decrement a fridge item's remaining stock instead of removing it. Pairs
  // naturally with log_food when the user eats SOME of a stocked item — e.g.
  // "ate 2 eggs" decrements the egg count by 2 (and a separate log_food
  // captures the calories). Backend matches name case-insensitively across
  // all sections; first match wins. Either grams OR count, not both.
  | { type: 'consume_fridge'; name: string; grams?: number; count?: number }
export interface AiActResponse {
  ok: boolean
  summary: string
  actions: AiAction[]
  error?: string
}

// Returned by POST /api/ai/coach — the reverse macro solver. Given the day's
// remaining targets + a set of ingredients, it proposes grams of each. All
// arithmetic is recomputed server-side from grams x per-100g, so totals are
// trustworthy; `actions` are ready to confirm + log via the normal path.
// Returned by GET /api/shop/lookup — best-matching real product from Open
// Food Facts plus the stores OFF knows stock it (notepad enriches typed items).
export interface ShopLookupResult {
  ok: boolean
  query: string
  product: { name: string; brand: string | null; image_url: string | null; quantity: string | null } | null
  stores: string[]
  kcal_100g: number | null
  error?: string
}
// Gym coach (/api/ai/gym-coach) — machine-question + workout-summary modes.
export interface GymCoachMachineResponse {
  ok: boolean
  answer: string
  suggestedEquipment?: {
    id: string
    name: string
    type: 'stack' | 'plate-loaded' | 'dumbbell' | 'barbell' | 'cable' | 'bodyweight' | 'machine-fixed'
    stack?: { min: number; max: number; step: number }
    aliases?: string[]
    notes?: string
  } | null
  suggestedSchedule?: {
    addToDay: 'Upper A' | 'Lower A' | 'Upper B' | 'Lower B' | 'none'
    afterExercise: string
    sets: number
    repRange: string
    rir: string
    restSeconds: number
    startingWeight_kg: number
    rationale: string
  } | null
  offline?: boolean
}
export interface GymCoachSummaryResponse {
  ok: boolean
  narrative: string
  offline?: boolean
}
// Returned by POST /api/ai/parse-routine — freeform routine text → structured.
export interface ParsedSessionSet { weight_kg?: number; reps?: number; rir?: number }
export interface ParsedSessionExercise { name: string; sets: ParsedSessionSet[] }
export interface ParsedSession {
  ok: boolean
  title: string
  exercises: ParsedSessionExercise[]
  error?: string
}

export interface ParsedRoutineExercise { name: string; sets: number; repRange: string; restSeconds: number; rir: string }
export interface ParsedRoutine {
  ok: boolean
  title: string
  exercises: ParsedRoutineExercise[]
  error?: string
}
export interface CoachIngredient { name: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export interface CoachResponse {
  ok: boolean
  summary: string
  note?: string
  plan: {
    ingredients: CoachIngredient[]
    totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
    remaining: { kcal: number; protein_g: number }
  } | null
  actions: AiAction[]
  error?: string
}

export interface FridgeItemDetail extends EnrichedRecord {
  name: string
  added: string | null
  zone: Zone
  slot: SlotPos | null
  unit_size_g?: number | null
  unit_count?: number | null
  quantity_g?: number | null
  quantity_count?: number | null
  recent_prices: PriceEntry[]
}
export interface Meal { name: string; ingredients: string[]; kcal_estimate: number }
export interface MealDetail {
  prep_minutes?: number
  cook_minutes?: number
  servings?: number
  steps: string[]
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}
export interface ExerciseSet { weight_kg?: number; reps?: number; duration_seconds?: number; rir?: number; ramp?: boolean }
export interface ExerciseData { name: string; sets: ExerciseSet[] }
export interface WorkoutData { id: string; title: string; start_time: string; end_time: string; exercises: ExerciseData[] }
export interface WorkoutInput { title: string; start_time: string; end_time: string; exercises: ExerciseData[] }
export interface PR { weight_kg: number; reps: number; date: string }
export interface UserProfile { name: string; calories: number; protein: number }
export interface WeekStats {
  food_by_day: HistoryDay[]; logged_days: number; avg_kcal: number
  goal_kcal: number; workout_count: number; goal_gym_days: number
}
export interface ListItemData { id: string; text: string; checked: boolean; added: string }
export interface ListData { name: string; items: ListItemData[] }
export interface RoutineLogEntry { date: string; logged_at: string }
export interface RoutineData { name: string; done_today: boolean; streak: number; log: RoutineLogEntry[] }
export interface AgendaItemData {
  id: string; title: string; notes?: string | null
  scheduled_date: string; done: boolean; created_at: string; done_at?: string | null
}
export interface AgendaData { date: string; items: AgendaItemData[] }

// Barcode page result type (richer than BarcodeLookupResult used internally)
export interface BarcodeResult {
  name: string
  brand?: string
  serving_size?: string
  image_url?: string
  source?: string
  per_100g: {
    kcal: number
    protein_g: number
    carbs_g: number
    fat_g: number
  }
}

// Body metrics
export interface BodyMetric {
  date: string
  weight_kg?: number | null
  body_fat_pct?: number | null
  waist_cm?: number | null
}

/** Activity level derived from real Apple Health step counts. */
export interface StepsActivity {
  multiplier: number
  activity_level: string
  avg_steps: number
  days: number
}

// TDEE calculator response
export interface TDEEData {
  tdee: number
  bmr: number
  activity_level?: string
  /** Provenance of the activity multiplier: real steps, profile, or unset default. */
  activity_source?: 'steps' | 'profile' | 'default'
  steps_activity?: StepsActivity | null
  avg_intake_14d?: number
  weight_trend?: { direction: string; weekly_change_kg: number }
  recommendation?: string
}

// Sleep stats
export interface SleepStats {
  avg_quality: number | null
  avg_duration: number | null
  avg_hrv?: number | null
  entries: number
}

// A single logged night (GET /sleep).
export interface SleepEntry {
  id?: string
  date: string
  bedtime?: string
  wake_time?: string
  duration_hrs: number
  quality: number
  hrv_ms?: number
  resting_hr?: number
  notes?: string
}

// Push notifications (real web-push — see lib/push.ts). One flag per type; the
// VPS scheduler reads these to decide what to send to each device.
export interface PushPrefs {
  readiness: boolean
  weekly: boolean
  hydration: boolean
}

// Timeline
export interface TimelineEvent {
  date: string
  type: string
  summary: string
  detail?: string | null
  time?: string
}

// Insights
export interface Insight {
  text: string
  type: 'positive' | 'neutral' | 'negative'
  icon: string
  category: 'sleep' | 'nutrition' | 'fitness' | 'weight'
  data: Record<string, number>
}
export interface InsightsResponse {
  insights: Insight[]
  period_days: number
  generated_at: string
}

// Weekly Report
export interface WeeklyReport {
  period: { start: string; end: string }
  calories: { total: number; goal: number; pct: number; logged_days: number; avg_daily: number }
  protein: { avg_daily: number; goal: number }
  workouts: { count: number; goal: number }
  weight: { start: number | null; end: number | null; change: number | null }
  sleep: { avg_quality: number | null; avg_duration_hrs: number | null; entries: number }
  routines: Record<string, number>
  top_foods: Array<{ name: string; count: number }>
  hydration_avg: number | null
  summary: string
}

// Recent foods
export interface RecentFoodItem { name: string; kcal: number; protein_g: number }
export interface RecentFoodsResponse { items: RecentFoodItem[]; days: number }

// Recipe calculator
export interface RecipeIngredient { name: string; amount: string; kcal: number; protein_g: number }
export interface RecipeMacros { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
export interface RecipeResult {
  recipe_total: RecipeMacros
  per_serving: RecipeMacros
  ingredients: RecipeIngredient[]
  confidence: 'high' | 'medium' | 'low'
  servings: number
}

// Water tracking
export interface WaterEntry { time: string; ml: number; label: string }
export interface WaterData { date: string; entries: WaterEntry[]; total_ml: number; goal_ml: number }

// Meal Planning
export interface PlannedMeal {
  slot: string
  name: string
  ingredients: string[]
  kcal: number
  protein_g: number
  carbs_g?: number
  fat_g?: number
  prep_minutes?: number
}
export interface MealPlanResponse {
  date: string
  meals: PlannedMeal[]
  totals: { kcal: number; protein_g: number }
  targets?: { kcal: number; protein_g: number }
}

// Food database search (Open Food Facts)
export interface FoodSearchProduct {
  name: string
  brand: string
  serving_size: string
  quantity: string
  image_url: string
  per_100g: {
    kcal: number
    protein_g: number
    carbs_g: number
    fat_g: number
    fiber_g: number
    sugar_g: number
    sodium_mg: number
    salt_g: number
  }
  source: 'open_food_facts'
}
export interface FoodSearchResponse {
  query: string
  results: FoodSearchProduct[]
  count: number
  error?: string
}

// Adaptive TDEE (MacroFactor-style)
export interface AdaptiveTDEEData {
  estimated_tdee: number
  bmr: number
  activity_level: string
  /** Provenance of the activity multiplier: real steps, profile, or unset default. */
  activity_source?: 'steps' | 'profile' | 'default'
  steps_activity?: StepsActivity | null
  weight_kg: number
  /** Where weight_kg came from: 'logged' (real weigh-in), 'profile', or 'default' (80kg placeholder). */
  weight_source?: 'logged' | 'profile' | 'default'
  goal_direction?: 'gain' | 'maintain' | 'lose'
  adaptive_tdee: number | null
  source: 'adaptive' | 'estimated' | 'tentative'
  avg_daily_intake?: number
  weight_change_kg?: number
  weekly_change_kg?: number
  days_span?: number
  recommendation: string
  data_status: {
    food_days_logged: number
    weight_entries: number
    sufficient: boolean
    message: string | null
  }
  targets?: {
    maintain: number
    target: number
    aggressive: number
    direction: 'lose' | 'gain' | 'maintain'
  }
  /** Server-derived baseline goals (mirrors src/lib/goal-suggestions.ts). */
  suggested_goals?: {
    calories: number | null
    calorie_delta: number
    protein: number | null
    protein_per_kg: number
    direction: 'gain' | 'maintain' | 'lose'
    weight_source: 'logged' | 'profile' | 'default'
  }
}
