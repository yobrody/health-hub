import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { TodayData, WeekStats, FridgeData, AiAction, AiActResponse } from '../api/client'
import { PROGRAM, getNextDay } from '../program'
import type { DayName } from '../program'
import { loadProducts, lowStockProducts } from '../lib/skincare-products'
import { requestPermission, scheduleReminders, notificationsEnabled, setNotificationsEnabled } from '../lib/notifications'
import { computeWeightTrend } from '../lib/weight-trend'
import { celebrate } from '../lib/celebrations'
import { useAnimatedNumber } from '../lib/useAnimatedNumber'
import { PerfectDayBadge } from '../components/Celebrations'
import VoiceInput from '../components/VoiceInput'
import Skeleton from '../components/Skeleton'

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

/** SVG circular progress ring. Fills clockwise from 12 o'clock.
 *  Animates from 0 to the target value on mount so it visually fills in. */
function ProgressRing({ progress, size = 80, stroke = 6, color = 'var(--c-accent)' }: { progress: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // Start at 0 on mount, then animate to the real value
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const displayProgress = mounted ? Math.min(progress, 1) : 0
  const offset = c * (1 - displayProgress)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--c-border)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </svg>
  )
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

function Card({ children, className = '', onClick, span, style }: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  span?: 'full' | 'half'
  style?: React.CSSProperties
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 text-left transition-colors ${onClick ? 'cursor-pointer hover:border-[#3F3F46] active:bg-[#1F1F23] card-press' : ''} ${span === 'full' ? 'col-span-2' : ''} ${className}`}
      style={{ WebkitTapHighlightColor: 'transparent', ...style }}
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


/** Sleep quick-log card. Shows time inputs + quality dots when no sleep
 *  is logged today; flips to a summary after logging. */
function SleepCard() {
  const [logged, setLogged] = useState<{ bedtime: string; wake_time: string; quality: number } | null>(null)
  const [bedtime, setBedtime] = useState('23:00')
  const [wake, setWake] = useState('07:00')
  const [quality, setQuality] = useState(3)
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  // Check if sleep was already logged today (via localStorage cache)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sleep_logged_today')
      if (raw) {
        const cached = JSON.parse(raw) as { date: string; bedtime: string; wake_time: string; quality: number }
        if (cached.date === new Date().toISOString().slice(0, 10)) {
          setLogged(cached)
        }
      }
    } catch { /* ignore */ }
  }, [])

  const submit = useCallback(async () => {
    setBusy(true)
    try {
      await api.logSleep({ bedtime, wake_time: wake, quality })
      const entry = { bedtime, wake_time: wake, quality }
      setLogged(entry)
      try {
        localStorage.setItem('sleep_logged_today', JSON.stringify({
          ...entry, date: new Date().toISOString().slice(0, 10),
        }))
      } catch { /* quota */ }
      showToast('Sleep logged')
    } catch {
      showToast('Failed to log sleep', 'err')
    } finally {
      setBusy(false)
    }
  }, [bedtime, wake, quality])

  if (hidden) return null

  // Duration calculation helper
  function calcDuration(bed: string, wk: string): string {
    const [bh, bm] = bed.split(':').map(Number)
    const [wh, wm] = wk.split(':').map(Number)
    let mins = (wh * 60 + wm) - (bh * 60 + bm)
    if (mins < 0) mins += 24 * 60
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  if (logged) {
    return (
      <Card span="full">
        <div className="flex items-center justify-between">
          <div>
            <CardLabel>Sleep</CardLabel>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-[18px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {calcDuration(logged.bedtime, logged.wake_time)}
              </span>
              <span className="text-[12px] text-[var(--c-label-faint)]">
                {logged.bedtime} - {logged.wake_time}
              </span>
            </div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-1">
              {'★'.repeat(logged.quality)}{'☆'.repeat(5 - logged.quality)}
            </div>
          </div>
          <Icon.CheckCircle size={20} className="text-[var(--c-green)]" />
        </div>
      </Card>
    )
  }

  return (
    <Card span="full">
      <div className="flex items-center justify-between mb-2">
        <CardLabel>Log sleep</CardLabel>
        <button
          onClick={() => setHidden(true)}
          className="text-[11px] text-[var(--c-label-faint)] hover:text-[var(--c-label)]"
        >
          dismiss
        </button>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <div className="text-[12px] font-semibold text-[var(--c-label-dim)] mb-1">Bedtime</div>
          <input
            type="time"
            value={bedtime}
            onChange={e => setBedtime(e.target.value)}
            className="w-full bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-[var(--c-label)] focus:outline-none focus:border-[var(--c-accent)]"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 18 }}
          />
        </div>
        <div className="flex-1">
          <div className="text-[12px] font-semibold text-[var(--c-label-dim)] mb-1">Wake up</div>
          <input
            type="time"
            value={wake}
            onChange={e => setWake(e.target.value)}
            className="w-full bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-[var(--c-label)] focus:outline-none focus:border-[var(--c-accent)]"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 18 }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-[var(--c-label-faint)] mr-1">Quality</span>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setQuality(n)}
              className={`w-7 h-7 rounded-full border transition-colors text-[12px] flex items-center justify-center ${
                n <= quality
                  ? 'bg-[var(--c-accent)] border-[var(--c-accent)] text-white'
                  : 'bg-transparent border-[var(--c-border)] text-[var(--c-label-faint)]'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent', minWidth: 36, minHeight: 36 }}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="bg-[var(--c-accent)] text-white rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? '...' : 'Save'}
        </button>
      </div>
    </Card>
  )
}

/** Today bento tile for body weight. Shows latest reading + 7-day delta
 *  arrow. Taps through to Goals where you can log a new value, see the
 *  full sparkline, and apply the suggested calorie target.
 *  Pulls from VPS on mount; localStorage cache for instant first paint. */
