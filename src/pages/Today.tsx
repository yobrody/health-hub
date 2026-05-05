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
    <div className="relative w-[130px] h-[130px] flex-shrink-0">
      <svg width="130" height="130" className="-rotate-90">
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--gray5)" strokeWidth="11" />
        <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[26px] font-bold leading-none tabular-nums" style={{ letterSpacing: '-1px', color }}>{current.toLocaleString()}</div>
        <div className="text-[11px] font-medium mt-0.5 text-[var(--label2)]">of {goal.toLocaleString()}</div>
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
    <div className="card mb-3 px-4 py-[14px] flex items-center gap-3">
      <div className="text-[22px]">💧</div>
      <div className="flex-1">
        <div className="flex justify-between items-center mb-[7px]">
          <div className="text-sm font-semibold">Water{done ? ' ✓' : ''}</div>
          <div className={`text-[13px] tabular-nums ${done ? 'text-[var(--green)] font-semibold' : 'text-[var(--label2)] font-normal'}`}>
            {count}/{GOAL}
          </div>
        </div>
        <div className="flex gap-[5px] items-center">
          {Array.from({ length: GOAL }).map((_, i) => (
            <button
              key={i}
              onClick={() => set(i < count ? i : i + 1)}
              className={`flex-1 h-[22px] rounded-[5px] border-0 cursor-pointer transition-colors ${i < count ? 'bg-[var(--blue)]' : 'bg-[var(--gray5)]'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            />
          ))}
          {count > 0 && (
            <button onClick={() => set(count - 1)} className="bg-transparent border-0 text-[var(--label3)] text-lg cursor-pointer px-1 flex-shrink-0 leading-none">−</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SkeletonHero() {
  return (
    <div className="card mb-3 pt-[18px] px-4 pb-4">
      <div className="flex gap-4 items-center mb-[14px]">
        <div className="skeleton w-[130px] h-[130px] rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-3">
          <div className="skeleton h-7 w-[70%]" />
          <div className="skeleton h-[14px] w-1/2" />
          <div className="skeleton h-[6px] w-full" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="skeleton flex-1 h-[42px]" />
        <div className="skeleton w-[68px] h-[42px]" />
        <div className="skeleton w-[58px] h-[42px]" />
      </div>
    </div>
  )
}

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'skincare' | 'lists' | 'agenda' | 'routines'
interface Props {
  onNavigate: (tab: Tab) => void
  onToggleTheme: () => void
  themeIcon: string
}

// Status tile reused across the 2x2 grid. Keeps the markup DRY and ensures
// every tile shares padding/cursor/tap behaviour without re-typing inline styles.
function StatusTile({ label, onClick, children, fullWidth = false }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-transparent border-0 rounded-xl p-3 cursor-pointer text-left ${fullWidth ? 'col-span-2 flex items-center justify-between gap-2' : ''}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div>
        <div className="text-[11px] font-semibold text-[var(--label2)] mb-1 tracking-wider uppercase">{label}</div>
        {children}
      </div>
      {fullWidth && <span className="text-[13px] text-[var(--label3)]">❯</span>}
    </button>
  )
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
  const [agendaCount, setAgendaCount] = useState<{ open: number; total: number } | null>(null)
  const [shoppingCount, setShoppingCount] = useState<number | null>(null)
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
    api.getAgendaToday()
      .then(d => setAgendaCount({ open: d.items.filter(i => !i.done).length, total: d.items.length }))
      .catch(() => {})
    api.getList('shopping')
      .then(d => setShoppingCount(d.items.filter(i => !i.checked).length))
      .catch(() => {})
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
    <div className="page bg-[var(--bg)]">
      <div className="page-content">

        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[13px] font-medium text-[var(--label2)] mb-0.5">
              {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div className="text-[28px] font-bold tracking-tight">{greeting}, {displayName}</div>
          </div>
          <button
            className="theme-toggle mt-1"
            onClick={onToggleTheme}
            title="Toggle theme (light / dark / auto)"
            aria-label={`Theme: ${themeIcon === 'auto' ? 'auto' : themeIcon === '☀' ? 'light' : 'dark'}`}
          >
            {themeIcon === 'auto' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
              </svg>
            ) : (
              <span className="text-base leading-none">{themeIcon}</span>
            )}
          </button>
        </div>

        {/* Hero card — skeleton while loading */}
        {loading ? <SkeletonHero /> : apiError ? (
          <div className="card mb-3 px-4 py-6 text-center">
            <div className="text-3xl mb-2">⚠️</div>
            <div className="text-[15px] font-semibold mb-1">Couldn't load today's data</div>
            <div className="text-[13px] text-[var(--label2)] mb-4">Check your connection</div>
            <button
              className="btn-primary mx-auto"
              style={{ maxWidth: 160 }}
              onClick={() => { setLoading(true); setApiError(false); api.getToday().then(d => { setData(d) }).catch(() => setApiError(true)).finally(() => setLoading(false)) }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="card mb-3 pt-[18px] px-4 pb-4">
            <div className="flex gap-4 items-center mb-[14px]">
              <CalorieRing current={total} goal={goals.calories} />
              <div className="flex-1 flex flex-col gap-2.5">
                <div>
                  <div className={`text-[22px] font-bold tracking-tight tabular-nums ${total > goals.calories ? 'text-[var(--red)]' : 'text-[var(--label)]'}`}>
                    {total.toLocaleString()} <span className="text-sm font-medium text-[var(--label2)]">/ {goals.calories.toLocaleString()} kcal</span>
                  </div>
                  <div className="text-xs text-[var(--label2)] mt-px">
                    {total < goals.calories
                      ? `${(goals.calories - total).toLocaleString()} kcal remaining`
                      : 'Goal reached!'}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <div className="text-[13px] font-semibold text-[var(--orange)] tabular-nums">
                      {protein}g <span className="font-normal text-[var(--label2)]">/ {goals.protein}g protein</span>
                    </div>
                    <div className="text-xs text-[var(--label3)] tabular-nums">
                      {Math.round(Math.min(protein / goals.protein, 1) * 100)}%
                    </div>
                  </div>
                  <div className="h-1.5 bg-[var(--gray5)] rounded-[3px] overflow-hidden">
                    <div
                      className="h-full bg-[var(--orange)] rounded-[3px] transition-[width] duration-700"
                      style={{ width: `${Math.min(protein / goals.protein, 1) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleQuickLog} className="flex gap-2">
              <input
                ref={inputRef}
                className="input-field flex-1 min-w-0 text-[15px] px-3 py-2.5"
                placeholder="What did you eat?"
                value={quickEntry}
                onChange={e => setQuickEntry(e.target.value)}
              />
              <input
                className="input-field !w-[72px] flex-shrink-0 text-[15px] px-2 py-2.5 text-center tabular-nums"
                placeholder="kcal"
                type="number"
                inputMode="numeric"
                value={quickKcal}
                onChange={e => setQuickKcal(e.target.value)}
              />
              <button
                type="submit"
                disabled={submitting || !quickEntry || !quickKcal}
                className="bg-[var(--blue)] text-white border-0 rounded-[10px] px-3.5 py-2.5 text-[15px] font-semibold cursor-pointer flex-shrink-0 transition-opacity disabled:opacity-45 min-w-[54px]"
              >
                {submitting ? <span className="btn-spinner" /> : 'Add'}
              </button>
            </form>
          </div>
        )}

        {/* Status strip — today at a glance. */}
        <div className="card p-1.5 mb-3 grid grid-cols-2 gap-1">
          <StatusTile label="Workouts" onClick={() => onNavigate('workout')}>
            <div className={`text-xl font-bold tracking-tight tabular-nums ${weekStats && weekStats.workout_count >= weekStats.goal_gym_days ? 'text-[var(--green)]' : 'text-[var(--label)]'}`}>
              {weekStats?.workout_count ?? '—'}<span className="text-[13px] font-medium text-[var(--label2)]"> / {weekStats?.goal_gym_days ?? goals.gym_days}</span>
            </div>
            <div className="text-[11px] text-[var(--label3)] mt-0.5">this week</div>
          </StatusTile>

          <StatusTile label="Today's plan" onClick={() => onNavigate('agenda')}>
            <div className={`text-xl font-bold tracking-tight tabular-nums ${agendaCount && agendaCount.open === 0 && agendaCount.total > 0 ? 'text-[var(--green)]' : 'text-[var(--label)]'}`}>
              {agendaCount === null ? '—' : `${agendaCount.open}`}<span className="text-[13px] font-medium text-[var(--label2)]">{agendaCount === null ? '' : ` / ${agendaCount.total}`}</span>
            </div>
            <div className="text-[11px] text-[var(--label3)] mt-0.5">{agendaCount && agendaCount.open === 0 ? 'all done' : 'open'}</div>
          </StatusTile>

          <StatusTile label="Skincare" onClick={() => onNavigate('skincare')}>
            <div className="text-[15px] font-bold">
              <span className={skincareStatus.am ? 'text-[var(--green)]' : 'text-[var(--label3)]'}>AM {skincareStatus.am ? '✓' : '○'}</span>
              <span className="mx-2 text-[var(--label3)]">·</span>
              <span className={skincareStatus.pm ? 'text-[var(--green)]' : 'text-[var(--label3)]'}>PM {skincareStatus.pm ? '✓' : '○'}</span>
            </div>
            <div className="text-[11px] text-[var(--label3)] mt-0.5">routine</div>
          </StatusTile>

          <StatusTile label="Shopping" onClick={() => onNavigate('lists')}>
            <div className={`text-xl font-bold tracking-tight tabular-nums ${shoppingCount && shoppingCount > 0 ? 'text-[var(--orange)]' : 'text-[var(--label)]'}`}>
              {shoppingCount === null ? '—' : shoppingCount}<span className="text-[13px] font-medium text-[var(--label2)]"> {shoppingCount === 1 ? 'item' : 'items'}</span>
            </div>
            <div className="text-[11px] text-[var(--label3)] mt-0.5">to buy</div>
          </StatusTile>

          <StatusTile label="Routines" onClick={() => onNavigate('routines')} fullWidth>
            <div className="text-[13px] text-[var(--label3)]">tap to log meditate · vitamins · journal · read · stretch</div>
          </StatusTile>
        </div>

        {/* Fridge alert */}
        {staleFridgeItems.length > 0 && (
          <button
            onClick={() => onNavigate('fridge')}
            className="w-full bg-transparent border border-[rgba(255,149,0,0.35)] rounded-[14px] px-3.5 py-2.5 mb-3 cursor-pointer flex items-center gap-2.5 text-left"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <div className="text-[13px] font-bold text-[var(--orange)]">Use these soon</div>
              <div className="text-xs text-[var(--label2)] mt-px">
                {staleFridgeItems.map(i => i.name).join(' · ')}
              </div>
            </div>
            <span className="text-[13px] text-[var(--label3)]">❯</span>
          </button>
        )}

        {/* Skincare low-stock alert */}
        {lowStockSkincare.length > 0 && (
          <button
            onClick={() => onNavigate('skincare')}
            className="w-full bg-transparent border border-[rgba(255,149,0,0.35)] rounded-[14px] px-3.5 py-2.5 mb-3 cursor-pointer flex items-center gap-2.5 text-left"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="text-xl">📦</span>
            <div className="flex-1">
              <div className="text-[13px] font-bold text-[var(--orange)]">Skincare running low</div>
              <div className="text-xs text-[var(--label2)] mt-px">
                {lowStockSkincare.map(p => p.name).join(' · ')}
              </div>
            </div>
            <span className="text-[13px] text-[var(--label3)]">❯</span>
          </button>
        )}

        <WaterTracker />

        {/* Next workout */}
        <div
          onClick={() => onNavigate('workout')}
          className="bg-[var(--card)] rounded-2xl px-4 py-3.5 mb-3 cursor-pointer flex items-center gap-3.5"
        >
          <div className="text-3xl">🏋️</div>
          <div className="flex-1">
            <div className="text-[15px] font-bold">Next — {nextDay.name}</div>
            <div className="text-[13px] text-[var(--label2)] mt-0.5">
              {nextDay.focus} · {nextDay.exercises.length} exercises
            </div>
          </div>
          <div className="text-base text-[var(--label3)]">❯</div>
        </div>

        {/* Today's log */}
        {(data?.entries.length ?? 0) > 0 && (
          <>
            <div className="section-label">Today's log</div>
            <div className="card mb-3">
              {data?.entries.map((e, i) => (
                <div key={i} className="list-row">
                  <div className="flex-1">
                    <div className="text-[15px] font-medium">{e.meal}</div>
                    <div className="text-[13px] text-[var(--label2)] mt-px">
                      {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal.*?\)/, '')}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="text-sm font-semibold text-[var(--label2)] tabular-nums">~{e.kcal} kcal</div>
                    {(e.protein_g ?? 0) > 0 && (
                      <div className="text-xs text-[var(--orange)] tabular-nums">{e.protein_g}g protein</div>
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
        <div className="fixed inset-0 pointer-events-none z-[500] flex items-center justify-center">
          <div className="celebrate-pop bg-[var(--card)] rounded-[20px] px-[22px] py-4 border border-[var(--separator)] text-center" style={{ boxShadow: '0 8px 28px rgba(0,0,0,0.14)' }}>
            <div className="text-[28px] mb-1">🎉</div>
            <div className="text-[15px] font-bold">Calorie goal reached!</div>
          </div>
        </div>
      )}
    </div>
  )
}
