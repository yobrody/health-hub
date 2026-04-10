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
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color }}>{current.toLocaleString()}</div>
        <div style={{ fontSize: 12, color: 'var(--label2)', fontWeight: 500 }}>of {goal.toLocaleString()} kcal</div>
      </div>
    </div>
  )
}

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{label}</div>
      <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value / goal, 1) * 100}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color, marginTop: 3 }}>{value}g</div>
    </div>
  )
}

function WaterTracker() {
  const GOAL = 8
  const todayKey = new Date().toDateString()
  const [count, setCount] = useState(() => {
    try {
      const s = localStorage.getItem('water_intake')
      if (s) { const p = JSON.parse(s); if (p.date === todayKey) return p.count }
    } catch {}
    return 0
  })

  function set(n: number) {
    const next = Math.max(0, Math.min(12, n))
    setCount(next)
    try { localStorage.setItem('water_intake', JSON.stringify({ date: todayKey, count: next })) } catch {}
    if (navigator.vibrate) navigator.vibrate(5)
  }

  const done = count >= GOAL
  return (
    <div className="card" style={{ padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 24 }}>💧</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Water {done ? '\u2705' : ''}
          </div>
          <div style={{ fontSize: 13, color: done ? 'var(--green)' : 'var(--label2)', fontWeight: done ? 600 : 400 }}>
            {count}/{GOAL} glasses{done ? ' \u2014 goal hit!' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <button key={i} onClick={() => set(i < count ? i : i + 1)}
              style={{ flex: 1, height: 20, borderRadius: 4, border: 'none', cursor: 'pointer',
                background: i < count ? 'var(--blue)' : 'var(--gray5)', transition: 'background 0.18s',
                WebkitTapHighlightColor: 'transparent' }} />
          ))}
          {count > 0 && (
            <button onClick={() => set(count - 1)} style={{ background: 'none', border: 'none',
              color: 'var(--label3)', fontSize: 16, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>−</button>
          )}
        </div>
      </div>
    </div>
  )
}

interface Props { onNavigate: (tab: 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'skincare') => void }

