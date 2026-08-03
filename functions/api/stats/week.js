/**
 * Cloudflare Pages Function - GET /api/stats/week
 * Computes weekly stats from food history + workouts + goals.
 * Overrides the broken VPS /stats/week endpoint.
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}
const VPS_BASE = 'https://hh-api.pestdispatch.co.uk'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet(context) {
  const expected = context.env.HEALTH_API_KEY  // no literal fallback — key lives in CF Pages env only (audit B-9)

  const h = { 'X-Health-Key': expected, 'Content-Type': 'application/json' }

  const [histRes, wkRes, goalsRes] = await Promise.allSettled([
    fetch(`${VPS_BASE}/food/history?days=7`, { headers: h }),
    fetch(`${VPS_BASE}/workouts?limit=50`, { headers: h }),
    fetch(`${VPS_BASE}/goals`, { headers: h }),
  ])

  // Food history -> food_by_day
  let food_by_day = []
  if (histRes.status === 'fulfilled' && histRes.value.ok) {
    try {
      const raw = await histRes.value.json()
      food_by_day = (Array.isArray(raw) ? raw : (raw.value || [])).slice(0, 7)
    } catch {}
  }
  if (food_by_day.length === 0) {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      food_by_day.push({ date: d.toISOString().slice(0, 10), total_kcal: 0, logged: false })
    }
  }

  const logged_days = food_by_day.filter(d => d.logged).length
  const loggedKcals = food_by_day.filter(d => d.logged).map(d => d.total_kcal)
  const avg_kcal = loggedKcals.length
    ? Math.round(loggedKcals.reduce((a, b) => a + b, 0) / loggedKcals.length) : 0

  // Goals
  let goal_kcal = 2200, goal_gym_days = 4
  if (goalsRes.status === 'fulfilled' && goalsRes.value.ok) {
    try {
      const g = await goalsRes.value.json()
      goal_kcal = g.parsed?.calories ?? g.calories ?? 2200
      goal_gym_days = g.parsed?.gym_days ?? g.gym_days ?? 4
    } catch {}
  }

  // Workout count this week
  let workout_count = 0
  if (wkRes.status === 'fulfilled' && wkRes.value.ok) {
    try {
      const raw = await wkRes.value.json()
      const arr = Array.isArray(raw) ? raw : (raw.value || [])
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
      workout_count = arr.filter(w => new Date(w.start_time) >= cutoff).length
    } catch {}
  }

  return json({ food_by_day, logged_days, avg_kcal, goal_kcal, workout_count, goal_gym_days })
}
