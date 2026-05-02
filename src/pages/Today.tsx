import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { TodayData, WeekStats, FridgeData } from '../api/client'
import { PROGRAM, getNextDay } from '../program'
import type { DayName } from '../program'
import { loadProducts, lowStockProducts } from '../lib/skincare-products'

function CalorieRing({ current, goal }: { current: number; goal: number }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const pct = Math.min(current / goal, 1)
  const offset = circ * (1 - pct)
  const color = pct > 1 ? 'var(--red)' : pct > 0.85 ? 'var(--orange)' : 'var(--blue)'
  return (
    <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
      <svg width="130" height="130" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--gray5)" strokeWidth="11" />
        <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-1px', color, lineHeight: 1 }}>{current.toLocaleString()}</div>
        <div style={{ fontSize: 11, color: 'var(--label2)', fontWeight: 500, marginTop: 2 }}>of {goal.toLocaleString()}</div>
      </div>
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
    } catch { /* ignore corrupt JSON */ }
    return 0
  })

  function set(n: number) {
    const next = Math.max(0, Math.min(12, n))
    setCount(next)
    try { localStorage.setItem('water_intake', JSON.stringify({ date: todayKey, count: next })) } catch { /* ignore quota errors */ }
    if (navigator.vibrate) navigator.vibrate(5)
  }

  const done = count >= GOAL
  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 22 }}>💧</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Water{done ? ' ✓' : ''}</div>
          <div style={{ fontSize: 13, color: done ? 'var(--green)' : 'var(--label2)', fontWeight: done ? 600 : 400 }}>
            {count}/{GOAL}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <button key={i} onClick={() => set(i < count ? i : i + 1)}
              style={{ flex: 1, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer',
                background: i < count ? 'var(--blue)' : 'var(--gray5)',
                transition: 'background 0.18s',
                WebkitTapHighlightColor: 'transparent' }} />
          ))}
          {count > 0 && (
            <button onClick={() => set(count - 1)} style={{ background: 'none', border: 'none',
              color: 'var(--label3)', fontSize: 18, cursor: 'pointer', padding: '0 4px', flexShrink: 0, lineHeight: 1 }}>−</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonHero() {
  return (
    <div className="card" style={{ padding: '18px 16px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        <div className="skeleton" style={{ width: 130, height: 130, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="skeleton" style={{ height: 28, width: '70%' }} />
          <div className="skeleton" style={{ height: 14, width: '50%' }} />
          <div className="skeleton" style={{ height: 6, width: '100%' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="skeleton" style={{ flex: 1, height: 42 }} />
        <div className="skeleton" style={{ width: 68, height: 42 }} />
        <div className="skeleton" style={{ width: 58, height: 42 }} />
      </div>
    </div>
  )
}

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'skincare' | 'lists' | 'agenda'
interface Props {
  onNavigate: (tab: Tab) => void
  onToggleTheme: () => void
  themeIcon: string
}

export default function Today({ onNavigate, onToggleTheme, themeIcon }: Props) {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [quickEntry, setQuickEntry] = useState('')
  const [quickKcal, setQuickKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nextWorkout, setNextWorkout] = useState<DayName>('Upper A')
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [fridgeData, setFridgeData] = useState<FridgeData | null>(null)
  const [showCelebrate, setShowCelebrate] = useState(false)
  const [displayName, setDisplayName] = useState('Brody')
  const inputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    api.getToday()
      .then(d => { setData(d); setApiError(false) })
      .catch(() => setApiError(true))
      .finally(() => setLoading(false))

    api.getWeekStats().then(setWeekStats).catch(() => {})
    api.getFridge().then(setFridgeData).catch(() => {})
    api.getWorkouts(20).then(workouts => {
      const recentTitles = [...workouts].reverse().map(w => w.title)
      setNextWorkout(getNextDay(recentTitles))
    }).catch(() => {})

    try {
      const raw = localStorage.getItem('user_profile')
      if (raw) {
        const p = JSON.parse(raw) as { name?: string }
        if (p.name) setDisplayName(p.name)
      }
    } catch { /* ignore corrupt JSON */ }

    api.getProfile().then(profile => {
      if (profile.name) setDisplayName(profile.name)
      try {
        const existing = JSON.parse(localStorage.getItem('user_profile') || '{}')
        localStorage.setItem('user_profile', JSON.stringify({ ...existing, ...profile }))
      } catch { /* ignore quota errors */ }
    }).catch(() => {})
  }, [])

  async function handleQuickLog(e: React.FormEvent) {
    e.preventDefault()
    if (!quickEntry || !quickKcal) return
    const kcalNum = parseInt(quickKcal)
    const meal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
    const t = new Date().toTimeString().slice(0, 5)

    setData(prev => prev ? {
      ...prev,
      total_kcal: prev.total_kcal + kcalNum,
      entries: [...prev.entries, { time: t, meal, items: `- ${quickEntry} (~${kcalNum} kcal)`, kcal: kcalNum, protein_g: 0 }],
    } : prev)
    const savedEntry = quickEntry
    setQuickEntry('')
    setQuickKcal('')
    if (navigator.vibrate) navigator.vibrate(10)
    inputRef.current?.focus()

    setSubmitting(true)
    try {
      await api.addFood({ meal, description: savedEntry, kcal: kcalNum })
      showToast(`${savedEntry} logged`)
      api.getToday().then(setData).catch(() => {})
    } catch {
      showToast('Failed to save — check connection', 'err')
      api.getToday().then(setData).catch(() => {})
    } finally {
      setSubmitting(false)
    }
  }

  const total = data?.total_kcal ?? 0
  const goals = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
  const protein = data?.entries.reduce((acc, e) => acc + (e.protein_g ?? 0), 0) ?? 0

  const skincareStatus = (() => {
    try {
      const s = localStorage.getItem('skincare_log')
      if (!s) return { am: false, pm: false }
      const list = JSON.parse(s) as Array<{ date: string; morning: string[]; evening: string[] }>
      const today = now.toISOString().slice(0, 10)
      const row = list.find(r => r.date === today)
      if (!row) return { am: false, pm: false }
      return { am: row.morning.length >= 3, pm: row.evening.length >= 3 }
    } catch { return { am: false, pm: false } }
  })()

  const staleFridgeItems = (() => {
    if (!fridgeData) return []
    const cutoff = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
    return [...fridgeData.fridge, ...fridgeData.pantry]
      .filter(item => {
        if (!item.added) return false
        try { return new Date(item.added) < cutoff } catch { return false }
      }).slice(0, 3)
  })()

  // Skincare products under 14 days remaining at current pace. Read each render —
  // products are localStorage-only, no backend round trip, so this is cheap.
  const lowStockSkincare = lowStockProducts(loadProducts(localStorage)).slice(0, 3)

  useEffect(() => {
    if (!data || total < goals.calories * 0.95) return
    const todayKey = new Date().toISOString().slice(0, 10)
    const saved = localStorage.getItem('celebrated_today')
    if (saved === todayKey) return
    setShowCelebrate(true)
    localStorage.setItem('celebrated_today', todayKey)
    const timer = window.setTimeout(() => setShowCelebrate(false), 2200)
    if (navigator.vibrate) navigator.vibrate([30, 60, 30])
    return () => window.clearTimeout(timer)
  }, [data, goals.calories, total])

  const nextDay = PROGRAM[nextWorkout]

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 500, marginBottom: 2 }}>
              {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>{greeting}, {displayName}</div>
          </div>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            title="Toggle theme"
            style={{ marginTop: 4 }}
          >
            {themeIcon}
          </button>
        </div>

        {/* Hero card — skeleton while loading */}
        {loading ? <SkeletonHero /> : apiError ? (
          <div className="card" style={{ padding: '24px 16px', marginBottom: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Couldn't load today's data</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginBottom: 16 }}>Check your connection</div>
            <button className="btn-primary" style={{ maxWidth: 160, margin: '0 auto' }}
              onClick={() => { setLoading(true); setApiError(false); api.getToday().then(d => { setData(d) }).catch(() => setApiError(true)).finally(() => setLoading(false)) }}>
              Retry
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: '18px 16px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
              <CalorieRing current={total} goal={goals.calories} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color: total > goals.calories ? 'var(--red)' : 'var(--label)' }}>
                    {total.toLocaleString()} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--label2)' }}>/ {goals.calories.toLocaleString()} kcal</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                    {total < goals.calories
                      ? `${(goals.calories - total).toLocaleString()} kcal remaining`
                      : 'Goal reached!'}
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>
                      {protein}g <span style={{ fontWeight: 400, color: 'var(--label2)' }}>/ {goals.protein}g protein</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--label3)' }}>
                      {Math.round(Math.min(protein / goals.protein, 1) * 100)}%
                    </div>
                  </div>
                  <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(protein / goals.protein, 1) * 100}%`, background: 'var(--orange)', borderRadius: 3, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleQuickLog} style={{ display: 'flex', gap: 8 }}>
              <input ref={inputRef} className="input-field"
                style={{ flex: 1, fontSize: 15, padding: '10px 12px' }}
                placeholder="What did you eat?"
                value={quickEntry} onChange={e => setQuickEntry(e.target.value)} />
              <input className="input-field"
                style={{ width: 72, fontSize: 15, padding: '10px 8px', textAlign: 'center' }}
                placeholder="kcal" type="number" inputMode="numeric" value={quickKcal}
                onChange={e => setQuickKcal(e.target.value)} />
              <button type="submit" disabled={submitting || !quickEntry || !quickKcal}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10,
                  padding: '10px 14px', fontSize: 15, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  opacity: (!quickEntry || !quickKcal) ? 0.45 : 1, transition: 'opacity 0.15s',
                  minWidth: 54 }}>
                {submitting ? (
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : 'Add'}
              </button>
            </form>
          </div>
        )}

        {/* Quick action pills */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {([
            { label: 'Log food',      tab: 'nutrition' as const, color: 'var(--blue)' },
            { label: 'Log workout',   tab: 'workout'   as const, color: 'var(--green)' },
            { label: 'Check fridge',  tab: 'fridge'    as const, color: 'var(--purple)' },
          ]).map(item => (
            <button key={item.tab} onClick={() => onNavigate(item.tab)}
              style={{ flex: 1, padding: '11px 6px', borderRadius: 12, border: 'none',
                background: 'var(--card)', color: item.color, fontWeight: 700, fontSize: 13,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)', transition: 'opacity 0.12s' }}
              onTouchStart={e => (e.currentTarget.style.opacity = '0.7')}
              onTouchEnd={e => (e.currentTarget.style.opacity = '1')}>
              {item.label}
            </button>
          ))}
        </div>

        {/* Personal assistant shortcuts */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => onNavigate('agenda')}
            style={{ flex: 1, padding: '11px 6px', borderRadius: 12, border: 'none',
              background: 'var(--card)', color: 'var(--blue)', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            Today's Plan
          </button>
          <button onClick={() => onNavigate('lists')}
            style={{ flex: 1, padding: '11px 6px', borderRadius: 12, border: 'none',
              background: 'var(--card)', color: 'var(--orange)', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            Lists
          </button>
        </div>

        {/* Status strip */}
        <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onNavigate('workout')} style={{ flex: 1, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
              <div style={{ fontSize: 11, color: 'var(--label2)', fontWeight: 600, marginBottom: 3 }}>WORKOUTS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: weekStats && weekStats.workout_count >= weekStats.goal_gym_days ? 'var(--green)' : 'var(--label)' }}>
                {weekStats?.workout_count ?? '—'}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--label2)' }}>/{weekStats?.goal_gym_days ?? goals.gym_days} this wk</span>
              </div>
            </button>
            <button onClick={() => onNavigate('skincare')} style={{ flex: 1, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
              <div style={{ fontSize: 11, color: 'var(--label2)', fontWeight: 600, marginBottom: 3 }}>SKINCARE</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                <span style={{ color: skincareStatus.am ? 'var(--green)' : 'var(--label3)' }}>AM {skincareStatus.am ? '✓' : '○'}</span>
                <span style={{ margin: '0 6px', color: 'var(--label3)' }}>·</span>
                <span style={{ color: skincareStatus.pm ? 'var(--green)' : 'var(--label3)' }}>PM {skincareStatus.pm ? '✓' : '○'}</span>
              </div>
            </button>
          </div>
        </div>

        {/* Fridge alert */}
        {staleFridgeItems.length > 0 && (
          <button onClick={() => onNavigate('fridge')} style={{ width: '100%', background: 'none', border: '1px solid rgba(255,149,0,0.35)', borderRadius: 14, padding: '10px 14px', marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>Use these soon</div>
              <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                {staleFridgeItems.map(i => i.name).join(' · ')}
              </div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--label3)' }}>❯</span>
          </button>
        )}

        {/* Skincare low-stock alert — surfaces products under 14 days remaining
            so the user can reorder before they actually run out. Tap routes to
            Skincare where the manager sheet has the per-product Reorder button. */}
        {lowStockSkincare.length > 0 && (
          <button onClick={() => onNavigate('skincare')} style={{ width: '100%', background: 'none', border: '1px solid rgba(255,149,0,0.35)', borderRadius: 14, padding: '10px 14px', marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>Skincare running low</div>
              <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                {lowStockSkincare.map(p => p.name).join(' · ')}
              </div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--label3)' }}>❯</span>
          </button>
        )}

        {/* Water */}
        <WaterTracker />

        {/* Next workout */}
        <div onClick={() => onNavigate('workout')} style={{
          background: 'var(--card)', borderRadius: 16, padding: '14px 16px', marginBottom: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 30 }}>🏋️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Next — {nextDay.name}</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
              {nextDay.focus} · {nextDay.exercises.length} exercises
            </div>
          </div>
          <div style={{ fontSize: 16, color: 'var(--label3)' }}>❯</div>
        </div>

        {/* Today's log */}
        {(data?.entries.length ?? 0) > 0 && (
          <>
            <div className="section-label">Today's log</div>
            <div className="card" style={{ marginBottom: 12 }}>
              {data?.entries.map((e, i) => (
                <div key={i} className="list-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{e.meal}</div>
                    <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 1 }}>
                      {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal.*?\)/, '')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label2)' }}>~{e.kcal} kcal</div>
                    {(e.protein_g ?? 0) > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--orange)' }}>{e.protein_g}g protein</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>

      {/* Celebration overlay */}
      {showCelebrate && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="celebrate-pop" style={{ background: 'var(--card)', borderRadius: 20, padding: '16px 22px', border: '1px solid var(--separator)', boxShadow: '0 8px 28px rgba(0,0,0,0.14)', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>🎉</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Calorie goal reached!</div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
