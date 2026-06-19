import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'

// A proper weight trend (replaces the hand-rolled SVG sparkline on Goals).
// Lazy-loaded by its consumer so recharts stays out of the initial bundle.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Weight = { kg: number; date: string }
type Row = { label: string; kg: number }

function WeightTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 8,
      padding: '6px 10px', fontSize: 12, color: 'var(--label)',
      fontVariantNumeric: 'tabular-nums', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    }}>
      <div style={{ color: 'var(--label2)', marginBottom: 2 }}>{row.label}</div>
      {row.kg} kg
    </div>
  )
}

export default function WeightTrendChart({ weights }: { weights: Weight[] }) {
  const rows = useMemo<Row[]>(() =>
    weights.map(w => {
      const dt = new Date(w.date + 'T00:00:00')
      return {
        label: isNaN(dt.getTime()) ? w.date : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        kg: w.kg,
      }
    }), [weights])

  if (rows.length < 2) return null

  const vals = weights.map(w => w.kg)
  const min = Math.floor(Math.min(...vals) - 0.5)
  const max = Math.ceil(Math.max(...vals) + 0.5)

  return (
    <div style={{ width: '100%', height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--label3)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            domain={[min, max]}
            tick={{ fill: 'var(--label3)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={34}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip content={<WeightTooltip />} cursor={{ stroke: 'var(--separator)', strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="kg"
            stroke="var(--blue)"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: 'var(--blue)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            isAnimationActive={!prefersReducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
