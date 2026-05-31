import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { WeekStats, Goals, GoalsUpdateInput } from '../api/client'
import { MEAL_PLAN, DEFAULT_SCHEDULE, PROGRAM } from '../program'
import { BUILD_SHA, BUILD_DATE } from '../build-info'
import {
  analyzeWeightTrend,
  loadDirection,
  saveDirection,
  suggestCalorieTarget,
  type Direction,
  type WeightEntry,
} from '../lib/calorie-target'
// suppress unused import warnings for things referenced elsewhere
void MEAL_PLAN; void DEFAULT_SCHEDULE; void PROGRAM

function MiniBar({ value, goal, color }: { value: number; goal: number; color: string }) {
  return (
    <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 3, background: color,
        width: `${Math.min(value / Math.max(goal, 1) * 100, 100)}%`, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function WeekChart({ days }: { days: WeekStats['food_by_day'] }) {
  const displayDays = [...days].reverse()
  const maxKcal = Math.max(...displayDays.map(d => d.total_kcal ?? 0), 1000)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 64, padding: '0 4px' }}>
      {displayDays.map((d, i) => {
        const kcal = d.total_kcal ?? 0
        const h = Math.max((kcal / maxKcal) * 60, d.logged ? 4 : 0)
        const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'narrow' })
        const isToday = i === displayDays.length - 1
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: '100%', height: h, borderRadius: 4,
              background: isToday ? 'var(--blue)' : d.logged ? 'var(--gray4)' : 'var(--gray6)',
              transition: 'height 0.5s ease', minHeight: d.logged ? 4 : 0 }} />
            <div style={{ fontSize: 10, color: isToday ? 'var(--blue)' : 'var(--label3)', fontWeight: isToday ? 700 : 400 }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function WeightSparkline({ weights }: { weights: WeightEntry[] }) {
  if (weights.length < 2) return null
  const vals = weights.map(w => w.kg)
  const min = Math.min(...vals) - 0.5
  const max = Math.max(...vals) + 0.5
  const W = 260, H = 52
  const pts = weights.map((w, i) => {
    const x = (i / (weights.length - 1)) * W
    const y = H - ((w.kg - min) / (max - min)) * H
    return `${x},${y}`
  })
  const latest = weights[weights.length - 1]
  const prev7 = weights.find(w => {
    const d = new Date(latest.date).getTime() - new Date(w.date).getTime()
    return d >= 6 * 86400000 && d <= 8 * 86400000
  })
  const delta = prev7 ? latest.kg - prev7.kg : null
  const lastX = parseFloat(pts[pts.length - 1].split(',')[0])
  const lastY = parseFloat(pts[pts.length - 1].split(',')[1])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 700 }}>{latest.kg}kg</span>
        {delta !== null && (
          <span style={{ fontSize: 14, fontWeight: 600, color: delta < 0 ? 'var(--green)' : delta > 0 ? 'var(--red)' : 'var(--label2)' }}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}kg vs 7d ago
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Y-axis min/max labels */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: 2, paddingBottom: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--label3)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{max.toFixed(1)}</span>
          <span style={{ fontSize: 10, color: 'var(--label3)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{min.toFixed(1)}</span>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ display: 'block', height: 52, flex: 1 }}>
          <polyline points={pts.join(' ')} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={lastX} cy={lastY} r="4" fill="var(--blue)" />
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, paddingLeft: 30 }}>
        <span style={{ fontSize: 11, color: 'var(--label3)' }}>{weights[0].date}</span>
        <span style={{ fontSize: 11, color: 'var(--label3)' }}>{latest.date}</span>
      </div>
    </div>
  )
}

