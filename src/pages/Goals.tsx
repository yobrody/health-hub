import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WeekStats, Goals, GoalsUpdateInput } from '../api/client'
import { MEAL_PLAN, DEFAULT_SCHEDULE, PROGRAM } from '../program'
// suppress unused import warnings for things referenced elsewhere
void MEAL_PLAN; void DEFAULT_SCHEDULE; void PROGRAM

type WeightEntry = { date: string; kg: number }

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
      <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ display: 'block', height: 52 }}>
        <polyline points={pts.join(' ')} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX} cy={lastY} r="4" fill="var(--blue)" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
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

  // Body weight (localStorage, 30-day history)
  const [weights, setWeights] = useState<WeightEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('weight_log') || '[]') } catch { return [] }
  })
  const [weightInput, setWeightInput] = useState('')
  const [showWeightInput, setShowWeightInput] = useState(false)

  useEffect(() => {
    api.getWeekStats().then(s => setStats(s)).catch(() => setStats(null))
    api.getGoals().then(g => setGoals(g.parsed)).catch(() => {})
  }, [])

  async function saveGoals() {
    setSaving(true)
    try {
      const updated = await api.updateGoals(draft) as { ok: boolean; goals: Goals }
      setGoals(updated.goals)
      setDraft({})
      setEditing(false)
    } finally { setSaving(false) }
  }

  function logWeight() {
    const kg = parseFloat(weightInput)
    if (isNaN(kg) || kg < 20 || kg > 300) return
    const today = new Date().toISOString().slice(0, 10)
    const updated = [...weights.filter(w => w.date !== today), { date: today, kg }]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-60)
    setWeights(updated)
    try { localStorage.setItem('weight_log', JSON.stringify(updated)) } catch {}
    setWeightInput('')
    setShowWeightInput(false)
    if (navigator.vibrate) navigator.vibrate(10)
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
        </div>

        {/* Nutrition goals */}
        <div className="section-label">Nutrition goals</div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Daily Calories</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Target 2700–3000 kcal</div>
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
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Target 130–150g/day</div>
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

      </div>
    </div>
  )
}
