import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { celebrate } from '../lib/celebrations'
import { showToast } from '../toast'
import { loadDirection } from '../lib/calorie-target'
import type { BodyMetric, TDEEData, SleepStats } from '../api/client'

// ── Reusable components matching dark bento design from Today.tsx ────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-[var(--c-label-faint)] font-medium mb-2">{children}</div>
}

function BigNumber({ value, unit, color }: { value: string | number; unit?: string; color?: string }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      letterSpacing: '-0.03em',
      color: color || 'var(--c-label)',
      fontSize: 28,
      fontWeight: 600,
      lineHeight: 1,
    }}>
      {value}
      {unit && <span style={{ fontSize: 14, color: 'var(--c-label-dim)', marginLeft: 6, fontWeight: 400 }}>{unit}</span>}
    </div>
  )
}

function ProgressRing({ progress, size = 72, stroke = 6, color = 'var(--blue)' }: { progress: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const raf = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(raf) }, [])
  const displayProgress = mounted ? Math.min(progress, 1) : 0
  const offset = c * (1 - displayProgress)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--c-border)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </svg>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
      background: `${color}18`, color, border: `1px solid ${color}30`,
    }}>{text}</span>
  )
}

// ── Sleep mini bar (horizontal bar for a single night) ──────────────────────

function SleepBar({ hours, quality, maxHours = 10 }: { hours: number; quality: number; maxHours?: number }) {
  const pct = Math.min(hours / maxHours * 100, 100)
  const barColor = quality >= 4 ? 'var(--green)' : quality >= 3 ? 'var(--purple)' : 'var(--orange)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--c-label-dim)', fontFamily: "'JetBrains Mono', monospace", minWidth: 32, textAlign: 'right' }}>
        {hours.toFixed(1)}h
      </span>
    </div>
  )
}

// ── Weight sparkline (interactive-style chart) ──────────────────────────────

