import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { TodayData } from '../api/client'
import { PROGRAM, getNextDay } from '../program'
import type { DayName } from '../program'

function CalorieRing({ current, goal }: { current: number; goal: number }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const pct = Math.min(current / goal, 1)
  const offset = circ * (1 - pct)
  const color = pct > 1 ? 'var(--red)' : pct > 0.85 ? 'var(--orange)' : 'var(--blue)'

  return (
    <div style={{ position: 'relative', width: 140, height: 140 }}>
      <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--gray5)" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={color} strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color }}>{current.toLocaleString()}</div>
        <div style={{ fontSize: 12, color: 'var(--label2)', fontWeight: 500 }}>of {goal.toLocaleString()} kcal</div>
      </div>
    </div>
  )
}

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const pct = Math.min(value / goal, 1)
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{label}</div>
      <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color, marginTop: 3 }}>{value}g</div>
    </div>
  )
}

interface Props { onNavigate: (tab: 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals') => void }

export default function Today({ onNavigate }: Props) {
  const [data, setData] = useState<TodayData | null>(null)
  const [_loading, setLoading] = useState(true)
  const [quickEntry, setQuickEntry] = useState('')
  const [quickKcal, setQuickKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nextWorkout, setNextWorkout] = useState<DayName>('Upper A')
  const inputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' })

  useEffect(() => {
    api.getToday().then(setData).finally(() => setLoading(false))
    api.getWorkouts(20).then(workouts => {
      const recentTitles = [...workouts].reverse().map(w => w.title)
      setNextWorkout(getNextDay(recentTitles))
    })
  }, [])

  async function handleQuickLog(e: React.FormEvent) {
    e.preventDefault()
    if (!quickEntry || !quickKcal) return
    setSubmitting(true)
    try {
      const meal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
      await api.addFood({ meal, description: quickEntry, kcal: parseInt(quickKcal) })
      const updated = await api.getToday()
      setData(updated)
      setQuickEntry('')
      setQuickKcal('')
      if (navigator.vibrate) navigator.vibrate(10)
    } catch (err) {
      console.error('Quick log failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const total = data?.total_kcal ?? 0
  const goals = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
  const protein = data?.entries.reduce((acc, e) => acc + Math.round(e.kcal * 0.15), 0) ?? 0

  const nextDay = PROGRAM[nextWorkout]
  const defaultWorkoutDays: Record<string, string> = { Tuesday: 'Upper A', Wednesday: 'Lower A', Friday: 'Upper B', Sunday: 'Lower B' }
  const isWorkoutDay = dayName in defaultWorkoutDays

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 500, marginBottom: 2 }}>
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>{greeting}, Brody</div>
        </div>

        {/* Calorie Card */}
        <div className="card" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <CalorieRing current={total} goal={goals.calories} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <MacroBar label="Protein" value={protein} goal={goals.protein} color="var(--orange)" />
              <MacroBar label="Carbs" value={Math.round(total * 0.45 / 4)} goal={280} color="var(--green)" />
              <MacroBar label="Fat" value={Math.round(total * 0.3 / 9)} goal={73} color="var(--purple)" />
            </div>
          </div>

          {/* Quick log */}
          <form onSubmit={handleQuickLog} style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="input-field"
              style={{ flex: 1, fontSize: 15, padding: '10px 12px' }}
              placeholder="What did you eat?"
              value={quickEntry}
              onChange={e => setQuickEntry(e.target.value)}
            />
            <input
              className="input-field"
              style={{ width: 70, fontSize: 15, padding: '10px 10px' }}
              placeholder="kcal"
              type="number"
              value={quickKcal}
              onChange={e => setQuickKcal(e.target.value)}
            />
            <button
              type="submit"
              disabled={submitting || !quickEntry || !quickKcal}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (!quickEntry || !quickKcal) ? 0.5 : 1, transition: 'opacity 0.15s' }}
            >
              {submitting ? '…' : 'Add'}
            </button>
          </form>
        </div>

        {/* Workout card */}
        <div
          onClick={() => onNavigate('workout')}
          style={{
            background: isWorkoutDay ? 'var(--blue)' : 'var(--card)',
            borderRadius: 16, padding: '14px 16px', marginBottom: 12,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
          }}
        >
          <div style={{ fontSize: 32 }}>💪</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: isWorkoutDay ? '#fff' : 'var(--label)' }}>
              {isWorkoutDay ? `Today — ${nextDay.name}` : `Next up — ${nextDay.name}`}
            </div>
            <div style={{ fontSize: 13, color: isWorkoutDay ? 'rgba(255,255,255,0.75)' : 'var(--label2)', marginTop: 2 }}>
              {nextDay.focus} · {nextDay.exercises.length} exercises
            </div>
            <div style={{ fontSize: 12, color: isWorkoutDay ? 'rgba(255,255,255,0.6)' : 'var(--label3)', marginTop: 3 }}>
              {nextDay.exercises.slice(0, 3).map(e => e.name).join(' · ')}
            </div>
          </div>
          <div style={{ fontSize: 18, color: isWorkoutDay ? 'rgba(255,255,255,0.7)' : 'var(--label3)' }}>›</div>
        </div>

        {/* Today's entries */}
        {(data?.entries.length ?? 0) > 0 && (
          <>
            <div className="section-label">Today's log</div>
            <div className="card">
              {data?.entries.map((e, i) => (
                <div key={i} className="list-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{e.meal}</div>
                    <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 1 }}>
                      {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)' }}>
                    ~{e.kcal.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Quick nav cards */}
        <div className="section-label">Quick access</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Fridge',    sub: 'What can I make?', tab: 'fridge'    as const, icon: '🥗', color: 'var(--green)'  },
            { label: 'Nutrition', sub: 'Full food log',    tab: 'nutrition' as const, icon: '🍽️', color: 'var(--orange)' },
            { label: 'Goals',     sub: 'Weekly stats',    tab: 'goals'     as const, icon: '📊', color: 'var(--purple)' },
            { label: 'Workout',   sub: 'Log a session',   tab: 'workout'   as const, icon: '🏋️', color: 'var(--blue)'   },
          ].map(item => (
            <button
              key={item.tab}
              onClick={() => onNavigate(item.tab)}
              style={{ background: 'var(--card)', borderRadius: 14, padding: '16px 14px', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'opacity 0.15s', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <div style={{ fontSize: 28 }}>{item.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: item.color }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--label2)' }}>{item.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