export default function GoalsPage() {
  const [stats, setStats] = useState<WeekStats | null>(null)
  const [goals, setGoals] = useState<Goals>({ calories: 2800, protein: 140, gym_days: 4 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GoalsUpdateInput>({})
  const [saving, setSaving] = useState(false)

  // Body weight — VPS-backed so it syncs across devices and the AI assistant
  // can read history. Initial state from localStorage cache (instant first
  // paint), then refreshed from VPS on mount. Same shape: WeightEntry[].
  const [weights, setWeights] = useState<WeightEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('weight_log') || '[]') } catch { return [] }
  })
  const [weightInput, setWeightInput] = useState('')
  const [showWeightInput, setShowWeightInput] = useState(false)
  const [direction, setDirection] = useState<Direction>(() => loadDirection(localStorage))

  useEffect(() => {
    api.getWeekStats().then(s => setStats(s)).catch(() => setStats(null))
    api.getGoals().then(g => setGoals(g.parsed)).catch(() => {})
    // Pull authoritative weight log from VPS, refresh local cache.
    api.getWeightLog(60).then(r => {
      const fresh = r.entries.map(e => ({ date: e.date, kg: e.kg }))
      setWeights(fresh)
      try { localStorage.setItem('weight_log', JSON.stringify(fresh)) } catch { /* quota */ }
    }).catch(() => { /* offline / VPS down — localStorage cache stays */ })
  }, [])

  // Adaptive-target signal — derived; computed once per render. Only actionable
  // after ≥14 days of weight logs to avoid yo-yo'ing on a single bad day.
  const trend = analyzeWeightTrend(weights)
  const suggestion = suggestCalorieTarget(goals.calories, trend, direction)

  function pickDirection(d: Direction) {
    setDirection(d)
    saveDirection(localStorage, d)
  }

  async function applySuggestion() {
    if (!suggestion.actionable) return
    setSaving(true)
    try {
      const updated = await api.updateGoals({ calories: suggestion.suggested }) as { ok: boolean; goals: Goals }
      setGoals(updated.goals)
      showToast(`Calorie target set to ${suggestion.suggested.toLocaleString()}`)
    } catch {
      showToast('Failed to apply suggestion', 'err')
    } finally { setSaving(false) }
  }

  async function saveGoals() {
    setSaving(true)
    try {
      const updated = await api.updateGoals(draft) as { ok: boolean; goals: Goals }
      setGoals(updated.goals)
      setDraft({})
      setEditing(false)
      showToast('Goals saved')
    } catch {
      showToast('Failed to save goals', 'err')
    } finally { setSaving(false) }
  }

  async function logWeight() {
    const kg = parseFloat(weightInput)
    if (isNaN(kg) || kg < 30 || kg > 300) {
      showToast('Weight must be between 30 and 300 kg', 'err')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    // Optimistic local update so the sparkline + suggested target update
    // immediately, then VPS write in the background.
    const updated = [...weights.filter(w => w.date !== today), { date: today, kg }]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-60)
    setWeights(updated)
    try { localStorage.setItem('weight_log', JSON.stringify(updated)) } catch { /* quota */ }
    setWeightInput('')
    setShowWeightInput(false)
    if (navigator.vibrate) navigator.vibrate(10)
    try {
      await api.addWeightEntry(kg, today)
      showToast(`Weight logged: ${kg}kg`)
    } catch (err) {
      showToast(`Saved locally — VPS sync failed (${String(err).slice(0, 40)})`, 'err')
    }
  }

  const loggedDays = stats?.logged_days ?? 0
  const avgKcal = stats?.avg_kcal ?? 0
  const workoutCount = stats?.workout_count ?? 0

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Goals</div>
          <button onClick={() => editing ? saveGoals() : setEditing(true)}
            style={{ background: editing ? 'var(--blue)' : 'none',
              border: editing ? 'none' : '1.5px solid var(--blue)', borderRadius: 20,
              padding: '8px 16px', color: editing ? '#fff' : 'var(--blue)',
              fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? '\u23F3' : editing ? 'Save' : 'Edit'}
          </button>
        </div>

        {/* This week */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, marginBottom: 12 }}>THIS WEEK</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Days logged', value: `${loggedDays}/7`, color: loggedDays >= 5 ? 'var(--green)' : loggedDays >= 3 ? 'var(--orange)' : 'var(--red)' },
              { label: 'Avg kcal',    value: avgKcal > 0 ? avgKcal.toLocaleString() : '\u2014', color: 'var(--blue)' },
              { label: 'Workouts',    value: `${workoutCount}/${goals.gym_days}`, color: workoutCount >= goals.gym_days ? 'var(--green)' : 'var(--orange)' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 11, color: 'var(--label2)', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
          {stats && <WeekChart days={stats.food_by_day} />}
        </div>

        {/* Body weight */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: weights.length > 0 ? 14 : 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>⚖️ Body Weight</div>
            <button onClick={() => setShowWeightInput(!showWeightInput)}
              style={{ background: showWeightInput ? 'none' : 'var(--blue)',
                border: showWeightInput ? '1.5px solid var(--gray4)' : 'none',
                borderRadius: 20, padding: '6px 14px', color: showWeightInput ? 'var(--label2)' : '#fff',
                fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {showWeightInput ? 'Cancel' : '+ Log'}
            </button>
          </div>
          {showWeightInput && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input className="input-field" style={{ flex: 1 }}
                type="number" inputMode="decimal" placeholder="e.g. 82.5"
                value={weightInput} onChange={e => setWeightInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && logWeight()} autoFocus />
              <button onClick={logWeight} disabled={!weightInput}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 12,
                  padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  opacity: !weightInput ? 0.5 : 1 }}>Save kg</button>
            </div>
          )}
          {weights.length > 0 ? (
            <WeightSparkline weights={weights} />
          ) : !showWeightInput && (
            <div style={{ fontSize: 14, color: 'var(--label2)', paddingTop: 8 }}>
              Tap + Log to start tracking your weight trend
            </div>
          )}

          {/* Direction picker — drives the adaptive-target rule. Persists across sessions. */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '0.5px solid var(--separator)' }}>
            <div style={{ fontSize: 12, color: 'var(--label2)', fontWeight: 600, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Goal direction
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['gain', 'maintain', 'lose'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => pickDirection(d)}
                  style={{
                    flex: 1,
                    background: direction === d ? 'var(--blue)' : 'var(--gray6)',
                    color: direction === d ? '#fff' : 'var(--label2)',
                    border: 'none', borderRadius: 10, padding: '8px 4px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >{d.charAt(0).toUpperCase() + d.slice(1)}</button>
              ))}
            </div>

            {/* Trend summary — always shown when we have any 14-day data, even if not actionable */}
            {trend && (
              <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 10 }}>
                {trend.reliable
                  ? `Trend: ${trend.weeklyChangeKg >= 0 ? '+' : ''}${trend.weeklyChangeKg.toFixed(2)} kg/wk over ${trend.days} days`
                  : `${trend.days} day(s) of data — need ≥14 for reliable trend`}
              </div>
            )}

            {/* Adaptive suggestion — actionable card when the trend is in/out of band */}
            {suggestion.actionable && (
              <button
                onClick={applySuggestion}
                disabled={saving}
                style={{
                  width: '100%', marginTop: 10,
                  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 12,
                  padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {suggestion.deltaKcal > 0 ? '+' : ''}{suggestion.deltaKcal} kcal → {suggestion.suggested.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{suggestion.reason}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.22)', padding: '4px 10px', borderRadius: 12 }}>
                  Apply
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Nutrition goals */}
        <div className="section-label">Nutrition goals</div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Daily Calories</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Current target: {goals.calories.toLocaleString()} kcal</div>
              </div>
              {editing ? (
                <input type="number"
                  style={{ width: 90, background: 'var(--gray6)', border: 'none', borderRadius: 10,
                    padding: '8px 12px', fontSize: 17, fontWeight: 700, textAlign: 'right',
                    color: 'var(--blue)', outline: 'none' }}
                  defaultValue={goals.calories}
                  onChange={e => setDraft(d => ({ ...d, calories: parseInt(e.target.value) }))} />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>{goals.calories.toLocaleString()}</div>
              )}
            </div>
            <MiniBar value={avgKcal} goal={goals.calories} color="var(--blue)" />
          </div>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Protein</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Current target: {goals.protein}g / day</div>
              </div>
              {editing ? (
                <input type="number"
                  style={{ width: 90, background: 'var(--gray6)', border: 'none', borderRadius: 10,
                    padding: '8px 12px', fontSize: 17, fontWeight: 700, textAlign: 'right',
                    color: 'var(--orange)', outline: 'none' }}
                  defaultValue={goals.protein}
                  onChange={e => setDraft(d => ({ ...d, protein: parseInt(e.target.value) }))} />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--orange)' }}>{goals.protein}g</div>
              )}
            </div>
            <MiniBar value={Math.round(avgKcal * 0.15 / 4)} goal={goals.protein} color="var(--orange)" />
          </div>
        </div>

        {/* Fitness goals */}
        <div className="section-label">Fitness goals</div>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Gym Days / Week</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Upper/Lower split</div>
              </div>
              {editing ? (
                <input type="number"
                  style={{ width: 60, background: 'var(--gray6)', border: 'none', borderRadius: 10,
                    padding: '8px 12px', fontSize: 17, fontWeight: 700, textAlign: 'right',
                    color: 'var(--green)', outline: 'none' }}
                  defaultValue={goals.gym_days}
                  onChange={e => setDraft(d => ({ ...d, gym_days: parseInt(e.target.value) }))} />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{goals.gym_days}x</div>
              )}
            </div>
            <MiniBar value={workoutCount} goal={goals.gym_days} color="var(--green)" />
          </div>
        </div>

        {/* Build info + force-refresh — escape hatch when an iOS PWA gets
            stuck on stale assets. Tap "Force refresh" to nuke the SW cache
            + reload, no need to uninstall the home-screen app. */}
        <div style={{
          marginTop: 28, paddingTop: 18,
          borderTop: '0.5px solid var(--separator)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--label3)',
        }}>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>
            build {BUILD_SHA} · {BUILD_DATE}
          </span>
          <button onClick={async () => {
            // Best-effort: unregister all SWs + clear all caches + reload.
            try {
              if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations()
                await Promise.all(regs.map(r => r.unregister()))
              }
              if ('caches' in window) {
                const keys = await caches.keys()
                await Promise.all(keys.map(k => caches.delete(k)))
              }
            } catch (err) {
              console.warn('Force refresh: SW/cache cleanup failed', err)
            }
            location.reload()
          }} style={{
            background: 'none', border: '1px solid var(--separator)',
            borderRadius: 8, padding: '4px 10px',
            color: 'var(--label2)', fontSize: 12, fontWeight: 500,
            cursor: 'pointer',
          }}>
            ↻ Force refresh
          </button>
        </div>

      </div>
    </div>
  )
}
