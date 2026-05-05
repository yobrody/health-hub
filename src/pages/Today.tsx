import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { TodayData, WeekStats, FridgeData } from '../api/client'
import { PROGRAM, getNextDay } from '../program'
import type { DayName } from '../program'
import { loadProducts, lowStockProducts } from '../lib/skincare-products'

// =============================================================================
// C-PREVIEW: Dark + bento + monospaced data
// =============================================================================
// Hand-rolled minimal Lucide-style SVGs so we don't pull in the full lucide-react
// package for one preview. Each ~20 LoC, MIT-spirit derivative.
const Icon = {
  Dumbbell: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>
    </svg>
  ),
  CheckCircle: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>
    </svg>
  ),
  Sparkles: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>
    </svg>
  ),
  ShoppingCart: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>
    </svg>
  ),
  Repeat: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  Droplet: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>
    </svg>
  ),
  Calendar: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>
    </svg>
  ),
  TrendUp: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  TrendDown: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
    </svg>
  ),
  Chevron: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Alert: (p: { size?: number; className?: string }) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
    </svg>
  ),
}

function StatBadge({ delta, kind }: { delta: string; kind: 'up' | 'down' | 'neutral' }) {
  const palette = kind === 'up'
    ? 'bg-[#10B98115] text-[#10B981] border-[#10B98130]'
    : kind === 'down'
    ? 'bg-[#EF444415] text-[#EF4444] border-[#EF444430]'
    : 'bg-[#A1A1AA15] text-[var(--c-label-dim)] border-[#52525B30]'
  const TrendIcon = kind === 'up' ? Icon.TrendUp : kind === 'down' ? Icon.TrendDown : null
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md border ${palette}`} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
      {TrendIcon && <TrendIcon size={11} />}
      {delta}
    </span>
  )
}

function Card({ children, className = '', onClick, span }: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  span?: 'full' | 'half'
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 text-left transition-colors ${onClick ? 'cursor-pointer hover:border-[#3F3F46] active:bg-[#1F1F23]' : ''} ${span === 'full' ? 'col-span-2' : ''} ${className}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {children}
    </Comp>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-[var(--c-label-faint)] font-medium mb-2">{children}</div>
}

function BigNumber({ value, unit, color, mono = true }: { value: string | number; unit?: string; color?: string; mono?: boolean }) {
  return (
    <div className={`text-[28px] font-semibold leading-none ${mono ? '' : ''}`}
         style={{
           fontFamily: mono ? "'JetBrains Mono', ui-monospace, monospace" : undefined,
           letterSpacing: '-0.03em',
           color: color || 'var(--c-label)',
         }}>
      {value}
      {unit && <span className="text-[14px] text-[var(--c-label-dim)] ml-1.5 font-normal">{unit}</span>}
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

  return (
    <Card span="full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon.Droplet size={16} className="text-[var(--c-label-dim)]" />
          <CardLabel>Hydration</CardLabel>
        </div>
        <span className="text-[13px] text-[var(--c-label-dim)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {count}/{GOAL}
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {Array.from({ length: GOAL }).map((_, i) => (
          <button
            key={i}
            onClick={() => set(i < count ? i : i + 1)}
            className={`h-8 rounded-md border transition-colors ${
              i < count
                ? 'bg-[var(--c-accent)] border-[var(--c-accent)]'
                : 'bg-transparent border-[var(--c-border)] hover:border-[#3F3F46]'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          />
        ))}
      </div>
    </Card>
  )
}

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'goals' | 'skincare' | 'lists' | 'agenda' | 'routines'
interface Props {
  onNavigate: (tab: Tab) => void
  onToggleTheme: () => void
  themeIcon: string
}

