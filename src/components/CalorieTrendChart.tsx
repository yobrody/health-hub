import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Cell, Tooltip } from 'recharts'
import type { HistoryDay } from '../api/client'

// First real chart in the app (recharts was bundled but unused). Shows the last
// `days` of calorie intake as bars against the goal line — under goal renders in
// the accent colour, over goal in orange. Days with no log are shown faintly.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Row = { label: string; kcal: number; logged: boolean }

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8,
      padding: '6px 10px', fontSize: 12, color: 'var(--c-label)',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace", boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    }}>
      <div style={{ color: 'var(--c-label-dim)', marginBottom: 2 }}>{row.label}</div>
      {row.logged ? `${row.kcal.toLocaleString()} kcal` : 'not logged'}
    </div>
  )
}

export default function CalorieTrendChart({ history, goal, days = 14 }: { history: HistoryDay[]; goal?: number | null; days?: number }) {
  // Honesty: only draw the dashed "goal" reference line when we actually know
  // the goal. Callers used to pass `?? 2200` on a failed goals fetch, which
  // painted a fabricated target the user never set (2026-08-04 honesty audit).
  const hasGoal = typeof goal === 'number' && goal > 0
  const rows = useMemo<Row[]>(() => {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
    return sorted.map(d => {
      const dt = new Date(d.date + 'T00:00:00')
      const label = isNaN(dt.getTime())
        ? d.date
        : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      return { label, kcal: d.logged ? d.total_kcal : 0, logged: d.logged }
    })
  }, [history, days])

  const loggedDays = rows.filter(r => r.logged).length
  if (loggedDays < 2) {
    return (
      <div style={{ fontSize: 13, color: 'var(--c-label-faint)', textAlign: 'center', padding: '24px 0' }}>
        Log a couple more days to see your calorie trend.
      </div>
    )
  }

  const max = Math.max(hasGoal ? goal : 0, ...rows.map(r => r.kcal), 1)

  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--c-label-faint)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: 'var(--c-label-faint)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={42}
            domain={[0, Math.ceil(max / 500) * 500]}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
          />
          {hasGoal && (
            <ReferenceLine
              y={goal}
              stroke="var(--c-label-dim)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{ value: `goal ${goal.toLocaleString()}`, position: 'insideTopRight', fill: 'var(--c-label-faint)', fontSize: 9 }}
            />
          )}
          <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--c-border)', opacity: 0.4 }} />
          <Bar dataKey="kcal" radius={[3, 3, 0, 0]} isAnimationActive={!prefersReducedMotion}>
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={!r.logged ? 'var(--c-border)' : (hasGoal && r.kcal > goal * 1.05) ? 'var(--c-orange)' : 'var(--c-accent)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