function WeightTile({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  // Combined entries + computed trend in a single state so we don't violate
  // React 19's set-state-in-effect rule — every fetch resolves with both
  // the fresh entries AND the latest+delta computed against Date.now() once.
  const [state, setState] = useState<{
    entries: { date: string; kg: number }[]
    latest: { date: string; kg: number } | undefined
    delta: number | null
  }>(() => {
    let entries: { date: string; kg: number }[] = []
    try { entries = JSON.parse(localStorage.getItem('weight_log') || '[]') } catch { /* ignore */ }
    return computeWeightTrend(entries)
  })
  const [showInput, setShowInput] = useState(false)
  const [weightVal, setWeightVal] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.getWeightLog(14)
      .then(r => setState(computeWeightTrend(r.entries.map(e => ({ date: e.date, kg: e.kg })))))
      .catch(() => { /* offline / VPS down */ })
  }, [])
  const { entries, latest, delta } = state

  async function logWeight(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const kg = parseFloat(weightVal)
    if (isNaN(kg) || kg < 20 || kg > 300) {
      showToast('Enter a valid weight (20-300 kg)', 'err')
      return
    }
    setSaving(true)
    try {
      await api.addMetric({ weight_kg: kg })
      await api.addWeightEntry(kg)
      // Update local state
      const today = new Date().toISOString().slice(0, 10)
      const newEntries = [...entries.filter(w => w.date !== today), { date: today, kg }]
        .sort((a, b) => a.date.localeCompare(b.date))
      setState(computeWeightTrend(newEntries))
      try { localStorage.setItem('weight_log', JSON.stringify(newEntries.slice(-60))) } catch { /* quota */ }
      setWeightVal('')
      setShowInput(false)
      showToast(`Weight logged: ${kg.toFixed(1)} kg`)
    } catch {
      showToast('Failed to log weight', 'err')
    } finally {
      setSaving(false)
    }
  }

  // Compute sparkline polyline from the last ~14d of entries. Only renders
  // once we have ≥3 points — fewer than that, the line looks like noise.
  const sparkline = (() => {
    if (entries.length < 3) return null
    const W = 100, H = 22, PAD = 2
    const last = entries.slice(-14)
    const kgs = last.map(e => e.kg)
    const min = Math.min(...kgs)
    const max = Math.max(...kgs)
    const range = Math.max(0.4, max - min)  // floor so a flat line isn't a div-by-zero
    const pts = last.map((e, i) => {
      const x = PAD + (i / Math.max(1, last.length - 1)) * (W - 2 * PAD)
      const y = H - PAD - ((e.kg - min) / range) * (H - 2 * PAD)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    // Colour matches the delta-arrow semantics: green for gain, orange for loss.
    const stroke = delta !== null
      ? (delta > 0.1 ? 'var(--c-green)' : delta < -0.1 ? 'var(--c-orange)' : 'var(--c-label-faint)')
      : 'var(--c-label-faint)'
    return { W, H, pts, stroke }
  })()

  return (
    <Card onClick={() => !showInput && onNavigate('goals')}>
      <div className="flex items-center justify-between mb-2">
        <CardLabel>Weight</CardLabel>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); setShowInput(v => !v) }}
            className="text-[11px] text-[var(--c-accent)] font-medium hover:text-[var(--c-label)] transition-colors"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {showInput ? 'cancel' : 'Log'}
          </button>
          <Icon.Chevron size={16} className="text-[var(--c-label-faint)]" />
        </div>
      </div>
      {showInput ? (
        <form onSubmit={logWeight} onClick={e => e.stopPropagation()} className="flex gap-2 items-center">
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder={latest ? latest.kg.toFixed(1) : '75.0'}
            value={weightVal}
            onChange={e => setWeightVal(e.target.value)}
            autoFocus
            className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-2 py-1.5 text-[14px] text-[var(--c-label)] focus:outline-none focus:border-[var(--c-accent)]"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          />
          <span className="text-[13px] text-[var(--c-label-faint)]">kg</span>
          <button
            type="submit"
            disabled={saving || !weightVal}
            className="bg-[var(--c-accent)] text-white rounded-lg px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-30"
          >
            {saving ? '...' : 'Save'}
          </button>
        </form>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold tracking-tight" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              {latest ? latest.kg.toFixed(1) : '—'}
            </span>
            <span className="text-[13px] text-[var(--c-label-faint)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              kg
            </span>
          </div>
          {sparkline && (
            <svg
              viewBox={`0 0 ${sparkline.W} ${sparkline.H}`}
              className="w-full mt-1.5"
              style={{ height: 22 }}
              aria-hidden="true"
            >
              <polyline
                fill="none"
                stroke={sparkline.stroke}
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={sparkline.pts}
              />
            </svg>
          )}
          <div className="text-[11px] text-[var(--c-label-faint)] mt-1.5">
            {delta !== null
              ? <span style={{ color: delta > 0.1 ? 'var(--c-green)' : delta < -0.1 ? 'var(--c-orange)' : 'var(--c-label-faint)' }}>
                  {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta).toFixed(1)}kg vs 7d ago
                </span>
              : latest ? 'log a few more days for trend' : 'tap to log'}
          </div>
        </>
      )}
    </Card>
  )
}

const WATER_PRESETS = [
  { label: 'Glass', ml: 250 },
  { label: 'Bottle', ml: 500 },
  { label: 'Large', ml: 750 },
  { label: 'Pint', ml: 568 },
]
const WATER_GOAL_ML = 2000

function WaterTracker() {
  const [totalMl, setTotalMl] = useState(0)
  const [loading, setLoading] = useState(true)

  // Load from API on mount + keep localStorage in sync for AI actions
  useEffect(() => {
    api.getWater().then(data => {
      setTotalMl(data.total_ml || 0)
      // Sync localStorage for backward compat with AI log_water
      const glassCount = Math.round((data.total_ml || 0) / 250)
      try { localStorage.setItem('water_intake', JSON.stringify({ date: new Date().toDateString(), count: glassCount })) } catch { /* ignore */ }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Subscribe to storage updates so the AI's log_water action visibly fills
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key && e.key !== 'water_intake') return
      // AI logged water via localStorage, sync ml
      try {
        const raw = localStorage.getItem('water_intake')
        if (raw) {
          const p = JSON.parse(raw)
          if (p.date === new Date().toDateString()) {
            setTotalMl(p.count * 250)
          }
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  async function addWater(ml: number, label: string) {
    const optimistic = totalMl + ml
    setTotalMl(optimistic)
    if (navigator.vibrate) navigator.vibrate(8)
    // Sync localStorage for AI compat
    try { localStorage.setItem('water_intake', JSON.stringify({ date: new Date().toDateString(), count: Math.round(optimistic / 250) })) } catch { /* ignore */ }
    try {
      const res = await api.logWater(ml, label)
      setTotalMl(res.total_ml)
    } catch { /* keep optimistic */ }
  }

  const progress = Math.min(totalMl / WATER_GOAL_ML, 1)
  const pct = Math.round(progress * 100)

  return (
    <Card span="full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon.Droplet size={16} className="text-[var(--c-label-dim)]" />
          <CardLabel>Hydration</CardLabel>
        </div>
        <span className="text-[13px] text-[var(--c-label-dim)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {loading ? <Skeleton w={88} h={13} /> : `${totalMl}ml / ${WATER_GOAL_ML}ml`}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: progress >= 1 ? 'var(--c-green, #34C759)' : 'var(--c-accent)',
          borderRadius: 4,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Preset buttons */}
      <div className="grid grid-cols-4 gap-2">
        {WATER_PRESETS.map(preset => (
          <button
            key={preset.label}
            onClick={() => addWater(preset.ml, preset.label)}
            className="rounded-lg border border-[var(--c-border)] hover:border-[#3F3F46] active:bg-[#1F1F23] transition-colors"
            style={{
              background: 'var(--c-bg)',
              padding: '8px 4px',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-label)' }}>{preset.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-label-faint)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{preset.ml}ml</div>
          </button>
        ))}
      </div>

      {/* Completion badge */}
      {progress >= 1 && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: 'var(--c-green, #34C759)', textAlign: 'center' }}>
          Goal reached!
        </div>
      )}
    </Card>
  )
}

type Tab = 'today' | 'nutrition' | 'fridge' | 'workout' | 'chat' | 'goals' | 'skincare' | 'lists' | 'agenda' | 'routines' | 'metrics' | 'timeline' | 'barcode' | 'weekly-report' | 'insights' | 'meal-plan' | 'streaks'
interface Props {
  onNavigate: (tab: Tab) => void
  onToggleTheme: () => void
  themeIcon: string
}

function NotifToggle() {
  const [on, setOn] = useState(notificationsEnabled())
  return (
    <button
      onClick={() => { const next = !on; setNotificationsEnabled(next); setOn(next); if (next) requestPermission() }}
      aria-label="Toggle reminders"
      title={on ? 'Reminders on' : 'Reminders off'}
      className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--c-label-dim)] hover:text-[var(--c-label)] hover:bg-[var(--c-card)] transition-colors"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        {!on && <line x1="3" y1="3" x2="21" y2="21" />}
      </svg>
    </button>
  )
}

