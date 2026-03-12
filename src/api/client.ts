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

export const api = {
  // Today
  getToday: () => request<TodayData>('/today'),

  // Food
  addFood: (entry: FoodEntryInput) => request('/food', { method: 'POST', body: JSON.stringify(entry) }),
  getFoodHistory: (days = 7) => request<HistoryDay[]>(`/food/history?days=${days}`),

  // Fridge
  getFridge: () => request<FridgeData>('/fridge'),
  addFridgeItem: (name: string, section: string) =>
    request('/fridge/item', { method: 'POST', body: JSON.stringify({ name, section }) }),
  removeFridgeItem: (name: string) =>
    request(`/fridge/item/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  scanReceipt: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/fridge/scan`, {
      method: 'POST',
      headers: { 'X-Health-Key': KEY },
      body: form,
    }).then(r => r.json())
  },

  // AI meals
  getMealSuggestions: () => request<{ meals: Meal[] }>('/ai/meals', { method: 'POST' }),

  // Workouts
  getWorkouts: (limit = 30) => request<WorkoutData[]>(`/workouts?limit=${limit}`),
  saveWorkout: (workout: WorkoutInput) =>
    request('/workouts', { method: 'POST', body: JSON.stringify(workout) }),
  getPRs: () => request<Record<string, PR>>('/workouts/prs'),

  // Goals
  getGoals: () => request<GoalsResponse>('/goals'),
  updateGoals: (update: GoalsUpdateInput) =>
    request('/goals', { method: 'PUT', body: JSON.stringify(update) }),

  // Stats
  getWeekStats: () => request<WeekStats>('/stats/week'),
}

// Types
export interface TodayData {
  date: string
  entries: FoodEntry[]
  total_kcal: number
  goals: Goals
}
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
  food_by_day: HistoryDay[]
  logged_days: number
  avg_kcal: number
  goal_kcal: number
  workout_count: number
  goal_gym_days: number
}
