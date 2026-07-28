import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Insight } from '../api/client'

const TYPE_COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  positive: { bg: '#10B98110', border: '#10B98130', accent: '#10B981' },
  neutral:  { bg: '#F59E0B10', border: '#F59E0B30', accent: '#F59E0B' },
  negative: { bg: '#EF444410', border: '#EF444430', accent: '#EF4444' },
}

const CATEGORY_LABELS: Record<string, string> = {
  sleep: 'Sleep',
  nutrition: 'Nutrition',
  fitness: 'Fitness',
  weight: 'Weight',
}

function InsightCard({ insight }: { insight: Insight }) {
  const colors = TYPE_COLORS[insight.type] || TYPE_COLORS.neutral
  return (
    <div style={{
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      padding: '16px 18px',
      marginBottom: 12,
      borderLeft: `4px solid ${colors.accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{insight.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-label, var(--label))', lineHeight: 1.4 }}>
            {insight.text}
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
              background: `${colors.accent}18`, color: colors.accent,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {CATEGORY_LABELS[insight.category] || insight.category}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Insights() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getInsights()
      .then(r => setInsights(r.insights))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>Insights</div>
          <div style={{ fontSize: 13, color: 'var(--c-label-dim, var(--label2))', marginTop: 4 }}>
            Updated daily — correlations across your health data
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-label-dim, var(--label2))' }}>
            Analyzing your data...
          </div>
        )}

        {!loading && insights.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            color: 'var(--c-label-dim, var(--label2))',
            background: 'var(--c-card, var(--card))',
            borderRadius: 16, border: '1px solid var(--c-border, var(--separator))',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{'🔬'}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Not enough data yet</div>
            <div style={{ fontSize: 14 }}>
              Keep logging food, workouts, and sleep. Insights appear after a few days of data.
            </div>
          </div>
        )}

        {insights.map((insight, i) => (
          <InsightCard key={i} insight={insight} />
        ))}

        {!loading && insights.length > 0 && (
          <div style={{
            textAlign: 'center', fontSize: 12, color: 'var(--c-label-faint, var(--label3))',
            marginTop: 16, paddingTop: 16, borderTop: '0.5px solid var(--separator, var(--c-border))',
          }}>
            Based on the last 30 days of health data
          </div>
        )}
      </div>
    </div>
  )
}