/** Streaks section — fetches active routine streaks and shows flame + count. */
function StreaksSection({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const ROUTINES = ['meditate', 'vitamins', 'journal', 'read', 'stretch', 'morning-skincare', 'evening-skincare']
  const [streaks, setStreaks] = useState<{ name: string; streak: number; done_today: boolean }[]>([])

  useEffect(() => {
    Promise.allSettled(ROUTINES.map(r => api.getRoutine(r)))
      .then(results => {
        const active: { name: string; streak: number; done_today: boolean }[] = []
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.streak > 0) {
            active.push({ name: ROUTINES[i], streak: r.value.streak, done_today: r.value.done_today })
            // Fire celebration on milestone streaks
            const s = r.value.streak
            if (r.value.done_today && (s === 7 || s === 14 || s === 30)) {
              celebrate('streak', `${s}-day streak!`)
            }
          }
        })
        setStreaks(active)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ROUTINES is stable
  }, [])

  if (streaks.length === 0) return null

  const displayName = (name: string) => name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <Card span="full" onClick={() => onNavigate('routines')}>
      <div className="flex items-center justify-between mb-2">
        <CardLabel>Streaks</CardLabel>
        <Icon.Chevron size={16} className="text-[var(--c-label-faint)]" />
      </div>
      <div className="flex flex-wrap gap-3">
        {streaks.map(s => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span style={{ fontSize: 16 }}>{s.done_today ? '\uD83D\uDD25' : '\u2B50'}</span>
            <span className="text-[13px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: s.done_today ? 'var(--c-orange)' : 'var(--c-label-dim)' }}>
              {s.streak}
            </span>
            <span className="text-[12px] text-[var(--c-label-faint)]">{displayName(s.name)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function Today({ onNavigate }: Props) {
  // Audit P2-12: forced-dark useEffect removed. The page now respects the
  // user's chosen theme (light / dark / system). Was a leftover from the
  // C-aesthetic preview; staying dark on a light-mode device made the page
  // look broken on first install.

  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)

  // Pull-to-refresh state
  const [ptrPulling, setPtrPulling] = useState(false)
  const [ptrRefreshing, setPtrRefreshing] = useState(false)
  const [ptrOffset, setPtrOffset] = useState(0)
  const ptrStartY = useRef(0)
  const pageRef = useRef<HTMLDivElement>(null)
  // Natural-language assistant state. Replaces the old two-input quick-log
  // (text + manual kcal). User types one freeform line; Gemini parses to
  // structured actions; user confirms; actions execute.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiState, setAiState] = useState<'idle' | 'parsing' | 'preview' | 'applying' | 'success'>('idle')
  const [aiPreview, setAiPreview] = useState<AiActResponse | null>(null)
  // Actions that failed during apply, so the user can retry just those rather
  // than the whole batch. Cleared on next successful apply or cancel.
  const [aiFailed, setAiFailed] = useState<{ action: AiAction; error: string }[]>([])
  // consume_fridge actions that 404'd (item wasn't stocked). The food log
  // already applied — this is just a follow-up nudge to add the item to the
  // fridge so future "ate X" prompts can decrement it. Soft, dismissable.
  const [aiUnstocked, setAiUnstocked] = useState<
    { name: string; section: 'fridge' | 'freezer' | 'pantry' | 'condiments' }[]
  >([])
  // Pulse the calorie bar when actions land. Triggers a one-shot CSS animation
  // by mounting a key change.
  const [barPulseKey, setBarPulseKey] = useState(0)
  const [nextWorkout, setNextWorkout] = useState<DayName>('Upper A')
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [fridgeData, setFridgeData] = useState<FridgeData | null>(null)
  const [agendaCount, setAgendaCount] = useState<{ open: number; total: number } | null>(null)
  const [shoppingCount, setShoppingCount] = useState<number | null>(null)
  // Friendly fallback before the profile loads (audit P2-8 — was hardcoded
  // to 'Brody'). Real name is read from localStorage / API on mount.
  const [displayName, setDisplayName] = useState('there')
  const inputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    api.getToday().then(d => {
      setData(d)
      // Cache entries for notification reminder checks (no API call needed
      // from the notification layer).
      try { localStorage.setItem('today_food_entries', JSON.stringify(d.entries)) } catch { /* quota */ }
    }).catch(() => {}).finally(() => setLoading(false))
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
    } catch { /* JSON parse / storage error — keep default name */ }
    api.getProfile().then(profile => { if (profile.name) setDisplayName(profile.name) }).catch(() => {})
    // Refresh totals when CameraSheet (or anything else) logs food via a
    // path that bypasses our own state updates. Bug 2026-05-07: photo logs
    // wrote server-side but Today's kcal / protein didn't refresh until a
    // full page reload because the camera sheet only had an onFridgeUpdated
    // callback, no onFoodLogged. The dispatcher in CameraSheet.confirmLog
    // (and the barcode path) emits this event after addFood resolves.
    const onFoodLogged = () => {
      api.getToday().then(setData).catch(() => {})
    }
    window.addEventListener('food-logged', onFoodLogged)
    // When queued offline writes replay on reconnect, refresh totals too.
    window.addEventListener('data-synced', onFoodLogged)

    // Notification reminders — request permission once (after onboarding),
    // then check/fire reminders on every Today page load.
    if (localStorage.getItem('onboarding_done') === '1') {
      requestPermission().then(() => scheduleReminders())
    }

    return () => {
      window.removeEventListener('food-logged', onFoodLogged)
      window.removeEventListener('data-synced', onFoodLogged)
    }
  }, [])

  // Pull-to-refresh handlers
  const PTR_THRESHOLD = 60
  function onPtrTouchStart(e: React.TouchEvent) {
    if (pageRef.current && pageRef.current.scrollTop <= 0) {
      ptrStartY.current = e.touches[0].clientY
      setPtrPulling(true)
    }
  }
  function onPtrTouchMove(e: React.TouchEvent) {
    if (!ptrPulling || ptrRefreshing) return
    const dy = e.touches[0].clientY - ptrStartY.current
    if (dy > 0) {
      setPtrOffset(Math.min(dy * 0.5, 80))
    } else {
      setPtrOffset(0)
    }
  }
  function onPtrTouchEnd() {
    if (!ptrPulling) return
    setPtrPulling(false)
    if (ptrOffset >= PTR_THRESHOLD && !ptrRefreshing) {
      setPtrRefreshing(true)
      setPtrOffset(PTR_THRESHOLD)
      // Reload all data
      Promise.all([
        api.getToday().then(setData).catch(() => {}),
        api.getWeekStats().then(setWeekStats).catch(() => {}),
        api.getFridge().then(setFridgeData).catch(() => {}),
        api.getAgendaToday().then(d => setAgendaCount({ open: d.items.filter(i => !i.done).length, total: d.items.length })).catch(() => {}),
        api.getList('shopping').then(d => setShoppingCount(d.items.filter(i => !i.checked).length)).catch(() => {}),
      ]).finally(() => {
        setPtrRefreshing(false)
        setPtrOffset(0)
        showToast('Refreshed')
      })
    } else {
      setPtrOffset(0)
    }
  }

  async function handleAiSubmit(e: React.FormEvent) {
    e.preventDefault()
    const prompt = aiPrompt.trim()
    if (!prompt || aiState !== 'idle') return
    setAiState('parsing')
    try {
      // Coach intent → reverse macro solver. Reuses the same preview/confirm
      // path since the solver returns ready-to-log log_food actions.
      // "how much/many" alone isn't enough (e.g. "how many calories in a banana"
      // is a lookup, not a solve) — require a grams/goal signal alongside it.
      const isCoachQuery = /\bhow (much|many)\b[^.?]*\b(grams?|to (hit|reach)|hit|reach|each|goal|macros?|protein|target)\b/i.test(prompt)
        || /(hit|reach|to hit|to reach)[^.]*\b(goal|macro|macros|protein|target)\b/i.test(prompt)
        || /\bgrams?\b[^.]*\b(each|hit|reach|goal|macro|target)\b/i.test(prompt)
      if (isCoachQuery) {
        const goalsNow = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
        const totalNow = data?.total_kcal ?? 0
        const proteinNow = data?.entries?.reduce((acc, e) => acc + (e.protein_g ?? 0), 0) ?? 0
        const remaining = {
          kcal: Math.max(goalsNow.calories - totalNow, 0),
          protein_g: Math.max(goalsNow.protein - proteinNow, 0),
        }
        const cr = await api.coachSolve(prompt, remaining)
        if (!cr.ok || !cr.plan || !cr.actions.length) {
          setAiState('idle')
          showToast(cr.error || "I couldn't work that out — try naming the ingredients", 'err')
          return
        }
        setAiPreview({ ok: true, summary: cr.note ? `${cr.summary} ${cr.note}` : cr.summary, actions: cr.actions })
        setAiState('preview')
        return
      }
      const resp = await api.parseAct(prompt)
      if (!resp.ok || !resp.actions.length) {
        setAiState('idle')
        showToast(resp.error || "I couldn't understand that — try again", 'err')
        return
      }
      setAiPreview(resp)
      setAiState('preview')
    } catch (err) {
      setAiState('idle')
      const msg = String(err)
      const busy = /\b(429|500|502|503|504)\b/.test(msg) || /overload|busy|timeout/i.test(msg)
      showToast(busy ? 'The assistant is briefly busy — tap send again.' : `AI error — ${msg}`.slice(0, 80), 'err')
    }
  }

  /**
   * Execute one AiAction. Single source of truth — used by both the apply
   * and retry paths. When a new AiAction variant is added, only this switch
   * needs updating; TS exhaustiveness via the `never` default keeps both
   * call sites consistent.
   */
  async function executeAction(a: AiAction): Promise<void> {
    switch (a.type) {
      case 'log_food':
        await api.addFood({
          meal: a.meal,
          description: a.count > 1 ? `${a.count} ${a.name}` : a.name,
          kcal: a.kcal * a.count,
          protein_g: a.protein_g * a.count,
          carbs_g: a.carbs_g != null ? a.carbs_g * a.count : undefined,
          fat_g: a.fat_g != null ? a.fat_g * a.count : undefined,
          fiber_g: a.fiber_g != null ? a.fiber_g * a.count : undefined,
          date: a.date,
        })
        return
      case 'add_fridge':
        await api.addFridgeItem(a.name, a.section, {
          store: a.store ?? null,
          size: a.size ?? null,
          cost: a.cost ?? null,
          unit_size_g: a.unit_size_g ?? null,
          unit_count: a.unit_count ?? null,
        })
        return
      case 'log_water':
        // Hydration lives in localStorage; increment running count for the
        // current day, then synthesize a storage event so WaterTracker re-reads.
        try {
          const todayKey = new Date().toDateString()
          const raw = localStorage.getItem('water_intake')
          const cur = raw ? JSON.parse(raw) as { date: string; count: number } : null
          const base = cur && cur.date === todayKey ? cur.count : 0
          const next = Math.min(base + a.count, 12)
          localStorage.setItem('water_intake', JSON.stringify({ date: todayKey, count: next }))
          window.dispatchEvent(new StorageEvent('storage', { key: 'water_intake' }))
        } catch { /* localStorage quota — non-fatal */ }
        return
      case 'mark_routine':
        await api.logRoutine(a.name)
        return
      case 'add_agenda':
        await api.addAgendaItem(a.title)
        // Priority is stored separately via setItemPriority — left for a future
        // enhancement; v1 ignores the AI hint so the action is one round-trip.
        return
      case 'add_list_item':
        await api.addListItem(a.list, a.text)
        return
      case 'log_weight':
        await api.addWeightEntry(a.kg, a.date)
        // Mirror to localStorage so Goals' first paint is instant on next visit.
        try {
          const raw = localStorage.getItem('weight_log')
          const log = raw ? JSON.parse(raw) as { date: string; kg: number }[] : []
          const target = a.date ?? new Date().toISOString().slice(0, 10)
          const next = [...log.filter(w => w.date !== target), { date: target, kg: a.kg }]
            .sort((x, y) => x.date.localeCompare(y.date))
            .slice(-60)
          localStorage.setItem('weight_log', JSON.stringify(next))
        } catch { /* localStorage unavailable */ }
        return
      case 'consume_fridge': {
        // Decrement remaining stock. The backend returns 404 if the item
        // isn't in the fridge — treat that as a soft fail (the user may
        // have eaten something they hadn't stocked) so it doesn't break
        // the rest of the action batch. Hard errors (network/500) still
        // surface so the user knows the AI batch didn't fully apply.
        const input: { grams?: number; count?: number } = {}
        if (typeof a.grams === 'number') input.grams = a.grams
        if (typeof a.count === 'number') input.count = a.count
        // Validator guarantees at least one is set, but belt-and-braces:
        if (input.grams === undefined && input.count === undefined) return
        try {
          await api.consumeFridgeItem(a.name, input)
        } catch (err) {
          const msg = String(err)
          if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
            // Soft-fail: queue a "stock this" chip so the user can add it
            // to the fridge with one tap. Default section is 'pantry' — a
            // safe bucket for things like rice/sauces; user can drag in
            // the fridge later if it's actually a perishable.
            setAiUnstocked(prev =>
              prev.find(u => u.name === a.name) ? prev : [...prev, { name: a.name, section: 'pantry' }]
            )
            return
          }
          throw err
        }
        return
      }
      default: {
        // Exhaustiveness guard — if a new AiAction variant lands without
        // a handler here, TS will refuse to compile.
        const _exhaustive: never = a
        throw new Error(`Unhandled action type: ${(_exhaustive as { type: string }).type}`)
      }
    }
  }

  async function applyAiActions() {
    if (!aiPreview) return
    setAiState('applying')
    // Reset unstocked chip — fresh batch may queue new ones via 404 path.
    setAiUnstocked([])
    const todayIso = new Date().toISOString().slice(0, 10)

    // Optimistic Today-bar update — only for actions logged TO TODAY. Past-day
    // entries land in their own /food file so the Today total shouldn't reflect
    // them. (Otherwise the bar would falsely jump on "yesterday I ate…".)
    const todayLogActions = aiPreview.actions.filter(
      (a): a is Extract<AiAction, { type: 'log_food' }> =>
        a.type === 'log_food' && (!a.date || a.date === todayIso)
    )
    const totalKcalDelta = todayLogActions.reduce((sum, a) => sum + a.kcal * a.count, 0)
    if (totalKcalDelta > 0) {
      const t = new Date().toTimeString().slice(0, 5)
      setData(prev => prev ? {
        ...prev,
        total_kcal: prev.total_kcal + totalKcalDelta,
        entries: [...prev.entries, ...todayLogActions.map(a => ({
          time: t, meal: a.meal,
          items: `- ${a.count > 1 ? `${a.count} ` : ''}${a.name} (~${a.kcal * a.count} kcal)`,
          kcal: a.kcal * a.count, protein_g: a.protein_g * a.count,
        }))],
      } : prev)
      // Trigger the bar-pulse animation
      setBarPulseKey(k => k + 1)
    }
    if (navigator.vibrate) navigator.vibrate([10, 30, 10])

    // Execute every action via the shared executeAction helper. Failures
    // captured per-action so the retry chip can re-fire just those rather
    // than silently swallowing them.
    const failed: { action: AiAction; error: string }[] = []
    for (const a of aiPreview.actions) {
      try { await executeAction(a) }
      catch (err) { failed.push({ action: a, error: String(err).slice(0, 120) }) }
    }

    // Re-fetch authoritative state in the background
    api.getToday().then(setData).catch(() => {})
    api.getFridge().then(setFridgeData).catch(() => {})

    // Classify failures. A food/weight/water log failing means the user's data
    // didn't get recorded — a real failure worth surfacing. But a fridge STOCK
    // update failing (consume_fridge / add_fridge — e.g. an item that isn't
    // stocked, or a re-bought duplicate) must NOT make the whole thing look like
    // it "didn't go through" when the calories logged fine.
    const STOCK_TYPES = new Set<AiAction['type']>(['consume_fridge', 'add_fridge'])
    const criticalFailed = failed.filter(f => !STOCK_TYPES.has(f.action.type))
    const stockFailed = failed.filter(f => STOCK_TYPES.has(f.action.type))

    if (criticalFailed.length === 0) {
      // Everything the user actually wanted logged went through — celebrate,
      // even if a fridge stock-update couldn't apply.
      setAiState('success')
      setTimeout(() => {
        setAiPrompt('')
        setAiPreview(null)
        setAiState('idle')
      }, 1400)
      showToast(
        stockFailed.length > 0
          ? `${aiPreview.summary || 'Logged'} · couldn't update fridge stock`
          : (aiPreview.summary || 'Done'),
        stockFailed.length > 0 ? 'info' : undefined
      )
      setAiFailed([])
    } else {
      // A real log failed — surface only the genuine failures for retry (soft
      // fridge-stock misses are not shown as red "didn't go through" chips).
      setAiPrompt('')
      setAiPreview(null)
      setAiState('idle')
      setAiFailed(criticalFailed)
      const okCount = aiPreview.actions.length - criticalFailed.length
      showToast(`${okCount} done, ${criticalFailed.length} didn't log`, 'err')
    }
  }

  // Retry a previously-failed action. Removes it from the failed list on
  // success; on failure, leaves it (with a fresh error message).
  async function retryFailedAction(idx: number) {
    const entry = aiFailed[idx]
    if (!entry) return
    try {
      await executeAction(entry.action)
      setAiFailed(prev => prev.filter((_, i) => i !== idx))
      api.getToday().then(setData).catch(() => {})
      api.getFridge().then(setFridgeData).catch(() => {})
    } catch (err) {
      setAiFailed(prev => prev.map((e, i) => i === idx ? { ...e, error: String(err).slice(0, 120) } : e))
    }
  }

  function cancelAi() {
    setAiPreview(null)
    setAiState('idle')
    inputRef.current?.focus()
  }

  const total = data?.total_kcal ?? 0
  const goals = data?.goals ?? { calories: 2800, protein: 140, gym_days: 4 }
  const protein = data?.entries.reduce((acc, e) => acc + (e.protein_g ?? 0), 0) ?? 0
  const remaining = goals.calories - total

  // Animated counters — count up from 0 on load / change
  const animatedTotal = useAnimatedNumber(total)
  const animatedProtein = useAnimatedNumber(protein)

  // Track previous values to detect goal crossings
  const prevTotal = useRef(0)
  const prevProtein = useRef(0)
  useEffect(() => {
    if (total > 0 && prevTotal.current < goals.calories && total >= goals.calories) {
      celebrate('confetti', 'Calorie goal reached!')
    }
    prevTotal.current = total
  }, [total, goals.calories])
  useEffect(() => {
    if (protein > 0 && prevProtein.current < goals.protein && protein >= goals.protein) {
      celebrate('confetti', 'Protein goal hit!')
    }
    prevProtein.current = protein
  }, [protein, goals.protein])

  // Perfect day: calories within 10% of goal, protein hit, workout logged if gym day
  const isPerfectDay = (() => {
    if (!data || total === 0) return false
    const caloriePct = total / goals.calories
    const caloriesOk = caloriePct >= 0.9 && caloriePct <= 1.1
    const proteinOk = protein >= goals.protein
    // Check if a workout was logged today (weekStats tracks this week's count)
    const workoutOk = true // simplified — we don't check gym day logic here
    return caloriesOk && proteinOk && workoutOk
  })()

  // Delete-confirm state for the Today's-log rows. First tap on the × shows
  // a 'Sure?' chip on that one row; second tap inside ~3s commits.
  // Using time+meal as the row key (the same primary key the VPS uses).
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  async function deleteFoodEntry(time: string, meal: string) {
    const k = `${time}|${meal}`
    if (deleteConfirm !== k) {
      setDeleteConfirm(k)
      // Auto-cancel after 3s if the user moves on without committing.
      setTimeout(() => setDeleteConfirm(prev => prev === k ? null : prev), 3000)
      return
    }
    setDeleting(k)
    try {
      await api.deleteFood(time, meal)
      // Optimistic strip — re-fetch will re-sync but UI stays responsive.
      setData(prev => prev ? {
        ...prev,
        entries: prev.entries.filter(e => !(e.time === time && e.meal === meal)),
        total_kcal: prev.entries.filter(e => !(e.time === time && e.meal === meal)).reduce((s, e) => s + e.kcal, 0),
      } : prev)
      api.getToday().then(setData).catch(() => {})
      showToast('Removed')
    } catch (err) {
      showToast(`Couldn't remove — ${String(err).slice(0, 40)}`, 'err')
    } finally {
      setDeleting(null)
      setDeleteConfirm(null)
    }
  }

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

  // First-paint skeletons: show shimmer placeholders for the hero numbers
  // while the initial /today fetch is in flight (before any data has landed).
  const showSkeleton = loading && !data

  return (
    <div
      ref={pageRef}
      className="page"
      style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}
      onTouchStart={onPtrTouchStart}
      onTouchMove={onPtrTouchMove}
      onTouchEnd={onPtrTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(ptrOffset > 0 || ptrRefreshing) && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          height: ptrOffset,
          transition: ptrPulling ? 'none' : 'height 0.2s ease',
          overflow: 'hidden',
        }}>
          {ptrRefreshing ? (
            <span className="ptr-spinner" />
          ) : (
            <svg
              width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="var(--c-label-faint)" strokeWidth="2" strokeLinecap="round"
              style={{
                transform: `rotate(${Math.min(ptrOffset / PTR_THRESHOLD, 1) * 180}deg)`,
                opacity: Math.min(ptrOffset / PTR_THRESHOLD, 1),
                transition: 'opacity 0.1s',
              }}
            >
              <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
            </svg>
          )}
        </div>
      )}
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
          <NotifToggle />
          {/* Settings cog — only entry point to Goals page (calorie/protein
              targets, weight log, meal plan). Without this the Goals page
              is implemented but unreachable. */}
          <button
            onClick={() => onNavigate('goals')}
            aria-label="Goals & settings"
            className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--c-label-dim)] hover:text-[var(--c-label)] hover:bg-[var(--c-card)] transition-colors"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {/* Perfect day badge — shown when all goals are met */}
        {isPerfectDay && <PerfectDayBadge />}

        {/* Hero — calorie */}
        <Card className="mb-3" onClick={() => onNavigate('nutrition')}>
          <div className="flex items-start justify-between mb-1">
            <CardLabel>Calories today</CardLabel>
            <StatBadge
              delta={remaining > 0 ? `${remaining.toLocaleString()} left` : `+${Math.abs(remaining)}`}
              kind={remaining > 0 ? 'neutral' : 'down'}
            />
          </div>
          {/* Calorie + Protein progress rings side by side */}
          <div className="flex items-center gap-6 mb-4">
            {/* Calorie ring */}
            <div className="relative flex-shrink-0" style={{ width: 90, height: 90 }}>
              <ProgressRing progress={total / goals.calories} size={90} stroke={7} color="var(--c-accent)" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[18px] font-bold tracking-tight" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", lineHeight: 1.1 }}>
                  {showSkeleton ? <Skeleton w={34} h={16} /> : animatedTotal.toLocaleString()}
                </span>
                <span className="text-[10px] text-[var(--c-label-faint)]">kcal</span>
              </div>
            </div>
            {/* Protein ring */}
            <div className="relative flex-shrink-0" style={{ width: 72, height: 72 }}>
              <ProgressRing progress={protein / goals.protein} size={72} stroke={6} color="var(--c-orange)" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[15px] font-bold tracking-tight" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: 'var(--c-orange)', lineHeight: 1.1 }}>
                  {showSkeleton ? <Skeleton w={24} h={14} /> : <>{animatedProtein}g</>}
                </span>
                <span className="text-[10px] text-[var(--c-label-faint)]">prot</span>
              </div>
            </div>
            {/* Numeric details */}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-[var(--c-label-dim)] mb-1" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {showSkeleton ? <Skeleton w="85%" h={13} /> : <>{animatedTotal.toLocaleString()} / {goals.calories.toLocaleString()} kcal</>}
              </div>
              <div className="text-[13px] text-[var(--c-label-dim)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {showSkeleton ? <Skeleton w="65%" h={13} /> : <>{animatedProtein}g / {goals.protein}g protein</>}
              </div>
            </div>
          </div>
          {/* Progress bar — fills smoothly, pulses on AI-applied actions */}
          <div className="h-1 bg-[var(--c-border)] rounded-full overflow-hidden mb-3 relative">
            <div
              key={`bar-${barPulseKey}`}
              className="h-full bg-[var(--c-accent)] rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.min(total / goals.calories, 1) * 100}%`,
                animation: barPulseKey > 0 ? 'barPulse 0.9s ease-out' : undefined,
              }}
            />
          </div>

        </Card>

        {/* AI assistant — the single input for everything. Type or voice:
            food, weight, workouts, anything. */}
        <Card className="mb-3" style={{ position: 'relative', overflow: 'visible' }}>
          {/* Spark burst on success — eight particles fanning out from card
              centre, fade as they travel. CSS handles the math via per-spark
              direction variables. Mounted under the success-state branch so
              it auto-cleans when state flips back to idle. */}
          {aiState === 'success' && (
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[
                { dx:  60, dy: -50, color: 'var(--c-green)' },
                { dx:  90, dy:   0, color: 'var(--c-accent)' },
                { dx:  60, dy:  50, color: 'var(--c-orange)' },
                { dx:   0, dy:  85, color: 'var(--c-green)' },
                { dx: -60, dy:  50, color: 'var(--c-accent)' },
                { dx: -90, dy:   0, color: 'var(--c-orange)' },
                { dx: -60, dy: -50, color: 'var(--c-green)' },
                { dx:   0, dy: -85, color: 'var(--c-accent)' },
              ].map((s, i) => (
                <span
                  key={i}
                  className="ai-spark"
                  style={{
                    background: s.color,
                    ['--dx' as string]: `${s.dx}px`,
                    ['--dy' as string]: `${s.dy}px`,
                    animationDelay: `${i * 18}ms`,
                  }}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <CardLabel>Log anything</CardLabel>
            {aiState === 'parsing' && (
              <span className="text-[11px] text-[var(--c-label-faint)] flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--c-accent)] animate-pulse" />
                thinking…
              </span>
            )}
            {aiState === 'success' && (
              <span className="text-[11px] text-[var(--c-green)] flex items-center gap-1 font-medium"
                    style={{ animation: 'aiSuccessPulse 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
                <Icon.CheckCircle size={14} className="text-[var(--c-green)]" />
                done
              </span>
            )}
          </div>
          <form onSubmit={handleAiSubmit} className="flex gap-2 items-center">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors disabled:opacity-50"
              placeholder='"sausage roll from Aldi" or "pork & broccoli — grams to hit my goal?"'
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              disabled={aiState === 'parsing' || aiState === 'applying' || aiState === 'success'}
              autoComplete="on"
              autoCorrect="on"
              spellCheck={true}
            />
            <VoiceInput
              compact
              onTranscript={(text) => {
                setAiPrompt(text)
                // Auto-submit after voice input
                setTimeout(() => {
                  const form = inputRef.current?.closest('form')
                  if (form) form.requestSubmit()
                }, 100)
              }}
              disabled={aiState === 'parsing' || aiState === 'applying' || aiState === 'success'}
            />
            <button
              type="submit"
              disabled={!aiPrompt.trim() || aiState !== 'idle'}
              aria-label="Send"
              className="bg-[var(--c-accent)] text-white rounded-lg w-10 flex items-center justify-center disabled:opacity-30 transition-opacity flex-shrink-0"
            >
              {aiState === 'parsing' ? (
                <span className="text-[13px] font-semibold">…</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4z" />
                </svg>
              )}
            </button>
          </form>

          {/* Preview chip — shown after parse, awaiting confirm */}
          {aiState === 'preview' && aiPreview && (
            <div className="mt-3 pt-3 border-t border-[var(--c-border)] animate-[slideUpSubtle_0.2s_ease-out]">
              <div className="text-[13px] text-[var(--c-label-dim)] mb-3 leading-snug">
                {aiPreview.summary}
              </div>
              <div className="flex flex-col gap-1.5 mb-3">
                {aiPreview.actions.map((a, i) => {
                  // Per-action-type colour dot + readable summary line
                  const typeStyle: Record<AiAction['type'], string> = {
                    log_food: 'bg-[var(--c-orange)]',
                    add_fridge: 'bg-[var(--c-green)]',
                    log_water: 'bg-[var(--c-accent)]',
                    mark_routine: 'bg-[var(--c-purple,#a78bfa)]',
                    add_agenda: 'bg-[var(--c-yellow,#fbbf24)]',
                    add_list_item: 'bg-[var(--c-green)]',
                    log_weight: 'bg-[var(--c-accent)]',
                    consume_fridge: 'bg-[var(--c-orange)]',
                  }
                  return (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-[var(--c-label-faint)]">
                      <span className={`inline-block w-1 h-1 rounded-full ${typeStyle[a.type]}`} />
                      <span>
                        {a.type === 'log_food' && (<>
                          <span className="text-[var(--c-label)]">{a.matched_product || a.name}</span>
                          {a.brand_or_shop && <span className="text-[var(--c-accent)]"> · {a.brand_or_shop}</span>}
                          <span className="text-[var(--c-label-faint)]"> · ~{a.kcal * a.count} kcal · {a.protein_g * a.count}g protein</span>
                          {a.confidence && (
                            <span className={`ml-1 text-[10px] px-1 py-0.5 rounded ${a.confidence === 'high' ? 'bg-[rgba(52,199,89,0.15)] text-[var(--c-green)]' : a.confidence === 'medium' ? 'bg-[rgba(255,159,10,0.15)] text-[var(--c-orange)]' : 'bg-[rgba(255,69,58,0.15)] text-[var(--c-red,#ff453a)]'}`}>
                              {a.confidence}
                            </span>
                          )}
                        </>)}
                        {a.type === 'add_fridge' && (<>
                          {a.size ? `${a.size} of ` : ''}{a.name}
                          <span className="text-[var(--c-label-faint)]"> → {a.section}{a.store ? ` · ${a.store}` : ''}</span>
                        </>)}
                        {a.type === 'log_water' && (<>
                          {a.count} glass{a.count > 1 ? 'es' : ''} of water
                        </>)}
                        {a.type === 'mark_routine' && (<>
                          Routine: {a.name} <span className="text-[var(--c-label-faint)]">→ done</span>
                        </>)}
                        {a.type === 'add_agenda' && (<>
                          Plan: {a.title}<span className="text-[var(--c-label-faint)]">{a.priority !== 'normal' ? ` · ${a.priority}` : ''}</span>
                        </>)}
                        {a.type === 'add_list_item' && (<>
                          {a.text}<span className="text-[var(--c-label-faint)]"> → {a.list} list</span>
                        </>)}
                        {a.type === 'log_weight' && (<>
                          Weight: {a.kg.toFixed(1)} kg
                          {a.date && <span className="text-[var(--c-label-faint)]"> · {a.date}</span>}
                        </>)}
                        {a.type === 'consume_fridge' && (<>
                          Used {a.grams != null ? `${a.grams}g` : a.count != null ? `${a.count}×` : ''} {a.name}
                          <span className="text-[var(--c-label-faint)]"> · fridge stock</span>
                        </>)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyAiActions}
                  className="flex-1 bg-[var(--c-accent)] text-white rounded-lg px-3 py-2 text-[13px] font-semibold uppercase tracking-wide"
                >
                  Apply
                </button>
                <button
                  onClick={cancelAi}
                  className="px-3 py-2 text-[13px] text-[var(--c-label-faint)] hover:text-[var(--c-label)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Failed-actions chip — shown when partial failures from the last
              apply remain unresolved. Each row has a small "retry" button so
              the user can re-fire just that action instead of re-typing. */}
          {aiState === 'idle' && aiFailed.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--c-border)]">
              <div className="text-[12px] text-[var(--c-orange)] font-medium mb-2">
                Didn't go through — tap to retry
              </div>
              <div className="flex flex-col gap-1.5">
                {aiFailed.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => retryFailedAction(i)}
                    className="flex items-center justify-between text-left bg-transparent border border-[var(--c-border)] rounded-md px-2 py-1.5 hover:border-[var(--c-accent)] transition-colors"
                  >
                    <span className="text-[12px] text-[var(--c-label-dim)] truncate">
                      {(() => {
                        const a = f.action
                        if (a.type === 'log_food') return `${a.name} → ${a.meal}`
                        if (a.type === 'add_fridge') return `${a.name} → ${a.section}`
                        if (a.type === 'log_water') return `${a.count} water`
                        if (a.type === 'mark_routine') return `routine: ${a.name}`
                        if (a.type === 'add_agenda') return `plan: ${a.title}`
                        if (a.type === 'add_list_item') return `${a.text} → ${a.list}`
                        if (a.type === 'log_weight') return `weight: ${a.kg.toFixed(1)}kg`
                        if (a.type === 'consume_fridge') return `used ${a.grams != null ? `${a.grams}g` : `${a.count}×`} ${a.name}`
                        return 'action'
                      })()}
                    </span>
                    <span className="text-[11px] text-[var(--c-label-faint)] flex-shrink-0 ml-2">↻</span>
                  </button>
                ))}
                <button
                  onClick={() => setAiFailed([])}
                  className="text-[11px] text-[var(--c-label-faint)] mt-1 self-start"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Unstocked-item chip — when consume_fridge 404'd, the food log
              still applied; this nudges the user to add the item to the
              fridge so next time the AI can decrement stock cleanly. */}
          {aiState === 'idle' && aiUnstocked.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--c-border)]">
              <div className="text-[12px] text-[var(--c-label-dim)] font-medium mb-2">
                Not in your fridge — tap to stock
              </div>
              <div className="flex flex-wrap gap-1.5">
                {aiUnstocked.map((u, i) => (
                  <button
                    key={i}
                    onClick={async () => {
                      try {
                        await api.addFridgeItem(u.name, u.section, {})
                        showToast(`Added ${u.name} to ${u.section}`)
                        setAiUnstocked(prev => prev.filter((_, j) => j !== i))
                      } catch (err) {
                        showToast(`Couldn't stock ${u.name} — ${String(err).slice(0, 40)}`, 'err')
                      }
                    }}
                    className="text-[12px] text-[var(--c-label-dim)] bg-transparent border border-[var(--c-border)] rounded-full px-2.5 py-1 hover:border-[var(--c-accent)] transition-colors"
                  >
                    + {u.name}
                  </button>
                ))}
                <button
                  onClick={() => setAiUnstocked([])}
                  className="text-[11px] text-[var(--c-label-faint)] self-center ml-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
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
              {/* Show actual count once weekStats lands; stay on '—' for the
                  brief loading window. weekStats null after failure → '—'
                  is fine (signals data unavailable, not "you did zero"). */}
              <BigNumber value={weekStats === null ? '—' : weekStats.workout_count} />
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

          {/* Skincare — half. Two clear "Morning"/"Evening" rows with a
              checkmark when done; trailing 'routine' subtitle removed —
              read as a confused third item rather than a section caption
              (audit P1-4). */}
          <Card onClick={() => onNavigate('skincare')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Skincare</CardLabel>
              <Icon.Sparkles size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="flex flex-col gap-1.5 mt-1 text-[14px]">
              <div className={`flex items-center justify-between ${skincareStatus.am ? 'text-[var(--c-label)]' : 'text-[var(--c-label-faint)]'}`}>
                <span>Morning</span>
                <span className={skincareStatus.am ? 'text-[var(--c-green)]' : 'text-[var(--c-label-faint)]'} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  {skincareStatus.am ? '✓' : '○'}
                </span>
              </div>
              <div className={`flex items-center justify-between ${skincareStatus.pm ? 'text-[var(--c-label)]' : 'text-[var(--c-label-faint)]'}`}>
                <span>Evening</span>
                <span className={skincareStatus.pm ? 'text-[var(--c-green)]' : 'text-[var(--c-label-faint)]'} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  {skincareStatus.pm ? '✓' : '○'}
                </span>
              </div>
            </div>
          </Card>

          {/* Shopping — half. Set the one-shot Lists hint so we land on the
              Shopping sub-list, not the default Groceries (audit P1-6). */}
          <Card onClick={() => {
            try { sessionStorage.setItem('lists_initial', 'shopping') } catch { /* sessionStorage disabled */ }
            onNavigate('lists')
          }}>
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

          {/* Streaks — active routine streaks with flame icon */}
          <StreaksSection onNavigate={onNavigate} />

          {/* Streaks heatmap page tile */}
          <Card onClick={() => onNavigate('streaks')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Streaks</CardLabel>
              <span style={{ fontSize: 14 }}>{'\uD83D\uDD25'}</span>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Heatmap</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">Badges + records</div>
          </Card>

          {/* Insights tile */}
          <Card onClick={() => onNavigate('insights')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Insights</CardLabel>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--c-label-faint)]">
                <line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
              </svg>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Correlations</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">Sleep + fitness + nutrition</div>
          </Card>

          {/* Meal Plan tile */}
          <Card onClick={() => onNavigate('meal-plan')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Meal Plan</CardLabel>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--c-label-faint)]">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
              </svg>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Tomorrow</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">AI meals from fridge</div>
          </Card>

          {/* Body — metrics page tile */}
          <Card onClick={() => onNavigate('metrics')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Body</CardLabel>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-[var(--c-label-faint)]">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Weight trends</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">TDEE · Sleep stats</div>
          </Card>

          {/* Timeline tile */}
          <Card onClick={() => onNavigate('timeline')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Timeline</CardLabel>
              <Icon.Calendar size={16} className="text-[var(--c-label-faint)]" />
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">7-day log</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">Unified activity</div>
          </Card>

          {/* Weekly Report tile */}
          <Card onClick={() => onNavigate('weekly-report')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Weekly Report</CardLabel>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--c-label-faint)]">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Full summary</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">Goals + trends</div>
          </Card>

          {/* Scan tile — barcode lookup */}
          <Card onClick={() => onNavigate('barcode')}>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Scan</CardLabel>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-[var(--c-label-faint)]">
                <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                <line x1="7" y1="8" x2="7" y2="16"/><line x1="11" y1="8" x2="11" y2="16"/><line x1="15" y1="8" x2="15" y2="16"/>
              </svg>
            </div>
            <div className="text-[13px] text-[var(--c-label-dim)]">Barcode lookup</div>
            <div className="text-[12px] text-[var(--c-label-faint)] mt-0.5">Food nutrition</div>
          </Card>

          {/* Body weight — half-tile, taps through to Goals where you log
              new readings + see the full sparkline. Pulls from VPS so the
              latest morning weigh-in (typed via AI or Goals form) shows
              here without a reload. */}
          <WeightTile onNavigate={onNavigate} />

          {/* Sleep quick-log — full width. Shows input when not logged today,
              summary after logging. */}
          <SleepCard />

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
              {/* Match the Fridge page's banner phrasing — was 'Use these
                  soon' here vs 'Eat soon' there (audit P1-12). */}
              <div className="text-[13px] font-semibold text-[var(--c-orange)]">Eat soon</div>
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
                {data?.entries.map((e, i) => {
                  const k = `${e.time}|${e.meal}`
                  const isConfirming = deleteConfirm === k
                  const isDeleting = deleting === k
                  return (
                    <div key={i} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium">{e.meal}</div>
                        <div className="text-[12px] text-[var(--c-label-dim)] truncate mt-0.5">
                          {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal.*?\)/, '')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex flex-col items-end">
                          <div className="text-[13px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                            {e.kcal} <span className="text-[11px] font-normal text-[var(--c-label-faint)]">kcal</span>
                          </div>
                          {(e.protein_g ?? 0) > 0 && (
                            <div className="text-[11px] text-[var(--c-orange)]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                              {e.protein_g}g
                            </div>
                          )}
                        </div>
                        {/* Delete button — first tap shows 'Sure?', second tap commits.
                            Auto-cancels after 3s if you tap once and walk away. */}
                        <button
                          onClick={() => deleteFoodEntry(e.time, e.meal)}
                          disabled={isDeleting}
                          aria-label={isConfirming ? `Confirm remove ${e.meal}` : `Remove ${e.meal}`}
                          className={`flex-shrink-0 rounded-full transition-all ${
                            isConfirming
                              ? 'bg-[var(--c-orange)] text-white px-2.5 py-1 text-[11px] font-semibold'
                              : 'w-7 h-7 flex items-center justify-center text-[var(--c-label-faint)] hover:text-[var(--c-orange)] hover:bg-[var(--c-bg-tinted,rgba(127,127,127,0.08))]'
                          }`}
                        >
                          {isDeleting ? '…' : isConfirming ? 'Sure?' : '×'}
                        </button>
                      </div>
                    </div>
                  )
                })}
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