export default function Today({ onNavigate }: Props) {
  // C-PREVIEW: force dark theme on the document so the existing tab bar / page chrome
  // renders dark to match the new aesthetic. Restored on unmount.
  useEffect(() => {
    const prev = document.documentElement.dataset.theme
    document.documentElement.dataset.theme = 'dark'
    return () => { if (prev) document.documentElement.dataset.theme = prev; else delete document.documentElement.dataset.theme }
  }, [])

  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [quickEntry, setQuickEntry] = useState('')
  const [quickKcal, setQuickKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nextWorkout, setNextWorkout] = useState<DayName>('Upper A')
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [fridgeData, setFridgeData] = useState<FridgeData | null>(null)
  const [agendaCount, setAgendaCount] = useState<{ open: number; total: number } | null>(null)
  const [shoppingCount, setShoppingCount] = useState<number | null>(null)
  const [displayName, setDisplayName] = useState('Brody')
  const inputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    api.getToday().then(d => setData(d)).catch(() => {}).finally(() => setLoading(false))
    api.getWeekStats().then(setWeekStats).catch(() => {})
    api.getFridge().then(setFridgeData).catch(() => {})
    api.getAgendaToday().then(d => setAgendaCount({ open: d.items.filter(i => !i.done).length, total: d.items.length })).catch(() => {})
    api.getList('shopping').then(d => setShoppingCount(d.items.filter(i => !i.checked).length)).catch(() => {})
    api.getWorkouts(20).then(workouts => {
      const recentTitles = [...workouts].reverse().map(w => w.title)
      setNextWorkout(getNextDay(recentTitles))
    }).catch(() => {})
    try {
      const raw = localStorage.getItem('user_profile')
      if (raw) { const p = JSON.parse(raw) as { name?: string }; if (p.name) setDisplayName(p.name) }
    } catch {}
    api.getProfile().then(profile => { if (profile.name) setDisplayName(profile.name) }).catch(() => {})
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
    setQuickEntry(''); setQuickKcal('')
    if (navigator.vibrate) navigator.vibrate(10)
    inputRef.current?.focus()
    setSubmitting(true)
    try {
      await api.addFood({ meal, description: savedEntry, kcal: kcalNum })
      showToast(`${savedEntry} logged`)
      api.getToday().then(setData).catch(() => {})
    } catch {
      showToast('Failed to save', 'err')
    } finally {
      setSubmitting(false)
    }
  }

  const total = data?.total_kcal ?? 0
  const goals = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
  const protein = data?.entries.reduce((acc, e) => acc + (e.protein_g ?? 0), 0) ?? 0
  const remaining = goals.calories - total
  const proteinPct = Math.round(Math.min(protein / goals.protein, 1) * 100)

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
      .filter(item => { if (!item.added) return false; try { return new Date(item.added) < cutoff } catch { return false } })
      .slice(0, 3)
  })()

  const lowStockSkincare = lowStockProducts(loadProducts(localStorage)).slice(0, 3)
  const nextDay = PROGRAM[nextWorkout]

  return (
    <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
      <div className="page-content">

        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--c-label-faint)] font-medium mb-1">
              {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
            <div className="text-[24px] font-semibold tracking-tight">
              {greeting}, <span className="text-[var(--c-label-dim)]">{displayName}</span>
            </div>
          </div>
        </div>

        {/* Hero — calorie */}
        <Card className="mb-3">
          <div className="flex items-start justify-between mb-1">
            <CardLabel>Calories today</CardLabel>
            <StatBadge
              delta={remaining > 0 ? `${remaining.toLocaleString()} left` : `+${Math.abs(remaining)}`}
              kind={remaining > 0 ? 'neutral' : 'down'}
            />
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <BigNumber value={total.toLocaleString()} />
            <span className="text-[15px] text-[var(--c-label-faint)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              / {goals.calories.toLocaleString()}
            </span>
          </div>
          {/* Progress bar — sharp, full-width */}
          <div className="h-1 bg-[var(--c-border)] rounded-full overflow-hidden mb-5">
            <div className="h-full bg-[var(--c-accent)] rounded-full transition-[width] duration-700"
                 style={{ width: `${Math.min(total / goals.calories, 1) * 100}%` }} />
          </div>

          {/* Protein sub-row */}
          <div className="flex items-center justify-between mb-1">
            <CardLabel>Protein</CardLabel>
            <span className="text-[11px] font-medium text-[var(--c-label-dim)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              {proteinPct}%
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <div className="text-[20px] font-semibold tracking-tight" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: 'var(--c-orange)' }}>
              {protein}g
            </div>
            <span className="text-[13px] text-[var(--c-label-faint)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              / {goals.protein}g
            </span>
          </div>
          <div className="h-1 bg-[var(--c-border)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--c-orange)] rounded-full transition-[width] duration-700"
                 style={{ width: `${proteinPct}%` }} />
          </div>
        </Card>

        {/* Quick log — compact, inline */}
        <Card className="mb-3">
          <CardLabel>Quick log</CardLabel>
          <form onSubmit={handleQuickLog} className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors"
              placeholder="What did you eat?"
              value={quickEntry}
              onChange={e => setQuickEntry(e.target.value)}
            />
            <input
              className="!w-[80px] flex-shrink-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-2 py-2 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] text-center focus:outline-none focus:border-[var(--c-accent)] transition-colors tabular-nums"
              placeholder="kcal"
              type="number"
              inputMode="numeric"
              value={quickKcal}
              onChange={e => setQuickKcal(e.target.value)}
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
            />
            <button
              type="submit"
              disabled={submitting || !quickEntry || !quickKcal}
              className="bg-[var(--c-accent)] text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-30 transition-opacity flex-shrink-0 uppercase tracking-wide"
            >
              {submitting ? '...' : 'Add'}
            </button>
          </form>
        </Card>

        {/* Bento grid — varied tile sizes */}
        <div className="grid grid-cols-2 gap-3 mb-3">

          {/* Workouts — half */}
          <Card onClick={() => onNavigate('workout')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Workouts</CardLabel>
              <Icon.Dumbbell size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="flex items-baseline gap-2">
              <BigNumber value={weekStats?.workout_count ?? '—'} />
              <span className="text-[13px] text-[var(--c-label-faint)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                /{weekStats?.goal_gym_days ?? goals.gym_days}
              </span>
            </div>
            <div className="text-[11px] text-[var(--c-label-faint)] mt-2">this week</div>
          </Card>

          {/* Today's plan — half */}
          <Card onClick={() => onNavigate('agenda')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Plan</CardLabel>
              <Icon.Calendar size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="flex items-baseline gap-2">
              <BigNumber
                value={agendaCount === null ? '—' : agendaCount.open}
                color={agendaCount && agendaCount.open === 0 && agendaCount.total > 0 ? 'var(--c-green)' : undefined}
              />
              <span className="text-[13px] text-[var(--c-label-faint)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {agendaCount === null ? '' : `/${agendaCount.total}`}
              </span>
            </div>
            <div className="text-[11px] text-[var(--c-label-faint)] mt-2">
              {agendaCount && agendaCount.open === 0 ? 'all done' : 'open'}
            </div>
          </Card>

          {/* Skincare — half */}
          <Card onClick={() => onNavigate('skincare')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Skincare</CardLabel>
              <Icon.Sparkles size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="flex items-center gap-2 text-[16px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              <span className={skincareStatus.am ? 'text-[var(--c-green)]' : 'text-[var(--c-label-faint)]'}>
                AM {skincareStatus.am ? '✓' : '○'}
              </span>
              <span className={skincareStatus.pm ? 'text-[var(--c-green)]' : 'text-[var(--c-label-faint)]'}>
                PM {skincareStatus.pm ? '✓' : '○'}
              </span>
            </div>
            <div className="text-[11px] text-[var(--c-label-faint)] mt-2">routine</div>
          </Card>

          {/* Shopping — half */}
          <Card onClick={() => onNavigate('lists')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Shopping</CardLabel>
              <Icon.ShoppingCart size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="flex items-baseline gap-2">
              <BigNumber
                value={shoppingCount === null ? '—' : shoppingCount}
                color={shoppingCount && shoppingCount > 0 ? 'var(--c-orange)' : undefined}
              />
              <span className="text-[13px] text-[var(--c-label-faint)]">
                {shoppingCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <div className="text-[11px] text-[var(--c-label-faint)] mt-2">to buy</div>
          </Card>

          {/* Routines — full width */}
          <Card onClick={() => onNavigate('routines')} span="full">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Icon.Repeat size={16} className="text-[var(--c-label-faint)]" />
                  <CardLabel>Routines</CardLabel>
                </div>
                <div className="text-[13px] text-[var(--c-label-dim)] mt-1">meditate · vitamins · journal · read · stretch</div>
              </div>
              <Icon.Chevron size={16} className="text-[var(--c-label-faint)]" />
            </div>
          </Card>

          {/* Hydration — full width */}
          <WaterTracker />

          {/* Next workout — full width */}
          <Card onClick={() => onNavigate('workout')} span="full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon.Dumbbell size={20} className="text-[var(--c-accent)]" />
                <div>
                  <CardLabel>Next workout</CardLabel>
                  <div className="text-[15px] font-semibold mt-0.5">{nextDay.name}</div>
                  <div className="text-[12px] text-[var(--c-label-dim)] mt-0.5">
                    {nextDay.focus} <span className="text-[var(--c-label-faint)]">·</span> {nextDay.exercises.length} exercises
                  </div>
                </div>
              </div>
              <Icon.Chevron size={16} className="text-[var(--c-label-faint)]" />
            </div>
          </Card>
        </div>

        {/* Alert strip — fridge stale */}
        {staleFridgeItems.length > 0 && (
          <button
            onClick={() => onNavigate('fridge')}
            className="w-full bg-[var(--c-card)] border border-[#F59E0B40] rounded-xl p-3.5 mb-3 flex items-center gap-3 text-left transition-colors hover:border-[#F59E0B70]"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Icon.Alert size={18} className="text-[var(--c-orange)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[var(--c-orange)]">Use these soon</div>
              <div className="text-[12px] text-[var(--c-label-dim)] truncate mt-0.5">
                {staleFridgeItems.map(i => i.name).join(' · ')}
              </div>
            </div>
            <Icon.Chevron size={14} className="text-[var(--c-label-faint)]" />
          </button>
        )}

        {/* Skincare low stock */}
        {lowStockSkincare.length > 0 && (
          <button
            onClick={() => onNavigate('skincare')}
            className="w-full bg-[var(--c-card)] border border-[#F59E0B40] rounded-xl p-3.5 mb-3 flex items-center gap-3 text-left transition-colors hover:border-[#F59E0B70]"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Icon.Alert size={18} className="text-[var(--c-orange)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[var(--c-orange)]">Skincare running low</div>
              <div className="text-[12px] text-[var(--c-label-dim)] truncate mt-0.5">
                {lowStockSkincare.map(p => p.name).join(' · ')}
              </div>
            </div>
            <Icon.Chevron size={14} className="text-[var(--c-label-faint)]" />
          </button>
        )}

        {/* Today's log */}
        {(data?.entries.length ?? 0) > 0 && (
          <>
            <div className="text-[11px] uppercase tracking-wider text-[var(--c-label-faint)] font-medium mt-6 mb-2 px-1">Today's log</div>
            <Card>
              <div className="divide-y divide-[var(--c-border)]">
                {data?.entries.map((e, i) => (
                  <div key={i} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium">{e.meal}</div>
                      <div className="text-[12px] text-[var(--c-label-dim)] truncate mt-0.5">
                        {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal.*?\)/, '')}
                      </div>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                      <div className="text-[13px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                        {e.kcal} <span className="text-[11px] font-normal text-[var(--c-label-faint)]">kcal</span>
                      </div>
                      {(e.protein_g ?? 0) > 0 && (
                        <div className="text-[11px] text-[var(--c-orange)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                          {e.protein_g}g
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {loading && (
          <div className="text-center py-8 text-[12px] text-[var(--c-label-faint)]">Loading...</div>
        )}

      </div>
    </div>
  )
}
