import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import {
  analyzeWeightTrend,
  loadDirection,
  suggestCalorieTarget,
  type WeightEntry,
} from '../lib/calorie-target'
import type { Goals } from '../api/client'

// Proactive weekly check-in for the home screen (roadmap #3). The adaptive
// engine (suggestCalorieTarget) + Apply already live on the Goals page; the
// missing piece was *cadence* — the app waited to be opened on the right tab.
// This surfaces the same, already-tested recommendation once per week on Today,
// so goals track the body automatically instead of on manual taps.
//
// Honest by construction: renders nothing unless the trend is reliable enough
// for suggestCalorieTarget to return `actionable` (≥14 days of weigh-ins and
// out of the target band) — it never nags off noise or fabricates a target.

// Monday (local) of the current week — the once-a-week de-dupe key.
function mondayKey(d = new Date()): string {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x.toISOString().slice(0, 10)
}

const LS_DISMISS = 'weekly_checkin_dismissed'

export function WeeklyCheckIn({ onOpenGoals }: { onOpenGoals?: () => void }) {
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [goals, setGoals] = useState<Goals | null>(null)
  const [dismissedWeek, setDismissedWeek] = useState<string>(() => {
    try { return localStorage.getItem(LS_DISMISS) || '' } catch { return '' }
  })
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    api.getWeightLog(60)
      .then(r => setWeights(r.entries.map(e => ({ date: e.date, kg: e.kg }))))
      .catch(() => { /* offline — no check-in this render */ })
    api.getGoals().then(g => setGoals(g.parsed)).catch(() => {})
  }, [])

  const week = mondayKey()
  if (dismissedWeek === week || !goals) return null

  const trend = analyzeWeightTrend(weights)
  const direction = loadDirection(localStorage)
  const suggestion = suggestCalorieTarget(goals.calories, trend, direction)
  if (!suggestion.actionable || !trend) return null

  function markDone() {
    try { localStorage.setItem(LS_DISMISS, week) } catch { /* quota */ }
    setDismissedWeek(week)
  }

  async function apply() {
    setApplying(true)
    try {
      const updated = await api.updateGoals({ calories: suggestion.suggested }) as { ok: boolean; goals: Goals }
      setGoals(updated.goals)
      if (navigator.vibrate) navigator.vibrate(8)
      showToast(`Calorie target set to ${suggestion.suggested.toLocaleString()}`)
      markDone()
    } catch {
      showToast('Could not apply — try from Goals', 'err')
    } finally {
      setApplying(false)
    }
  }

  const trendTxt = `${trend.weeklyChangeKg >= 0 ? '+' : ''}${trend.weeklyChangeKg.toFixed(2)} kg/wk`

  return (
    <div style={{
      marginBottom: 20, padding: 16, borderRadius: 14,
      border: '1.5px solid var(--c-accent)', background: 'var(--c-accent)0d',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c-accent)' }}>
          Weekly check-in
        </div>
        <button onClick={markDone} aria-label="Dismiss for this week" style={{
          background: 'none', border: 'none', color: 'var(--c-label-faint)', fontSize: 13, cursor: 'pointer',
        }}>Later</button>
      </div>
      <div style={{ fontSize: 14, color: 'var(--c-label)', lineHeight: 1.5, marginBottom: 12 }}>
        You're trending <strong>{trendTxt}</strong>. {suggestion.reason}.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={apply} disabled={applying} style={{
          flex: 1, background: 'var(--c-accent)', color: '#fff', border: 'none', borderRadius: 10,
          padding: '11px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: applying ? 0.6 : 1,
        }}>
          {suggestion.deltaKcal > 0 ? '+' : ''}{suggestion.deltaKcal} kcal → {suggestion.suggested.toLocaleString()}
        </button>
        {onOpenGoals && (
          <button onClick={onOpenGoals} style={{
            background: 'var(--c-card)', color: 'var(--c-label-dim)', border: '1px solid var(--c-border)',
            borderRadius: 10, padding: '11px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Review</button>
        )}
      </div>
    </div>
  )
}