export default function Today({ onNavigate }: Props) {
  const [data, setData] = useState<TodayData | null>(null)
  const [_loading, setLoading] = useState(true)
  const [quickEntry, setQuickEntry] = useState('')
  const [quickKcal, setQuickKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nextWorkout, setNextWorkout] = useState<DayName>('Upper A')
  const [coachFeed, setCoachFeed] = useState<{ date: string; title: string; hardSets: number; proteinTarget: number; grocery: string[] } | null>(null)
  const [timelineDone, setTimelineDone] = useState<Record<string, boolean>>({})
  const [showCelebrate, setShowCelebrate] = useState(false)
  const [displayName, setDisplayName] = useState('Brody')
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
    try {
      const raw = localStorage.getItem('coach_feed')
      if (raw) setCoachFeed(JSON.parse(raw))
    } catch {}
    try {
      const raw = localStorage.getItem('today_timeline_done')
      if (raw) setTimelineDone(JSON.parse(raw))
    } catch {}
    try {
      const raw = localStorage.getItem('user_profile')
      if (raw) {
        const p = JSON.parse(raw) as { name?: string }
        if (p.name) setDisplayName(p.name)
      }
    } catch {}

    // Sync name from API — update display and localStorage cache
    api.getProfile().then(profile => {
      if (profile.name) setDisplayName(profile.name)
      try {
        const existing = JSON.parse(localStorage.getItem('user_profile') || '{}')
        localStorage.setItem('user_profile', JSON.stringify({ ...existing, ...profile }))
      } catch {}
    }).catch(() => {})
  }, [])

  useEffect(() => {
    try { localStorage.setItem('today_timeline_done', JSON.stringify(timelineDone)) } catch {}
  }, [timelineDone])

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
    } catch (err) { console.error('Quick log failed:', err) }
    finally { setSubmitting(false) }
  }

  const total = data?.total_kcal ?? 0
  const goals = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
  const protein = data?.entries.reduce((acc, e) => acc + Math.round(e.kcal * 0.15), 0) ?? 0

  const nextDay = PROGRAM[nextWorkout]
  const defaultWorkoutDays: Record<string, string> = { Tuesday: 'Upper A', Wednesday: 'Lower A', Friday: 'Upper B', Sunday: 'Lower B' }
  const isWorkoutDay = dayName in defaultWorkoutDays
  const waterDone = (() => {
    try {
      const s = localStorage.getItem('water_intake')
      if (!s) return false
      const p = JSON.parse(s)
      return p.date === new Date().toDateString() && p.count >= 8
    } catch { return false }
  })()
  const skinDone = (() => {
    try {
      const s = localStorage.getItem('skincare_log')
      if (!s) return false
      const list = JSON.parse(s) as Array<{ date: string; morning: string[]; evening: string[] }>
      const today = new Date().toISOString().slice(0, 10)
      const row = list.find(r => r.date === today)
      if (!row) return false
      return row.morning.length >= 3 || row.evening.length >= 3
    } catch { return false }
  })()
  const timeline = [
    { id: 'water', label: 'Hit water goal', done: waterDone || !!timelineDone.water, go: () => {}, action: 'Track above' },
    { id: 'food', label: 'Log at least one meal', done: (data?.entries.length ?? 0) > 0 || !!timelineDone.food, go: () => onNavigate('nutrition'), action: 'Open nutrition' },
    { id: 'skin', label: 'Complete skincare routine', done: skinDone || !!timelineDone.skin, go: () => onNavigate('skincare'), action: 'Open skincare' },
    { id: 'train', label: 'Check workout progression', done: !!coachFeed || !!timelineDone.train, go: () => onNavigate('workout'), action: 'Open workout' },
  ]
  const nextAction = timeline.find(t => !t.done) ?? null
  const allDone = timeline.every(t => t.done)
  const nutritionPct = Math.min(Math.round((total / Math.max(goals.calories, 1)) * 100), 100)
  const proteinPct = Math.min(Math.round((protein / Math.max(goals.protein, 1)) * 100), 100)
  const summaryStats = [
    { label: 'Nutrition', value: `${nutritionPct}%`, tone: 'var(--blue)' },
    { label: 'Protein', value: `${proteinPct}%`, tone: 'var(--orange)' },
    { label: 'Hydration', value: waterDone ? '100%' : '0%', tone: 'var(--green)' },
    { label: 'Skincare', value: skinDone ? 'Done' : 'Todo', tone: 'var(--purple)' },
  ]

  useEffect(() => {
    if (!allDone) return
    const todayKey = new Date().toISOString().slice(0, 10)
    const saved = localStorage.getItem('celebrated_today')
    if (saved === todayKey) return
    setShowCelebrate(true)
    localStorage.setItem('celebrated_today', todayKey)
    const t = window.setTimeout(() => setShowCelebrate(false), 2200)
    if (navigator.vibrate) navigator.vibrate([30, 60, 30])
    return () => window.clearTimeout(t)
  }, [allDone])

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 500, marginBottom: 2 }}>
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>{greeting}, {displayName}</div>
        </div>

        <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {summaryStats.map((s) => (
              <div key={s.label} style={{ textAlign: 'center', borderRadius: 10, padding: '8px 6px', background: 'var(--gray6)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: s.tone }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--label2)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Calorie card */}
        <div className="card" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <CalorieRing current={total} goal={goals.calories} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <MacroBar label="Protein" value={protein} goal={goals.protein} color="var(--orange)" />
              <MacroBar label="Carbs" value={Math.round(total * 0.45 / 4)} goal={280} color="var(--green)" />
              <MacroBar label="Fat" value={Math.round(total * 0.3 / 9)} goal={73} color="var(--purple)" />
            </div>
          </div>
          <form onSubmit={handleQuickLog} style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <input ref={inputRef} className="input-field"
              style={{ flex: 1, fontSize: 15, padding: '10px 12px' }}
              placeholder="What did you eat?"
              value={quickEntry} onChange={e => setQuickEntry(e.target.value)} />
            <input className="input-field"
              style={{ width: 70, fontSize: 15, padding: '10px 10px' }}
              placeholder="kcal" type="number" value={quickKcal}
              onChange={e => setQuickKcal(e.target.value)} />
            <button type="submit" disabled={submitting || !quickEntry || !quickKcal}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10,
                padding: '10px 14px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                opacity: (!quickEntry || !quickKcal) ? 0.5 : 1 }}>
              {submitting ? '\u23F3' : 'Add'}
            </button>
          </form>
        </div>

        {/* Water tracker */}
        <WaterTracker />

        {/* Workout card */}
        <div onClick={() => onNavigate('workout')} style={{
          background: isWorkoutDay ? 'var(--blue)' : 'var(--card)',
          borderRadius: 16, padding: '14px 16px', marginBottom: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 32 }}>🏋️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: isWorkoutDay ? '#fff' : 'var(--label)' }}>
              {isWorkoutDay ? `Today \u2014 ${nextDay.name}` : `Next up \u2014 ${nextDay.name}`}
            </div>
            <div style={{ fontSize: 13, color: isWorkoutDay ? 'rgba(255,255,255,0.75)' : 'var(--label2)', marginTop: 2 }}>
              {nextDay.focus} \u00B7 {nextDay.exercises.length} exercises
            </div>
            <div style={{ fontSize: 12, color: isWorkoutDay ? 'rgba(255,255,255,0.6)' : 'var(--label3)', marginTop: 3 }}>
              {nextDay.exercises.slice(0, 3).map(e => e.name).join(' \u00B7 ')}
            </div>
          </div>
          <div style={{ fontSize: 18, color: isWorkoutDay ? 'rgba(255,255,255,0.7)' : 'var(--label3)' }}>❯</div>
        </div>

        {coachFeed && (
          <div className="card" style={{ padding: '14px 16px', marginBottom: 12, border: '1px solid rgba(52,199,89,0.22)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 5 }}>AUTO IMPROVEMENT</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
              After {coachFeed.title}: target +{coachFeed.proteinTarget}g protein
            </div>
            <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 10 }}>
              {coachFeed.hardSets} hard sets logged. Suggested groceries: {coachFeed.grocery.slice(0, 3).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onNavigate('nutrition')} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '9px 10px', background: 'var(--blue)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Log meal
              </button>
              <button onClick={() => onNavigate('fridge')} style={{ flex: 1, border: '1px solid var(--separator)', borderRadius: 10, padding: '9px 10px', background: 'var(--card)', color: 'var(--label)', fontWeight: 600, cursor: 'pointer' }}>
                Open grocery
              </button>
            </div>
          </div>
        )}

        <div className="section-label">Coach timeline</div>
        <div className="card" style={{ marginBottom: 12 }}>
          {timeline.map((item) => (
            <div key={item.id} className="list-row" style={{ gap: 10 }}>
              <button
                onClick={() => setTimelineDone(s => ({ ...s, [item.id]: !item.done }))}
                style={{ width: 26, height: 26, borderRadius: 13, border: 'none', background: item.done ? 'var(--green)' : 'var(--gray5)', color: item.done ? '#fff' : 'var(--label3)', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
              >{item.done ? '✓' : ''}</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.65 : 1 }}>
                  {item.label}
                </div>
              </div>
              <button onClick={item.go} disabled={item.action === 'Track above'} style={{ background: 'none', border: 'none', color: item.action === 'Track above' ? 'var(--label3)' : 'var(--blue)', fontWeight: 600, cursor: item.action === 'Track above' ? 'default' : 'pointer' }}>
                {item.action}
              </button>
            </div>
          ))}
        </div>

        {nextAction && (
          <div className="card" style={{ padding: '12px 14px', marginBottom: 12, border: '1px solid rgba(10,132,255,0.24)' }}>
            <div style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 800, letterSpacing: '0.05em', marginBottom: 4 }}>AUTOPILOT</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              Next best action: {nextAction.label}
            </div>
            <button
              className="action-pill tap-lift"
              onClick={nextAction.go}
              disabled={nextAction.action === 'Track above'}
              style={{
                background: nextAction.action === 'Track above' ? 'var(--gray5)' : 'var(--blue)',
                color: nextAction.action === 'Track above' ? 'var(--label2)' : '#fff',
                opacity: nextAction.action === 'Track above' ? 0.8 : 1,
              }}
            >
              {nextAction.action}
            </button>
          </div>
        )}

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
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)' }}>~{e.kcal.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Quick nav */}
        <div className="section-label">Quick access</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Fridge',    sub: 'What can I make?', tab: 'fridge'    as const, icon: '\u{1F9CA}', color: 'var(--blue)'   },
            { label: 'Nutrition', sub: 'Full food log',    tab: 'nutrition' as const, icon: '\u{1F37D}\uFE0F', color: 'var(--orange)' },
            { label: 'Skincare',  sub: 'Morning + evening',tab: 'skincare'  as const, icon: '\u{1F9F4}', color: 'var(--purple)' },
            { label: 'Workout',   sub: 'Log a session',    tab: 'workout'   as const, icon: '\u{1F3CB}\uFE0F', color: 'var(--green)'  },
          ].map(item => (
            <button key={item.tab} className="tap-lift" onClick={() => onNavigate(item.tab)}
              style={{ background: 'var(--card)', borderRadius: 14, padding: '16px 14px', border: 'none',
                cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6,
                transition: 'opacity 0.15s', WebkitTapHighlightColor: 'transparent' }}>
              <div style={{ fontSize: 28 }}>{item.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: item.color }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--label2)' }}>{item.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {showCelebrate && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="celebrate-pop" style={{ background: 'var(--card)', borderRadius: 18, padding: '12px 16px', border: '1px solid var(--separator)', boxShadow: '0 8px 22px rgba(0,0,0,0.12)' }}>
            <div style={{ fontSize: 22, textAlign: 'center' }}>🎉 🌟 🎉</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Daily checklist complete!</div>
          </div>
        </div>
      )}
    </div>
  )
}
