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
    } catch {}
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
      return { name, kcal }
    }
  } catch {}

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
  addFridgeItem: (name: string, section: string, meta?: { size?: string | null; cost?: number | null; store?: string | null }) =>
    request('/fridge/item', { method: 'POST', body: JSON.stringify({ name, section, ...meta }) }),
  removeFridgeItem: (name: string) =>
    request(`/fridge/item/${encodeURIComponent(name)}`, { method: 'DELETE' }),
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

  // AI meals
  getMealSuggestions: () => request<{ meals: Meal[] }>('/ai/meals', { method: 'POST' }),

  // AI food photo analysis (new)
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
    request('/workouts', { method: 'POST', body: JSON.stringify(workout) }),
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
}

// ---- Types ----
export interface ScannedItem { name: string; size: string | null; cost: number | null; section: string }
export interface ScanResult { items?: ScannedItem[]; store?: { name: string; location: string | null } | null; error?: string; raw?: string }
export interface FoodAnalysis {
  name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number
  description: string; confidence: 'high' | 'medium' | 'low'
}
export interface BarcodeLookupResult {
  name: string
  kcal?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
}
export interface TodayData { date: string; entries: FoodEntry[]; total_kcal: number; goals: Goals }
export interface FoodEntry { time: string; meal: string; items: string; kcal: number; protein_g?: number }
export interface FoodEntryInput { meal: string; description: string; kcal: number; protein_g?: number; time?: string }
export interface HistoryDay { date: string; total_kcal: number; logged: boolean }
export interface Goals { calories: number; protein: number; gym_days: number }
export interface GoalsResponse { content: string; parsed: Goals }
export interface GoalsUpdateInput { calories?: number; protein?: number; gym_days?: number; notes?: string }
export interface FridgeData { fridge: FridgeItem[]; pantry: FridgeItem[]; condiments: FridgeItem[]; freezer: FridgeItem[] }
export interface FridgeItem { name: string; added: string | null; size?: string | null; cost?: number | null; store?: string | null }
export interface Meal { name: string; ingredients: string[]; kcal_estimate: number }
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
