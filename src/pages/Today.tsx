import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { TodayData, WeekStats, FridgeData, AiAction, AiActResponse } from '../api/client'
import { PROGRAM, getNextDay } from '../program'
import type { DayName } from '../program'
import { loadProducts, lowStockProducts } from '../lib/skincare-products'
import { computeWeightTrend } from '../lib/weight-trend'

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
      className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 text-left transition-colors ${onClick ? 'cursor-pointer hover:border-[#3F3F46] active:bg-[#1F1F23]' : ''} ${span === 'full' ? 'col-span-2' : ''} ${className}`}
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
  useEffect(() => {
    api.getWeightLog(14)
      .then(r => setState(computeWeightTrend(r.entries.map(e => ({ date: e.date, kg: e.kg })))))
      .catch(() => { /* offline / VPS down */ })
  }, [])
  const { entries, latest, delta } = state

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
    <Card onClick={() => onNavigate('goals')}>
      <div className="flex items-center justify-between mb-2">
        <CardLabel>Weight</CardLabel>
        <Icon.Chevron size={16} className="text-[var(--c-label-faint)]" />
      </div>
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
    </Card>
  )
}

function WaterTracker() {
  const GOAL = 8
  const todayKey = new Date().toDateString()
  function readCount(): number {
    try {
      const s = localStorage.getItem('water_intake')
      if (s) { const p = JSON.parse(s); if (p.date === todayKey) return p.count }
    } catch { /* localStorage unavailable / corrupted JSON — fall through to 0 */ }
    return 0
  }
  const [count, setCount] = useState(readCount)

  // Subscribe to storage updates so the AI's log_water action visibly fills
  // the dots without a reload. Browsers only fire 'storage' cross-tab by
  // default, so applyAiActions also dispatches a synthetic event in-tab.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key && e.key !== 'water_intake') return
      setCount(readCount())
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- readCount uses todayKey from closure; reading is fine
  }, [])

  function set(n: number) {
    const next = Math.max(0, Math.min(12, n))
    setCount(next)
    try { localStorage.setItem('water_intake', JSON.stringify({ date: todayKey, count: next })) } catch { /* quota exceeded — non-fatal */ }
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
            aria-label={i < count ? `Glass ${i + 1} (drunk) — tap to undo` : `Mark glass ${i + 1} drunk`}
            aria-pressed={i < count}
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
  // Audit P2-12: forced-dark useEffect removed. The page now respects the
  // user's chosen theme (light / dark / system). Was a leftover from the
  // C-aesthetic preview; staying dark on a light-mode device made the page
  // look broken on first install.

  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
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
    } catch { /* JSON parse / storage error — keep default name */ }
    api.getProfile().then(profile => { if (profile.name) setDisplayName(profile.name) }).catch(() => {})
  }, [])

  async function handleAiSubmit(e: React.FormEvent) {
    e.preventDefault()
    const prompt = aiPrompt.trim()
    if (!prompt || aiState !== 'idle') return
    setAiState('parsing')
    try {
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
      showToast(`AI error — ${String(err)}`.slice(0, 80), 'err')
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

    if (failed.length === 0) {
      // Full success — celebrate (sparkles, "done" pill, calorie-bar pulse).
      setAiState('success')
      setTimeout(() => {
        setAiPrompt('')
        setAiPreview(null)
        setAiState('idle')
      }, 1400)
      showToast(aiPreview.summary || 'Done')
      setAiFailed([])
    } else {
      // Partial failure — DON'T fire the success animation (would mislead
      // when half the batch didn't go through). Skip straight to idle and
      // surface the retry chip with what failed.
      setAiPrompt('')
      setAiPreview(null)
      setAiState('idle')
      setAiFailed(failed)
      showToast(`${aiPreview.actions.length - failed.length} done, ${failed.length} failed`, 'err')
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
          {/* Progress bar — fills smoothly, pulses on AI-applied actions */}
          <div className="h-1 bg-[var(--c-border)] rounded-full overflow-hidden mb-5 relative">
            <div
              key={`bar-${barPulseKey}`}
              className="h-full bg-[var(--c-accent)] rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.min(total / goals.calories, 1) * 100}%`,
                animation: barPulseKey > 0 ? 'barPulse 0.9s ease-out' : undefined,
              }}
            />
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

        {/* AI assistant — single freeform input. Replaces the old two-input
            Quick Log. Type "3 eggs and bacon, can of pineapple from Aldi" →
            Gemini parses → preview chip → tap to apply. */}
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
            <CardLabel>Tell me what's up</CardLabel>
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
          <form onSubmit={handleAiSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-[14px] text-[var(--c-label)] placeholder:text-[var(--c-label-faint)] focus:outline-none focus:border-[var(--c-accent)] transition-colors disabled:opacity-50"
              placeholder='e.g. "3 eggs, bacon, can of pineapple from Aldi"'
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
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
                          {a.count > 1 ? `${a.count} ` : ''}{a.name}
                          <span className="text-[var(--c-label-faint)]"> · ~{a.kcal * a.count} kcal · {a.protein_g * a.count}g protein → {a.meal}{a.date ? ` · ${a.date}` : ''}</span>
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

          {/* Body weight — half-tile, taps through to Goals where you log
              new readings + see the full sparkline. Pulls from VPS so the
              latest morning weigh-in (typed via AI or Goals form) shows
              here without a reload. */}
          <WeightTile onNavigate={onNavigate} />

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