function WeightChart({ data, height = 120 }: { data: { date: string; value: number }[]; height?: number }) {
  if (data.length < 2) return null
  const values = data.map(d => d.value)
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const range = max - min || 1
  const w = 320
  const h = height

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d.value - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  // Area fill under the line
  const areaPoints = `0,${h} ${points} ${w},${h}`

  const lastX = ((data.length - 1) / (data.length - 1)) * w
  const lastY = h - ((data[data.length - 1].value - min) / range) * h

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h + 20}`} preserveAspectRatio="none" style={{ display: 'block', height }}>
        <defs>
          <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#weightGradient)" />
        <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX} cy={lastY} r="5" fill="var(--blue)" />
        <circle cx={lastX} cy={lastY} r="8" fill="var(--blue)" fillOpacity="0.2" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, padding: '0 2px' }}>
        <span style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>{data[0].date.slice(5)}</span>
        <span style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>{max.toFixed(1)} kg</span>
        <span style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>{data[data.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}

// ── Measurement trend (waist, body-fat) ─────────────────────────────────────
// A compact factual line — no green/red moralising, because on a lean bulk a
// rising waist or body-fat isn't simply "bad" (the app's honesty rule: don't
// assign a value judgement the user's goal doesn't warrant).
function MeasurementTrend({ label, data, unit, color }: {
  label: string; data: { date: string; value: number }[]; unit: string; color: string
}) {
  if (data.length < 2) return null
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 300, h = 56
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d.value - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const first = data[0].value
  const last = data[data.length - 1].value
  const delta = last - first
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--c-label-dim)' }}>{label}</span>
        <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: 'var(--c-label)' }}>
          {last.toFixed(1)} {unit}
          <span style={{ color: 'var(--c-label-faint)', marginLeft: 6 }}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta).toFixed(1)}
          </span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h + 4}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </svg>
    </div>
  )
}

// ── Main Metrics Page ───────────────────────────────────────────────────────

export default function Metrics() {
  const [tdee, setTdee] = useState<TDEEData | null>(null)
  const [latest, setLatest] = useState<BodyMetric | null>(null)
  const [sleepStats, setSleepStats] = useState<SleepStats | null>(null)
  const [metrics, setMetrics] = useState<BodyMetric[]>([])
  const [showLog, setShowLog] = useState(false)
  const [showSleep, setShowSleep] = useState(false)
  const [rangeDays, setRangeDays] = useState(30)

  // Weight log form
  const [weight, setWeight] = useState('')
  const [bodyFat, setBodyFat] = useState('')
  const [waist, setWaist] = useState('')

  // Sleep log form
  const [bedtime, setBedtime] = useState('23:00')
  const [wakeTime, setWakeTime] = useState('07:00')
  const [quality, setQuality] = useState(3)
  const [hrv, setHrv] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.getTDEE().then(setTdee).catch(() => {})
    api.getLatestMetric().then(r => setLatest(r.metric)).catch(() => {})
    api.getSleepStats(7).then(setSleepStats).catch(() => {})
    api.getMetrics(90).then(r => setMetrics(r.metrics)).catch(() => {})
  }, [])

  async function handleLogWeight(e: React.FormEvent) {
    e.preventDefault()
    if (!weight && !bodyFat && !waist) return
    setSubmitting(true)
    try {
      await api.addMetric({
        weight_kg: weight ? parseFloat(weight) : undefined,
        body_fat_pct: bodyFat ? parseFloat(bodyFat) : undefined,
        waist_cm: waist ? parseFloat(waist) : undefined,
      })
      const [newLatest, newTdee, newMetrics] = await Promise.all([
        api.getLatestMetric(), api.getTDEE(), api.getMetrics(90)
      ])
      setLatest(newLatest.metric)
      setTdee(newTdee)
      setMetrics(newMetrics.metrics)
      setWeight(''); setBodyFat(''); setWaist('')
      setShowLog(false)
      if (navigator.vibrate) navigator.vibrate(10)
    } catch {
      // Was try/finally with no catch — a failed log threw unhandled, the
      // sheet stayed open and the user got no signal.
      showToast('Could not save — check connection', 'err')
    } finally { setSubmitting(false) }
  }

  async function handleLogSleep(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.logSleep({ bedtime, wake_time: wakeTime, quality, hrv_ms: hrv ? parseInt(hrv) : undefined })
      const stats = await api.getSleepStats(7)
      setSleepStats(stats)
      setShowSleep(false)
      if (navigator.vibrate) navigator.vibrate(10)
    } catch {
      showToast('Could not save sleep — check connection', 'err')
    } finally { setSubmitting(false) }
  }

  // Compute derived data
  const weights = metrics.filter(m => m.weight_kg).map(m => ({ date: m.date, value: m.weight_kg! }))
  // Filter by actual date window (was `.slice(-rangeDays)` — with sparse
  // logging, "90d" could span a year of entries).
  const rangeCutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().slice(0, 10)
  const chartWeights = weights.filter(w => w.date >= rangeCutoff)
  // Body-composition trends — waist + body-fat over the selected window. Data
  // already exists in body_metrics.json; it was only ever shown as a single
  // latest value before (roadmap #4).
  const waistSeries = metrics
    .filter(m => m.waist_cm != null)
    .map(m => ({ date: m.date, value: m.waist_cm! }))
    .filter(m => m.date >= rangeCutoff)
  const bodyFatSeries = metrics
    .filter(m => m.body_fat_pct != null)
    .map(m => ({ date: m.date, value: m.body_fat_pct! }))
    .filter(m => m.date >= rangeCutoff)
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null
  const weekAgoWeight = weights.find(w => {
    if (!latestWeight) return false
    const diff = new Date(latestWeight.date).getTime() - new Date(w.date).getTime()
    return diff >= 6 * 86400000 && diff <= 8 * 86400000
  })
  const weeklyChange = latestWeight && weekAgoWeight ? latestWeight.value - weekAgoWeight.value : null

  // Trend direction for celebration — compare the OBSERVED trend against the
  // user's CHOSEN direction from Goals (gain/maintain/lose). Was hardcoded to
  // celebrate losing/maintaining only, which told a bulking user he was
  // off-track whenever he gained.
  const observedDirection = tdee?.weight_trend?.direction
  const chosenDirection = loadDirection(localStorage)
  const trendMatchesGoal =
    (chosenDirection === 'gain' && observedDirection === 'gaining') ||
    (chosenDirection === 'lose' && observedDirection === 'losing') ||
    (chosenDirection === 'maintain' && observedDirection === 'maintaining')

  // Celebrate consecutive-day weight logging streak
  const celebratedRef = useRef(false)
  useEffect(() => {
    if (celebratedRef.current || weights.length < 3) return
    // Count consecutive days from today backwards
    const today = new Date().toISOString().slice(0, 10)
    const dates = new Set(weights.map(w => w.date))
    let streak = 0
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      if (dates.has(d)) streak++
      else break
    }
    if (streak >= 7) {
      celebratedRef.current = true
      celebrate('streak', `${streak}-day logging streak!`)
    }
    void today // suppress unused lint
  }, [weights])

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 8 }}>Body & Recovery</div>

        {/* ─── HERO: Weight Display ─── */}
        <Card>
          {latestWeight ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <CardLabel>Current Weight</CardLabel>
                  <BigNumber value={latestWeight.value.toFixed(1)} unit="kg" color="var(--blue)" />
                  {weeklyChange !== null && (
                    <div style={{ marginTop: 8 }}>
                      <Badge
                        text={`${weeklyChange > 0 ? '+' : ''}${weeklyChange.toFixed(1)} kg / week`}
                        color={weeklyChange < 0 ? '#10B981' : weeklyChange > 0 ? '#EF4444' : '#A1A1AA'}
                      />
                    </div>
                  )}
                </div>
                {/* Mini sparkline in hero */}
                {weights.length >= 3 && (
                  <div style={{ width: 120, height: 48 }}>
                    <svg width="100%" viewBox={`0 0 120 48`} preserveAspectRatio="none">
                      {(() => {
                        const last14 = weights.slice(-14)
                        const vals = last14.map(d => d.value)
                        const mn = Math.min(...vals) - 0.3
                        const mx = Math.max(...vals) + 0.3
                        const rng = mx - mn || 1
                        const pts = last14.map((d, i) => {
                          const x = (i / (last14.length - 1)) * 120
                          const y = 48 - ((d.value - mn) / rng) * 48
                          return `${x},${y}`
                        }).join(' ')
                        return <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                      })()}
                    </svg>
                  </div>
                )}
              </div>
              {trendMatchesGoal && tdee?.weight_trend && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#10B98112', borderRadius: 8, border: '1px solid #10B98125' }}>
                  <span style={{ fontSize: 13, color: '#10B981', fontWeight: 500 }}>On track — weight is {tdee.weight_trend.direction}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>⚖️</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-label)', marginBottom: 6 }}>
                Log your first weigh-in
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-label-dim)', lineHeight: 1.5, maxWidth: 260, margin: '0 auto 16px' }}>
                Track your weight over time to see trends, TDEE estimates, and progress toward your goals.
              </div>
              <button onClick={() => { setShowLog(true); setShowSleep(false) }} style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 12, padding: '11px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                + Log Weight
              </button>
            </div>
          )}
        </Card>

        {/* ─── Quick Log Buttons ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => { setShowLog(!showLog); setShowSleep(false) }} style={{
            background: showLog ? 'var(--blue)' : 'var(--c-card)',
            color: showLog ? '#fff' : 'var(--blue)',
            border: `1px solid ${showLog ? 'var(--blue)' : 'var(--c-border)'}`,
            borderRadius: 12, padding: '14px 12px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}>
            {showLog ? 'Cancel' : '+ Log Weight'}
          </button>
          <button onClick={() => { setShowSleep(!showSleep); setShowLog(false) }} style={{
            background: showSleep ? 'var(--purple)' : 'var(--c-card)',
            color: showSleep ? '#fff' : 'var(--purple)',
            border: `1px solid ${showSleep ? 'var(--purple)' : 'var(--c-border)'}`,
            borderRadius: 12, padding: '14px 12px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}>
            {showSleep ? 'Cancel' : '+ Log Sleep'}
          </button>
        </div>

        {/* Log Weight Form */}
        {showLog && (
          <Card>
            <form onSubmit={handleLogWeight} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-field" style={{ flex: 1, padding: '12px', fontSize: 16 }} placeholder="Weight (kg)" type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} autoFocus />
                <input className="input-field" style={{ flex: 1, padding: '12px', fontSize: 16 }} placeholder="Body fat %" type="number" step="0.1" value={bodyFat} onChange={e => setBodyFat(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-field" style={{ flex: 1, padding: '12px', fontSize: 16 }} placeholder="Waist (cm)" type="number" step="0.5" value={waist} onChange={e => setWaist(e.target.value)} />
                <button type="submit" disabled={submitting || (!weight && !bodyFat && !waist)} style={{
                  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10,
                  padding: '12px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  opacity: (!weight && !bodyFat && !waist) ? 0.5 : 1,
                }}>
                  {submitting ? '...' : 'Save'}
                </button>
              </div>
            </form>
          </Card>
        )}

        {/* Log Sleep Form */}
        {showSleep && (
          <Card>
            <form onSubmit={handleLogSleep} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>Bedtime</label>
                  <input className="input-field" style={{ width: '100%', padding: '12px', fontSize: 16 }} type="time" value={bedtime} onChange={e => setBedtime(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>Wake</label>
                  <input className="input-field" style={{ width: '100%', padding: '12px', fontSize: 16 }} type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>Quality</label>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {[1,2,3,4,5].map(n => (
                      <button key={n} type="button" onClick={() => setQuality(n)} style={{
                        width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: quality >= n ? 'var(--purple)' : 'var(--c-border)',
                        color: quality >= n ? '#fff' : 'var(--c-label-dim)', fontWeight: 600, fontSize: 14,
                      }}>{n}</button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>HRV (ms)</label>
                  <input className="input-field" style={{ width: '100%', padding: '12px', fontSize: 16 }} type="number" placeholder="e.g. 45" value={hrv} onChange={e => setHrv(e.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={submitting} style={{
                background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 10,
                padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%',
              }}>
                {submitting ? '...' : 'Log Sleep'}
              </button>
            </form>
          </Card>
        )}

        {/* ─── Body Composition ─── */}
        {latest && (latest.body_fat_pct || latest.waist_cm) && (
          <Card>
            <CardLabel>Body Composition</CardLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {latest.body_fat_pct && (
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ProgressRing progress={latest.body_fat_pct / 40} size={72} stroke={6} color="var(--orange)" />
                  <div style={{ position: 'absolute', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{latest.body_fat_pct}%</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {latest.body_fat_pct && (
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>Body Fat</span>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{latest.body_fat_pct}%</div>
                  </div>
                )}
                {latest.waist_cm && (
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>Waist</span>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{latest.waist_cm} cm</div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* ─── TDEE Card ─── */}
        <Card>
          <CardLabel>Energy Expenditure</CardLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginBottom: 4 }}>BMR</div>
              <BigNumber value={tdee?.bmr ?? '--'} unit="kcal" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginBottom: 4 }}>TDEE</div>
              <BigNumber value={tdee?.tdee ?? '--'} unit="kcal" color="var(--blue)" />
            </div>
          </div>
          {tdee?.activity_level && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge text={tdee.activity_level.replace('_', ' ').toUpperCase()} color="#6366F1" />
              {tdee.activity_source === 'steps' && tdee.steps_activity ? (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                  from your steps · {tdee.steps_activity.avg_steps.toLocaleString()}/day
                </span>
              ) : tdee.activity_source === 'default' ? (
                <span style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>
                  assumed — set activity in Goals
                </span>
              ) : null}
            </div>
          )}
          {tdee?.avg_intake_14d && tdee?.tdee && (
            <div style={{ padding: '10px 12px', background: 'var(--c-border)', borderRadius: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--c-label-dim)' }}>Avg Intake (14d)</span>
                <span style={{ fontWeight: 600, color: tdee.avg_intake_14d > tdee.tdee + 200 ? '#EF4444' : tdee.avg_intake_14d < tdee.tdee - 200 ? 'var(--orange)' : '#10B981' }}>
                  {tdee.avg_intake_14d.toLocaleString()} kcal
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                <span style={{ color: 'var(--c-label-dim)' }}>Delta</span>
                <span style={{ fontWeight: 600 }}>
                  {tdee.avg_intake_14d - tdee.tdee > 0 ? '+' : ''}{tdee.avg_intake_14d - tdee.tdee} kcal/day
                </span>
              </div>
            </div>
          )}
          {tdee?.weight_trend && (
            <div style={{ fontSize: 13, color: 'var(--c-label-dim)', padding: '8px 12px', background: 'var(--c-border)', borderRadius: 8, marginBottom: 8 }}>
              Weight trend: <strong style={{ color: 'var(--c-label)' }}>{tdee.weight_trend.direction}</strong> ({tdee.weight_trend.weekly_change_kg > 0 ? '+' : ''}{tdee.weight_trend.weekly_change_kg} kg/week)
            </div>
          )}
          {tdee?.recommendation && (
            <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 4 }}>{tdee.recommendation}</div>
          )}
        </Card>

        {/* ─── Sleep Summary ─── */}
        <Card>
          <CardLabel>Sleep (7-day avg)</CardLabel>
          {sleepStats && sleepStats.entries > 0 ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {sleepStats.avg_duration?.toFixed(1) ?? '--'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>hrs avg</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>
                    {'*'.repeat(Math.round(sleepStats.avg_quality ?? 0))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>{sleepStats.avg_quality?.toFixed(1)}/5</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {sleepStats.avg_hrv ?? '--'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>HRV ms</div>
                </div>
              </div>
              {/* Placeholder for nightly bars - would need per-night data from a new endpoint */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Show a single representative bar for now */}
                <SleepBar hours={sleepStats.avg_duration ?? 7} quality={Math.round(sleepStats.avg_quality ?? 3)} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: 'var(--c-label-dim)', padding: '12px 0' }}>
              No sleep data yet. Tap "+ Log Sleep" above to start tracking.
            </div>
          )}
        </Card>

        {/* ─── Weight History Chart ─── */}
        {chartWeights.length >= 2 && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <CardLabel>Weight History</CardLabel>
              <div style={{ display: 'flex', gap: 4 }}>
                {[30, 60, 90].map(d => (
                  <button key={d} onClick={() => setRangeDays(d)} style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    background: rangeDays === d ? 'var(--blue)' : 'var(--c-border)',
                    color: rangeDays === d ? '#fff' : 'var(--c-label-dim)',
                  }}>{d}d</button>
                ))}
              </div>
            </div>
            <WeightChart data={chartWeights} />
          </Card>
        )}

        {/* ─── Composition Trends (waist / body fat) ─── */}
        {(waistSeries.length >= 2 || bodyFatSeries.length >= 2) && (
          <Card>
            <CardLabel>Composition Trends · {rangeDays}d</CardLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {waistSeries.length >= 2 && (
                <MeasurementTrend label="Waist" data={waistSeries} unit="cm" color="var(--blue)" />
              )}
              {bodyFatSeries.length >= 2 && (
                <MeasurementTrend label="Body fat" data={bodyFatSeries} unit="%" color="var(--orange)" />
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 12, lineHeight: 1.5 }}>
              On a bulk, the scale can't separate muscle from fat — waist and body-fat trends can. Log them from “+ Log Weight”.
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
