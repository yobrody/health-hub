// Default to same-origin Pages Functions: keeps secrets server-side.
// For local debugging you can still set VITE_API_BASE to an absolute URL.
const BASE = import.meta.env.VITE_API_BASE || '/api'
const KEY: string | undefined = import.meta.env.VITE_API_KEY || undefined

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const h = new Headers(opts.headers)
  // Only attach the key when explicitly configured (e.g. direct-to-VPS debugging).
  if (KEY) h.set('X-Health-Key', KEY)
  if (!h.has('Content-Type')) h.set('Content-Type', 'application/json')

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: h,
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
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
  addFood: (entry: FoodEntryInput) => request('/food', { method: 'POST', body: JSON.stringify(entry) }),
  deleteFood: (time: string, meal: string) =>
    request('/food/delete', { method: 'POST', body: JSON.stringify({ time, meal }) }),
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

  // AI meals — cheap listing of names + kcal estimates
  // Natural-language assistant. Type one freeform line ("3 eggs and bacon
  // and a can of pineapple from Aldi"); Gemini parses it into structured
  // log_food + add_fridge actions. Frontend displays the summary + action
  // count, then executes each action via existing endpoints on confirm.
  parseAct: (prompt: string) =>
    request<AiActResponse>('/ai/act', { method: 'POST', body: JSON.stringify({ prompt }) }),

  getMealSuggestions: () => request<{ meals: Meal[] }>('/ai/meals', { method: 'POST' }),
  // Detailed recipe + full macros for a single meal idea. Called on tap-to-expand
  // so we don't pay the recipe-generation token cost for ideas the user ignores.
  getMealDetail: (name: string, ingredients: string[]) =>
    request<MealDetail>('/ai/meal-detail', { method: 'POST', body: JSON.stringify({ name, ingredients }) }),

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
    return res.json()
  },
  lookupBarcode,

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

  // Lists (groceries, errands, etc.)
  getList: (name: string) => request<ListData>(`/lists/${name}`),
  addListItem: (listName: string, text: string) =>
    request<{ ok: boolean; item: ListItemData }>(`/lists/${listName}/items`, { method: 'POST', body: JSON.stringify({ text }) }),
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

  // Routines (skincare, vitamins, etc — single-tap daily check-ins with streak)
  getRoutine: (name: string) => request<RoutineData>(`/routines/${encodeURIComponent(name)}`),
  logRoutine: (name: string) =>
    request<{ ok: boolean; date: string }>(`/routines/${encodeURIComponent(name)}/log`, { method: 'POST' }),

  // Agenda
  getAgendaToday: () => request<AgendaData>('/agenda/today'),
  addAgendaItem: (title: string, notes?: string) =>
    request<{ ok: boolean; item: AgendaItemData }>('/agenda', { method: 'POST', body: JSON.stringify({ title, notes }) }),
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
export interface FoodAnalysis {
  name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number
  description: string; confidence: 'high' | 'medium' | 'low'
}
export interface FoodAnalysisV2 {
  mode?: 'home' | 'out'
  foods: Array<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number }>
  fridge_matches: Array<FridgeItem & { zone: string; grams_used?: number | null }>
  confidence: 'high' | 'medium' | 'low'
}
export interface UsageLogInput { item_name: string; zone: string; date_added: string | null }
export interface ShelfLifeMap { [item_name: string]: { avg_days: number; sample_count: number } }
export interface DiaryEntry { datetime: string; thumbnail: string; foods: FoodAnalysisV2['foods'] }
export interface BarcodeLookupResult {
  name: string
  kcal?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  // OFF product image URL (200px-wide front-of-pack). May be undefined when
  // the OFF entry exists but has no uploaded photos.
  image_url?: string
}
export interface TodayData { date: string; entries: FoodEntry[]; total_kcal: number; goals: Goals }
export interface FoodEntry { time: string; meal: string; items: string; kcal: number; protein_g?: number }
export interface FoodEntryInput { meal: string; description: string; kcal: number; protein_g?: number; time?: string; date?: string }
export interface HistoryDay { date: string; total_kcal: number; logged: boolean }
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
  | { type: 'log_food'; name: string; count: number; kcal: number; protein_g: number; meal: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner'; date?: string }
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
export interface ExerciseSet { weight_kg?: number; reps?: number; duration_seconds?: number }
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
