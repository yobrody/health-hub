import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import { celebrate } from '../lib/celebrations'
import { PushSettings } from '../components/PushSettings'
import type { WeekStats, Goals, GoalsUpdateInput, AdaptiveTDEEData, HistoryDay } from '../api/client'
import { BUILD_SHA, BUILD_DATE } from '../build-info'
import {
  analyzeWeightTrend,
  loadDirection,
  saveDirection,
  suggestCalorieTarget,
  type Direction,
  type WeightEntry,
} from '../lib/calorie-target'
import { suggestGoals } from '../lib/goal-suggestions'
// Lazy so recharts only loads when the weight chart renders (off initial load).
const WeightTrendChart = lazy(() => import('../components/WeightTrendChart'))

function MiniBar({ value, goal, color }: { value: number; goal: number; color: string }) {
  return (
    <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 3, background: color,
        width: `${Math.min(value / Math.max(goal, 1) * 100, 100)}%`, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function ProgressRing({ progress, size = 64, stroke = 5, color = 'var(--blue)' }: { progress: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const raf = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(raf) }, [])
  const displayProgress = mounted ? Math.min(progress, 1) : 0
  const offset = c * (1 - displayProgress)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--gray5)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </svg>
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
  const latest = weights[weights.length - 1]
  const prev7 = weights.find(w => {
    const d = new Date(latest.date).getTime() - new Date(w.date).getTime()
    return d >= 6 * 86400000 && d <= 8 * 86400000
  })
  const delta = prev7 ? latest.kg - prev7.kg : null

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
      <Suspense fallback={<div style={{ height: 160 }} />}>
        <WeightTrendChart weights={weights} />
      </Suspense>
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
  const [adaptiveTDEE, setAdaptiveTDEE] = useState<AdaptiveTDEEData | null>(null)
  // Real 7-day protein average (the protein MiniBar used to be avgKcal x 15%
  // — a fabricated number). /food/history now returns total_protein_g.
  const [avgProtein, setAvgProtein] = useState(0)
  // Body profile behind the TDEE math (PUT /tdee/profile). Until this editor
  // existed, both TDEE cards ran on hardcoded 80kg/180cm/25y/male defaults.
  const [bodyProfile, setBodyProfile] = useState<{ height_cm?: number; age?: number; sex?: string; activity_level?: string }>({})
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    api.getWeekStats().then(s => setStats(s)).catch(() => setStats(null))
    api.getGoals().then(g => setGoals(g.parsed)).catch(() => {})
    api.getAdaptiveTDEE().then(setAdaptiveTDEE).catch(() => {})
    api.getFoodHistory(7).then((days: HistoryDay[]) => {
      const logged = days.filter(d => d.logged && (d.total_protein_g ?? 0) > 0)
      if (logged.length) setAvgProtein(Math.round(logged.reduce((a, d) => a + (d.total_protein_g ?? 0), 0) / logged.length))
    }).catch(() => {})
    api.getProfile().then(p => {
      const rec = p as unknown as Record<string, unknown>
      setBodyProfile({
        height_cm: typeof rec.height_cm === 'number' ? rec.height_cm : undefined,
        age: typeof rec.age === 'number' ? rec.age : undefined,
        sex: typeof rec.sex === 'string' ? rec.sex : undefined,
        activity_level: typeof rec.activity_level === 'string' ? rec.activity_level : undefined,
      })
    }).catch(() => {})
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

  // From-scratch baseline goals derived from real TDEE + real bodyweight.
  // TDEE prefers the adaptive figure (from actual intake vs weight change),
  // falling back to the Mifflin-St Jeor estimate. Weight is the latest weigh-in.
  const tdeeVal = adaptiveTDEE ? (adaptiveTDEE.adaptive_tdee ?? adaptiveTDEE.estimated_tdee) : null
  // Only trust the server weight when it's a real value — never the 80kg
  // placeholder (weight_source 'default'), or the card would suggest protein
  // off a fabricated bodyweight and label it as his.
  const serverWeight = adaptiveTDEE && adaptiveTDEE.weight_source !== 'default' ? adaptiveTDEE.weight_kg : null
  const latestKg = weights.length ? weights[weights.length - 1].kg : serverWeight
  const goalSuggestion = (tdeeVal != null && latestKg != null)
    ? suggestGoals(tdeeVal, latestKg, direction)
    : null
  const calorieMatches = !!goalSuggestion && goalSuggestion.hasTdee && goals.calories === goalSuggestion.calories
  const proteinMatches = !!goalSuggestion && goalSuggestion.hasWeight && goals.protein === goalSuggestion.protein

  // Height/age/sex still unset → the server TDEE silently runs on 180cm/25/male
  // defaults. Nudge Brody to fill the (already-present) body-profile editor so
  // his TDEE stops being a guess (2026-08-04 honesty-audit recommendation).
  const profileIncomplete = !bodyProfile.height_cm || !bodyProfile.age || !bodyProfile.sex

  function pickDirection(d: Direction) {
    setDirection(d)
    saveDirection(localStorage, d)
    // Persist to the profile so the backend TDEE targets, chat coach and
    // meal planner all reason from the SAME goal direction the user picked
    // here — otherwise the server silently assumes "maintain".
    api.updateTdeeProfile({ goal_direction: d }).catch(() => { /* offline — localStorage still holds it */ })
  }

  async function applyGoalSuggestion(kind: 'calories' | 'protein' | 'both') {
    if (!goalSuggestion) return
    const patch: GoalsUpdateInput = {}
    if (kind !== 'protein' && goalSuggestion.hasTdee) patch.calories = goalSuggestion.calories
    if (kind !== 'calories' && goalSuggestion.hasWeight) patch.protein = goalSuggestion.protein
    if (patch.calories == null && patch.protein == null) return
    setSaving(true)
    try {
      const updated = await api.updateGoals(patch) as { ok: boolean; goals: Goals }
      setGoals(updated.goals)
      if (navigator.vibrate) navigator.vibrate(8)
      showToast('Goals updated from your data')
    } catch {
      showToast('Failed to apply suggestion', 'err')
    } finally { setSaving(false) }
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
      if (navigator.vibrate) navigator.vibrate(8)
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

  // Celebrate when ALL weekly goals are met simultaneously
  const celebratedRef = useRef(false)
  useEffect(() => {
    if (celebratedRef.current) return
    if (stats && loggedDays >= 5 && workoutCount >= goals.gym_days) {
      celebratedRef.current = true
      celebrate('confetti', 'All weekly goals crushed!')
    }
  }, [stats, loggedDays, workoutCount, goals.gym_days])

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

        {/* This week — animated progress rings */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, marginBottom: 12 }}>THIS WEEK</div>

          {/* Celebration banner when weekly goals are hit */}
          {(loggedDays >= 5 && workoutCount >= goals.gym_days) && (
            <div style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 10,
              background: '#10B98112', border: '1px solid #10B98125',
              fontSize: 14, fontWeight: 600, color: '#10B981', textAlign: 'center',
            }}>
              Weekly goals crushed! Keep the momentum going.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            {/* Days logged ring */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ProgressRing progress={loggedDays / 7} size={64} stroke={5} color={loggedDays >= 5 ? 'var(--green)' : loggedDays >= 3 ? 'var(--orange)' : 'var(--red)'} />
                <div style={{ position: 'absolute', fontSize: 16, fontWeight: 700, color: loggedDays >= 5 ? 'var(--green)' : loggedDays >= 3 ? 'var(--orange)' : 'var(--red)' }}>
                  {loggedDays}/7
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--label2)' }}>Days logged</div>
            </div>
            {/* Avg kcal (no ring, just big number) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)', fontFamily: "'JetBrains Mono', monospace" }}>
                {avgKcal > 0 ? avgKcal.toLocaleString() : '\u2014'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--label2)' }}>Avg kcal</div>
            </div>
            {/* Workouts ring */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ProgressRing progress={workoutCount / goals.gym_days} size={64} stroke={5} color={workoutCount >= goals.gym_days ? 'var(--green)' : 'var(--orange)'} />
                <div style={{ position: 'absolute', fontSize: 16, fontWeight: 700, color: workoutCount >= goals.gym_days ? 'var(--green)' : 'var(--orange)' }}>
                  {workoutCount}/{goals.gym_days}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--label2)' }}>Workouts</div>
            </div>
          </div>
          {stats && <WeekChart days={stats.food_by_day} />}
        </div>

        {/* Prominent adaptive calorie suggestion */}
        {suggestion.actionable && (
          <div className="card" style={{ padding: 16, marginBottom: 12, border: '1.5px solid var(--blue)', background: 'var(--blue)08' }}>
            <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Adaptive Recommendation
            </div>
            <div style={{ fontSize: 15, color: 'var(--label)', marginBottom: 10 }}>
              {suggestion.reason}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--blue)' }}>
                {suggestion.deltaKcal > 0 ? '+' : ''}{suggestion.deltaKcal} kcal → {suggestion.suggested.toLocaleString()} kcal/day
              </div>
              <button
                onClick={applySuggestion}
                disabled={saving}
                style={{
                  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10,
                  padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {/* Adaptive TDEE card */}
        {adaptiveTDEE && (
          <div className="card" style={{ padding: 16, marginBottom: 12, border: adaptiveTDEE.source === 'adaptive' ? '1.5px solid var(--green)' : '1px solid var(--gray4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Your TDEE
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600, borderRadius: 8, padding: '2px 8px',
                ...(adaptiveTDEE.source === 'adaptive'
                  ? { color: 'var(--green)', background: '#10B98120' }
                  : { color: 'var(--orange)', background: '#F59E0B20' }),
              }}>
                {adaptiveTDEE.source === 'adaptive' ? 'Adaptive — based on your real data' : 'Estimated — log more to improve'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--label)', fontFamily: "'JetBrains Mono', monospace" }}>
                {(adaptiveTDEE.adaptive_tdee ?? adaptiveTDEE.estimated_tdee).toLocaleString()}
              </span>
              <span style={{ fontSize: 14, color: 'var(--label2)' }}>kcal/day</span>
            </div>
            {adaptiveTDEE.source === 'adaptive' && adaptiveTDEE.avg_daily_intake != null && (
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--label2)', marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                <span>Avg intake: {adaptiveTDEE.avg_daily_intake.toLocaleString()} kcal</span>
                <span>Weight: {adaptiveTDEE.weekly_change_kg != null && adaptiveTDEE.weekly_change_kg >= 0 ? '+' : ''}{adaptiveTDEE.weekly_change_kg?.toFixed(2)} kg/wk</span>
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--label2)', lineHeight: 1.5 }}>
              {adaptiveTDEE.recommendation}
            </div>
            {adaptiveTDEE.targets && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {(['target', 'maintain', 'aggressive'] as const).map(level => (
                  <div key={level} style={{ flex: 1, background: 'var(--gray6)', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: level === 'target' ? 'var(--blue)' : 'var(--label)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {adaptiveTDEE.targets![level].toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--label3)', marginTop: 2, textTransform: 'capitalize' }}>
                      {level === 'target' ? adaptiveTDEE.targets!.direction : level}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!adaptiveTDEE.data_status.sufficient && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--label3)', fontStyle: 'italic' }}>
                {adaptiveTDEE.data_status.message}
              </div>
            )}
          </div>
        )}

        {/* Accurate-TDEE nudge — only while the body profile is still on defaults. */}
        {profileIncomplete && (
          <button
            onClick={() => document.getElementById('body-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{
              width: '100%', textAlign: 'left', marginBottom: 12, cursor: 'pointer',
              border: '1.5px solid var(--orange)', background: 'var(--orange)0d', borderRadius: 14, padding: 16,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>
              Set your height, age & sex for an accurate TDEE
            </div>
            <div style={{ fontSize: 13, color: 'var(--label2)', lineHeight: 1.5 }}>
              Until you do, the TDEE math assumes 180 cm / 25 y / male — so the numbers above are a rough estimate, not yours. Tap to fill it in ↓
            </div>
          </button>
        )}

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

        {/* Suggested goals — derived from real TDEE + bodyweight + chosen
            direction. Lets Brody set honest, weight-aware targets in one tap
            instead of guessing round numbers. */}
        {goalSuggestion && (goalSuggestion.hasTdee || goalSuggestion.hasWeight) && !(calorieMatches && proteinMatches) && (
          <div className="card" style={{ padding: 16, marginBottom: 12, border: '1.5px solid var(--green)', background: 'var(--green)0d' }}>
            <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Suggested for your {direction} goal
            </div>
            <div style={{ fontSize: 13, color: 'var(--label2)', lineHeight: 1.5, marginBottom: 12 }}>
              {direction === 'gain'
                ? `Muscle gain: a ${goalSuggestion.calorieDelta > 0 ? '+' : ''}${goalSuggestion.calorieDelta} kcal lean-bulk surplus over your TDEE, protein at ${goalSuggestion.proteinPerKg} g/kg.`
                : direction === 'lose'
                  ? `Cut: a ${goalSuggestion.calorieDelta} kcal deficit under your TDEE, protein kept high (${goalSuggestion.proteinPerKg} g/kg) to spare muscle.`
                  : `Maintenance: eat at your TDEE, protein at ${goalSuggestion.proteinPerKg} g/kg.`}
            </div>

            {goalSuggestion.hasTdee && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Calories</div>
                  <div style={{ fontSize: 12, color: 'var(--label2)' }}>
                    now {goals.calories.toLocaleString()} → <strong style={{ color: 'var(--blue)' }}>{goalSuggestion.calories.toLocaleString()}</strong> kcal
                  </div>
                </div>
                <button onClick={() => applyGoalSuggestion('calories')} disabled={saving || calorieMatches}
                  style={{ background: calorieMatches ? 'var(--gray5)' : 'var(--blue)', color: calorieMatches ? 'var(--label2)' : '#fff',
                    border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: calorieMatches ? 'default' : 'pointer' }}>
                  {calorieMatches ? 'Set ✓' : 'Use'}
                </button>
              </div>
            )}

            {goalSuggestion.hasWeight && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Protein</div>
                  <div style={{ fontSize: 12, color: 'var(--label2)' }}>
                    now {goals.protein}g → <strong style={{ color: 'var(--orange)' }}>{goalSuggestion.protein}g</strong> ({goalSuggestion.proteinRange[0]}–{goalSuggestion.proteinRange[1]}g range)
                  </div>
                </div>
                <button onClick={() => applyGoalSuggestion('protein')} disabled={saving || proteinMatches}
                  style={{ background: proteinMatches ? 'var(--gray5)' : 'var(--orange)', color: proteinMatches ? 'var(--label2)' : '#fff',
                    border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: proteinMatches ? 'default' : 'pointer' }}>
                  {proteinMatches ? 'Set ✓' : 'Use'}
                </button>
              </div>
            )}

            {goalSuggestion.hasTdee && goalSuggestion.hasWeight && !(calorieMatches && proteinMatches) && (
              <button onClick={() => applyGoalSuggestion('both')} disabled={saving}
                style={{ width: '100%', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 12,
                  padding: '12px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Use both
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--label3)', marginTop: 10, fontStyle: 'italic' }}>
              Based on TDEE {tdeeVal?.toLocaleString()} kcal · {latestKg}kg bodyweight. Adjust anything with Edit above.
            </div>
          </div>
        )}

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
            <MiniBar value={avgProtein} goal={goals.protein} color="var(--orange)" />
          </div>
        </div>

        {/* Fitness goals */}
        <div className="section-label">Fitness goals</div>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Gym Days / Week</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Push/Pull/Legs rotation</div>
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

        {/* Body profile — feeds the TDEE calculators on the Body page */}
        <div className="section-label" id="body-profile">Body profile</div>
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', marginBottom: 12 }}>
            Used by the TDEE + adaptive-TDEE math. Weight comes from your weigh-ins automatically.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--label2)' }}>
              Height (cm)
              <input type="number" inputMode="numeric" value={bodyProfile.height_cm ?? ''}
                onChange={e => setBodyProfile(b => ({ ...b, height_cm: e.target.value ? parseFloat(e.target.value) : undefined }))}
                style={{ width: '100%', marginTop: 4, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none' }} />
            </label>
            <label style={{ fontSize: 13, color: 'var(--label2)' }}>
              Age
              <input type="number" inputMode="numeric" value={bodyProfile.age ?? ''}
                onChange={e => setBodyProfile(b => ({ ...b, age: e.target.value ? parseInt(e.target.value) : undefined }))}
                style={{ width: '100%', marginTop: 4, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none' }} />
            </label>
            <label style={{ fontSize: 13, color: 'var(--label2)' }}>
              Sex
              <select value={bodyProfile.sex ?? ''}
                onChange={e => setBodyProfile(b => ({ ...b, sex: e.target.value || undefined }))}
                style={{ width: '100%', marginTop: 4, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none' }}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label style={{ fontSize: 13, color: 'var(--label2)' }}>
              Activity
              <select value={bodyProfile.activity_level ?? ''}
                onChange={e => setBodyProfile(b => ({ ...b, activity_level: e.target.value || undefined }))}
                style={{ width: '100%', marginTop: 4, background: 'var(--gray6)', border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none' }}>
                <option value="">—</option>
                <option value="sedentary">Sedentary</option>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="active">Active</option>
                <option value="very_active">Very active</option>
              </select>
            </label>
          </div>
          <button
            onClick={async () => {
              setSavingProfile(true)
              try {
                await api.updateTdeeProfile(bodyProfile)
                showToast('Body profile saved', 'ok')
              } catch { showToast('Could not save profile', 'err') }
              setSavingProfile(false)
            }}
            disabled={savingProfile}
            style={{ width: '100%', padding: '10px 0', borderRadius: 12, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 15, fontWeight: 600, opacity: savingProfile ? 0.6 : 1 }}>
            {savingProfile ? 'Saving…' : 'Save body profile'}
          </button>
        </div>

        {/* Build info + force-refresh — escape hatch when an iOS PWA gets
            stuck on stale assets. Tap "Force refresh" to nuke the SW cache
            + reload, no need to uninstall the home-screen app. */}
        {/* Export Data */}
        <button onClick={async () => {
          try {
            const BASE = import.meta.env.VITE_API_BASE || '/api'
            const KEY_VAL: string | undefined = import.meta.env.VITE_API_KEY || undefined
            const headers: Record<string, string> = {}
            if (KEY_VAL) headers['X-Health-Key'] = KEY_VAL
            const res = await fetch(`${BASE}/export`, { headers })
            if (!res.ok) throw new Error(`Export failed: ${res.status}`)
            const data = await res.json()
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `health-hub-export-${new Date().toISOString().slice(0, 10)}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            showToast('Data exported')
          } catch (err) {
            showToast(`Export failed: ${String(err).slice(0, 60)}`, 'err')
          }
        }} style={{
          width: '100%',
          marginTop: 20,
          background: 'var(--card)',
          border: '1px solid var(--separator)',
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--label2)' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>Export Data</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--label3)' }}>JSON backup</span>
        </button>

        {/* Real web-push opt-in (readiness / weekly check-in / hydration).
            Server-side prefs live per-device; the VPS scheduler reads them. */}
        <PushSettings />

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
