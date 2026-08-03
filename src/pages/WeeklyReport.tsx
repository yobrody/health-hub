import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WeeklyReport as WeeklyReportData } from '../api/client'

function ProgressBar({ value, goal, color, label }: { value: number; goal: number; color: string; label: string }) {
  const pct = Math.min(value / Math.max(goal, 1), 1) * 100
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-label)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--c-label-dim)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {value.toLocaleString()} / {goal.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct}%`, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 2, textAlign: 'right' }}>
        {Math.round(pct)}%
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: color || 'var(--c-label)', letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--c-label-dim)' }}>{sub}</div>}
    </div>
  )
}

function WeightSparkline({ start, end, change }: { start: number | null; end: number | null; change: number | null }) {
  if (start === null || end === null) {
    return <div style={{ fontSize: 13, color: 'var(--c-label-faint)' }}>No weight data this week</div>
  }
  const dir = change !== null ? (change > 0.1 ? 'up' : change < -0.1 ? 'down' : 'stable') : 'stable'
  const arrow = dir === 'up' ? '\u2191' : dir === 'down' ? '\u2193' : '\u2192'
  const col = dir === 'down' ? 'var(--c-green)' : dir === 'up' ? 'var(--c-orange)' : 'var(--c-label-dim)'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
        {end.toFixed(1)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--c-label-faint)', marginLeft: 3 }}>kg</span>
      </span>
      {change !== null && (
        <span style={{ fontSize: 14, fontWeight: 600, color: col }}>
          {arrow} {change > 0 ? '+' : ''}{change.toFixed(1)}kg
        </span>
      )}
    </div>
  )
}

export default function WeeklyReport() {
  const [report, setReport] = useState<WeeklyReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tdee, setTdee] = useState<number | null>(null)

  useEffect(() => {
    api.getWeeklyReport()
      .then(setReport)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
    api.getAdaptiveTDEE()
      .then(t => setTdee(t.adaptive_tdee ?? t.estimated_tdee ?? null))
      .catch(() => {})
  }, [])

  if (loading) {
    return (
      <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <span style={{ fontSize: 14, color: 'var(--c-label-faint)' }}>Loading weekly report...</span>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
        <div className="page-content" style={{ padding: 20 }}>
          <div style={{ fontSize: 15, color: 'var(--c-orange)' }}>Could not load report</div>
          <div style={{ fontSize: 13, color: 'var(--c-label-faint)', marginTop: 4 }}>{error}</div>
        </div>
      </div>
    )
  }

  const routineNames = Object.entries(report.routines)
  const qualLabel = ['', 'Poor', 'Fair', 'OK', 'Good', 'Great']

  return (
    <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 4 }}>
            {report.period.start} - {report.period.end}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Weekly Report</div>
        </div>

        {/* Summary banner */}
        <div style={{
          background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
          padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, color: 'var(--c-label-dim)', lineHeight: 1.5 }}>{report.summary || 'No summary available this week.'}</div>
        </div>

        {/* Calories + Protein progress */}
        <div style={{
          background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
          padding: 16, marginBottom: 16,
        }}>
          <ProgressBar
            label="Calories"
            value={report.calories.total}
            goal={report.calories.goal}
            color="var(--c-accent)"
          />
          <ProgressBar
            label={`Protein (avg ${report.protein.avg_daily}g/day)`}
            value={report.protein.avg_daily}
            goal={report.protein.goal}
            color="var(--c-orange)"
          />
          <div style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>
            Logged {report.calories.logged_days}/7 days
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <StatCard
            label="Workouts"
            value={`${report.workouts.count}/${report.workouts.goal}`}
            sub={report.workouts.count >= report.workouts.goal ? 'Goal hit' : `${report.workouts.goal - report.workouts.count} to go`}
            color={report.workouts.count >= report.workouts.goal ? 'var(--c-green)' : undefined}
          />
          <StatCard
            label="Sleep"
            value={report.sleep.avg_duration_hrs !== null ? `${report.sleep.avg_duration_hrs}h` : '--'}
            sub={report.sleep.avg_quality !== null
              ? `Quality: ${qualLabel[Math.round(report.sleep.avg_quality)] || report.sleep.avg_quality}/5`
              : 'No sleep data'}
          />
        </div>

        {/* Weight */}
        <div style={{
          background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
          padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 8 }}>
            Weight trend
          </div>
          <WeightSparkline start={report.weight.start} end={report.weight.end} change={report.weight.change} />
          {report.weight.start !== null && report.weight.end !== null && (
            <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 6 }}>
              {report.weight.start.toFixed(1)}kg at start of week
            </div>
          )}
        </div>

        {/* Calories ↔ Weight correlation */}
        {report.calories.logged_days > 0 && report.weight.change !== null && (
          <div style={{
            background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
            padding: 16, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 10 }}>
              Calories vs weight
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '-0.03em' }}>
                  {report.calories.avg_daily.toLocaleString()}
                  <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--c-label-faint)', marginLeft: 3 }}>kcal/day</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 2 }}>
                  avg over {report.calories.logged_days} logged day{report.calories.logged_days !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ fontSize: 24 }}>→</div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                {(() => {
                  const ch = report.weight.change!
                  const col = ch < -0.1 ? 'var(--c-green)' : ch > 0.1 ? 'var(--c-orange)' : 'var(--c-label-dim)'
                  const arrow = ch < -0.1 ? '↓' : ch > 0.1 ? '↑' : '→'
                  const label = ch < -0.1 ? 'losing' : ch > 0.1 ? 'gaining' : 'holding'
                  return (
                    <>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: col, letterSpacing: '-0.03em' }}>
                        {arrow} {Math.abs(ch).toFixed(1)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--c-label-faint)', marginLeft: 3 }}>kg</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 2 }}>{label} weight</div>
                    </>
                  )
                })()}
              </div>
            </div>
            {/* Deficit/surplus estimate */}
            {(() => {
              // Real TDEE from /tdee/adaptive (was a hardcoded 2500).
              if (!tdee) return null
              const diff = report.calories.avg_daily - tdee
              if (Math.abs(diff) < 50) return null
              const t = tdee.toLocaleString()
              return (
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--c-bg)', borderRadius: 8, fontSize: 12, color: 'var(--c-label-dim)' }}>
                  {diff < 0
                    ? `~${Math.abs(diff).toLocaleString()} kcal/day deficit vs ~${t} kcal TDEE`
                    : `~${diff.toLocaleString()} kcal/day surplus vs ~${t} kcal TDEE`}
                </div>
              )
            })()}
          </div>
        )}

        {/* Top foods */}
        {report.top_foods.length > 0 && (
          <div style={{
            background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
            padding: 16, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 10 }}>
              Top foods
            </div>
            {report.top_foods.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < report.top_foods.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-accent)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", width: 20 }}>{i + 1}</span>
                  <span style={{ fontSize: 14, color: 'var(--c-label)' }}>{f.name}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--c-label-faint)', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{f.count}x</span>
              </div>
            ))}
          </div>
        )}

        {/* Routine streaks */}
        {routineNames.length > 0 && (
          <div style={{
            background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14,
            padding: 16, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 10 }}>
              Routine streaks
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {routineNames.map(([name, streak]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-bg)', borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ fontSize: 14 }}>{streak > 0 ? '\uD83D\uDD25' : '\u2B50'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: 'var(--c-orange)' }}>{streak}</span>
                  <span style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>{name.replace(/-/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
