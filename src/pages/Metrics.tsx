import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BodyMetric, TDEEData, SleepStats } from '../api/client'

function StatCard({ label, value, unit, color }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, padding: '14px 16px', flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || 'var(--label)', letterSpacing: '-0.5px' }}>
        {value ?? '—'}{unit && <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--label2)' }}> {unit}</span>}
      </div>
    </div>
  )
}

export default function Metrics() {
  const [tdee, setTdee] = useState<TDEEData | null>(null)
  const [latest, setLatest] = useState<BodyMetric | null>(null)
  const [sleepStats, setSleepStats] = useState<SleepStats | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [showSleep, setShowSleep] = useState(false)
  const [metrics, setMetrics] = useState<BodyMetric[]>([])

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
    } finally { setSubmitting(false) }
  }

  // Weight chart — simple sparkline from metrics
  const weights = metrics.filter(m => m.weight_kg).map(m => ({ date: m.date, value: m.weight_kg! })).slice(-30)

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 20 }}>Body & Recovery</div>

        {/* TDEE Card */}
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 10 }}>TDEE Calculator</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <StatCard label="BMR" value={tdee?.bmr ?? null} unit="kcal" />
            <StatCard label="TDEE" value={tdee?.tdee ?? null} unit="kcal" color="var(--blue)" />
          </div>
          {tdee?.avg_intake_14d && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <StatCard label="Avg Intake (14d)" value={tdee.avg_intake_14d} unit="kcal" color={
                tdee.avg_intake_14d > tdee.tdee + 200 ? 'var(--red)' : tdee.avg_intake_14d < tdee.tdee - 200 ? 'var(--orange)' : 'var(--green)'
              } />
              <StatCard label="Delta" value={`${tdee.avg_intake_14d - tdee.tdee > 0 ? '+' : ''}${tdee.avg_intake_14d - tdee.tdee}`} unit="kcal" />
            </div>
          )}
          {tdee?.weight_trend && (
            <div style={{ fontSize: 13, color: 'var(--label2)', padding: '8px 12px', background: 'var(--bg)', borderRadius: 10 }}>
              Weight trend: <strong>{tdee.weight_trend.direction}</strong> ({tdee.weight_trend.weekly_change_kg > 0 ? '+' : ''}{tdee.weight_trend.weekly_change_kg} kg/week)
            </div>
          )}
          {tdee?.recommendation && (
            <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 8 }}>{tdee.recommendation}</div>
          )}
        </div>

        {/* Weight + Body Metrics */}
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)' }}>Body Metrics</div>
            <button onClick={() => setShowLog(!showLog)} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {showLog ? 'Cancel' : '+ Log'}
            </button>
          </div>

          {latest && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {latest.weight_kg && <StatCard label="Weight" value={latest.weight_kg} unit="kg" color="var(--blue)" />}
              {latest.body_fat_pct && <StatCard label="Body Fat" value={latest.body_fat_pct} unit="%" />}
              {latest.waist_cm && <StatCard label="Waist" value={latest.waist_cm} unit="cm" />}
            </div>
          )}

          {/* Mini weight chart */}
          {weights.length >= 2 && (
            <div style={{ marginBottom: 12 }}>
              <WeightChart data={weights} />
            </div>
          )}

          {showLog && (
            <form onSubmit={handleLogWeight} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-field" style={{ flex: 1, padding: '10px 12px', fontSize: 15 }} placeholder="Weight (kg)" type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} />
                <input className="input-field" style={{ flex: 1, padding: '10px 12px', fontSize: 15 }} placeholder="Body fat %" type="number" step="0.1" value={bodyFat} onChange={e => setBodyFat(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input-field" style={{ flex: 1, padding: '10px 12px', fontSize: 15 }} placeholder="Waist (cm)" type="number" step="0.5" value={waist} onChange={e => setWaist(e.target.value)} />
                <button type="submit" disabled={submitting || (!weight && !bodyFat && !waist)} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (!weight && !bodyFat && !waist) ? 0.5 : 1 }}>
                  {submitting ? '...' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Sleep Card */}
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)' }}>Sleep & Recovery</div>
            <button onClick={() => setShowSleep(!showSleep)} style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {showSleep ? 'Cancel' : '+ Log'}
            </button>
          </div>

          {sleepStats && sleepStats.entries > 0 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <StatCard label="Avg Sleep" value={sleepStats.avg_duration} unit="hrs" color="var(--purple)" />
              <StatCard label="Avg Quality" value={sleepStats.avg_quality ? `${sleepStats.avg_quality}/5` : null} color="var(--purple)" />
              {sleepStats.avg_hrv && <StatCard label="Avg HRV" value={sleepStats.avg_hrv} unit="ms" color="var(--green)" />}
            </div>
          )}

          {showSleep && (
            <form onSubmit={handleLogSleep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--label2)' }}>Bedtime</label>
                  <input className="input-field" style={{ width: '100%', padding: '10px 12px', fontSize: 15 }} type="time" value={bedtime} onChange={e => setBedtime(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--label2)' }}>Wake</label>
                  <input className="input-field" style={{ width: '100%', padding: '10px 12px', fontSize: 15 }} type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--label2)' }}>Quality (1-5)</label>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {[1,2,3,4,5].map(n => (
                      <button key={n} type="button" onClick={() => setQuality(n)} style={{
                        width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: quality >= n ? 'var(--purple)' : 'var(--gray5)',
                        color: quality >= n ? '#fff' : 'var(--label2)', fontWeight: 600, fontSize: 14,
                      }}>{n}</button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--label2)' }}>HRV (ms, optional)</label>
                  <input className="input-field" style={{ width: '100%', padding: '10px 12px', fontSize: 15 }} type="number" placeholder="e.g. 45" value={hrv} onChange={e => setHrv(e.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={submitting} style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                {submitting ? '...' : 'Log Sleep'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function WeightChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length < 2) return null
  const values = data.map(d => d.value)
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const range = max - min || 1
  const w = 280
  const h = 80

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d.value - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>Weight trend (last {data.length} entries)</div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {data.length > 0 && (() => {
          const lastX = ((data.length - 1) / (data.length - 1)) * w
          const lastY = h - ((data[data.length - 1].value - min) / range) * h
          return <circle cx={lastX} cy={lastY} r="4" fill="var(--blue)" />
        })()}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--label3)' }}>
        <span>{data[0].date.slice(5)}</span>
        <span>{data[data.length - 1].value} kg</span>
        <span>{data[data.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}
