const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
const KEY = import.meta.env.VITE_API_KEY || 'change-me'

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json', ...opts.headers },
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
  addFridgeItem: (name: string, section: string) =>
    request('/fridge/item', { method: 'POST', body: JSON.stringify({ name, section }) }),
  removeFridgeItem: (name: string) =>
    request(`/fridge/item/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  scanReceipt: async (file: File): Promise<ScanResult> => {
    const image = await fileToBase64(file)
    const res = await fetch(`${BASE}/fridge/scan`, {
      method: 'POST',
      headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
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
    const res = await fetch(`${BASE}/ai/analyze-food`, {
      method: 'POST',
      headers: { 'X-Health-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mimeType: file.type || 'image/jpeg', description }),
    })
    if (!res.ok) throw new Error(`AI error: ${res.status}`)
    return res.json()
  },

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

  // Stats
  getWeekStats: () => request<WeekStats>('/stats/week'),

  // Body Metrics
  getMetrics: (days = 90) => request<{ metrics: BodyMetric[] }>(`/metrics?days=${days}`),
  addMetric: (entry: BodyMetricInput) => request('/metrics', { method: 'POST', body: JSON.stringify(entry) }),
  getLatestMetric: () => request<{ metric: BodyMetric | null }>('/metrics/latest'),

  // TDEE
  getTDEE: () => request<TDEEData>('/tdee'),

  // Sleep
  getSleep: (days = 30) => request<{ entries: SleepEntry[] }>(`/sleep?days=${days}`),
  logSleep: (entry: SleepInput) => request('/sleep', { method: 'POST', body: JSON.stringify(entry) }),
  getSleepStats: (days = 7) => request<SleepStats>(`/sleep/stats?days=${days}`),

  // Timeline
  getTimeline: (days = 7) => request<{ events: TimelineEvent[] }>(`/timeline?days=${days}`),

  // Barcode
  lookupBarcode: (code: string) => request<BarcodeResult>(`/barcode/${code}`),
}

// ---- Types ----
export interface ScanResult { items_added?: number; items?: string[]; error?: string }
export interface FoodAnalysis {
  name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number
  description: string; confidence: 'high' | 'medium' | 'low'
}
export interface TodayData { date: string; entries: FoodEntry[]; total_kcal: number; goals: Goals }
export interface FoodEntry { time: string; meal: string; items: string; kcal: number }
export interface FoodEntryInput { meal: string; description: string; kcal: number; time?: string }
export interface HistoryDay { date: string; total_kcal: number; logged: boolean }
export interface Goals { calories: number; protein: number; gym_days: number }
export interface GoalsResponse { content: string; parsed: Goals }
export interface GoalsUpdateInput { calories?: number; protein?: number; gym_days?: number; notes?: string }
export interface FridgeData { fridge: FridgeItem[]; pantry: FridgeItem[]; condiments: FridgeItem[]; freezer: FridgeItem[] }
export interface FridgeItem { name: string; added: string | null }
export interface Meal { name: string; ingredients: string[]; kcal_estimate: number }
export interface ExerciseSet { weight_kg?: number; reps?: number; duration_seconds?: number }
export interface ExerciseData { name: string; sets: ExerciseSet[] }
export interface WorkoutData { id: string; title: string; start_time: string; end_time: string; exercises: ExerciseData[] }
export interface WorkoutInput { title: string; start_time: string; end_time: string; exercises: ExerciseData[] }
export interface PR { weight_kg: number; reps: number; date: string }
export interface WeekStats {
  food_by_day: HistoryDay[]; logged_days: number; avg_kcal: number
  goal_kcal: number; workout_count: number; goal_gym_days: number
}

// ── Body Metrics ──
export interface BodyMetric {
  id: string; date: string; weight_kg?: number; body_fat_pct?: number
  waist_cm?: number; chest_cm?: number; arm_cm?: number; notes?: string
}
export interface BodyMetricInput {
  weight_kg?: number; body_fat_pct?: number; waist_cm?: number
  chest_cm?: number; arm_cm?: number; notes?: string; date?: string
}

// ── TDEE ──
export interface TDEEData {
  bmr: number; tdee: number; activity_level: string; weight_kg: number
  avg_intake_14d: number | null; logged_days_14d: number
  weight_trend: { weekly_change_kg: number; direction: string } | null
  recommendation: string
}

// ── Sleep ──
export interface SleepEntry {
  id: string; date: string; bedtime: string; wake_time: string
  duration_hrs: number; quality: number; hrv_ms?: number
  resting_hr?: number; notes?: string
}
export interface SleepInput {
  bedtime: string; wake_time: string; quality?: number
  hrv_ms?: number; resting_hr?: number; notes?: string; date?: string
}
export interface SleepStats {
  avg_duration: number | null; avg_quality: number | null
  avg_hrv: number | null; entries: number
}

// ── Timeline ──
export interface TimelineEvent {
  date: string; type: 'food' | 'workout' | 'sleep' | 'metric' | 'routine'
  summary: string; detail?: string; value?: number
}

// ── Barcode ──
export interface BarcodeResult {
  code: string; name: string; brand: string; serving_size: string
  per_100g: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; salt_g: number }
  image_url: string
}
