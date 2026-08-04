import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { api } from '../api/client'
import type { WorkoutData, PR, HistoryDay, Goals } from '../api/client'
import { loadDirection } from '../lib/calorie-target'
import { weightProgressTone } from '../lib/goal-suggestions'

// Charts are lazy so recharts stays out of the initial bundle.
const WeightTrendChart = lazy(() => import('../components/WeightTrendChart'))
const CalorieTrendChart = lazy(() => import('../components/CalorieTrendChart'))

type Weight = { kg: number; date: string }

// Volume of one workout = Σ weight×reps over real (non-warm-up) sets.
function workoutVolume(w: WorkoutData): number {
  let v = 0
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.ramp) continue
      if (typeof s.weight_kg === 'number' && typeof s.reps === 'number') v += s.weight_kg * s.reps
    }
  }
  return v
}

// Monday (local) of the week a date falls in — the key we group weeks by.
function weekStart(iso: string): string {
  const d = new Date(iso)
  const day = (d.getDay() + 6) % 7 // 0 = Monday
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function fmtShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 10 }}>
      {children}
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-label-faint)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: color || 'var(--c-label)', letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--c-label-dim)' }}>{sub}</div>}
    </div>
  )
}

export default function Stats() {
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [prs, setPRs] = useState<Record<string, PR>>({})
  const [weights, setWeights] = useState<Weight[]>([])
  const [food, setFood] = useState<HistoryDay[]>([])
  const [goals, setGoals] = useState<Goals | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      api.getWorkouts(60),
      api.getPRs(),
      api.getWeightLog(120),
      api.getFoodHistory(30),
      api.getGoals(),
    ]).then(([w, p, wt, f, g]) => {
      if (w.status === 'fulfilled') setWorkouts(w.value ?? [])
      if (p.status === 'fulfilled') setPRs(p.value ?? {})
      if (wt.status === 'fulfilled') setWeights((wt.value?.entries ?? []).map(e => ({ kg: e.kg, date: e.date })))
      if (f.status === 'fulfilled') setFood(f.value ?? [])
      if (g.status === 'fulfilled') setGoals(g.value?.parsed ?? null)
    }).finally(() => setLoading(false))
  }, [])

  // ── Consistency & volume ──────────────────────────────────────────────────
  const consistency = useMemo(() => {
    const now = new Date()
    const thisWeekKey = weekStart(now.toISOString())
    const byWeek = new Map<string, { count: number; volume: number }>()
    let volume30 = 0
    const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30)
    for (const w of workouts) {
      const wk = weekStart(w.start_time)
      const cur = byWeek.get(wk) ?? { count: 0, volume: 0 }
      const vol = workoutVolume(w)
      cur.count += 1; cur.volume += vol
      byWeek.set(wk, cur)
      if (new Date(w.start_time) >= cutoff30) volume30 += vol
    }
    const weeks = Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
    const thisWeekCount = byWeek.get(thisWeekKey)?.count ?? 0
    return { weeks, thisWeekCount, volume30, totalWorkouts: workouts.length }
  }, [workouts])

  // ── Strength per exercise ─────────────────────────────────────────────────
  const strength = useMemo(() => {
    // newest-first sessions per exercise, with the top working weight of each.
    const byEx = new Map<string, { date: string; topWeight: number; topReps: number }[]>()
    const newest = [...workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))
    for (const w of newest) {
      for (const ex of w.exercises) {
        const working = ex.sets.filter(s => !s.ramp && typeof s.weight_kg === 'number' && s.weight_kg! > 0)
        if (!working.length) continue
        const top = working.reduce((best, s) => (s.weight_kg! > best.weight_kg! ? s : best), working[0])
        const arr = byEx.get(ex.name) ?? []
        arr.push({ date: w.start_time, topWeight: top.weight_kg!, topReps: top.reps ?? 0 })
        byEx.set(ex.name, arr)
      }
    }
    return Array.from(byEx.entries())
      .map(([name, sessions]) => {
        const latest = sessions[0]
        const prev = sessions[1]
        const trend = prev ? latest.topWeight - prev.topWeight : 0
        const pr = prs[name]
        return { name, latest, trend, sessions: sessions.length, pr }
      })
      .sort((a, b) => b.sessions - a.sessions || b.latest.topWeight - a.latest.topWeight)
      .slice(0, 10)
  }, [workouts, prs])

  // ── Nutrition ─────────────────────────────────────────────────────────────
  const nutrition = useMemo(() => {
    const logged = food.filter(d => d.logged)
    const avgKcal = logged.length ? Math.round(logged.reduce((s, d) => s + d.total_kcal, 0) / logged.length) : 0
    const proteinDays = logged.filter(d => typeof d.total_protein_g === 'number')
    const avgProtein = proteinDays.length ? Math.round(proteinDays.reduce((s, d) => s + (d.total_protein_g ?? 0), 0) / proteinDays.length) : 0
    return { avgKcal, avgProtein, loggedDays: logged.length }
  }, [food])

  const latestWeight = weights.length ? weights[weights.length - 1].kg : null
  const weightDelta = weights.length >= 2 ? weights[weights.length - 1].kg - weights[0].kg : null
  // Colour the body-weight delta by the user's actual goal: gaining is GOOD
  // when bulking, off-track when cutting. Anything else is a cut mindset the
  // app has no business assuming.
  const direction = loadDirection(localStorage)
  const weightTone = weightDelta !== null ? weightProgressTone(weightDelta, direction) : 'neutral'
  const weightColor = weightTone === 'good' ? 'var(--c-green)' : weightTone === 'bad' ? 'var(--c-orange)' : undefined

  if (loading) {
    return (
      <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <span style={{ fontSize: 14, color: 'var(--c-label-faint)' }}>Loading your progress…</span>
        </div>
      </div>
    )
  }

  const maxWeekVol = Math.max(1, ...consistency.weeks.map(w => w[1].volume))

  return (
    <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
      <div className="page-content">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 4 }}>All-time</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Progress</div>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <StatCard
            label="This week"
            value={`${consistency.thisWeekCount}/${goals?.gym_days ?? 4}`}
            sub={consistency.thisWeekCount >= (goals?.gym_days ?? 4) ? 'Goal hit 🎯' : 'workouts'}
            color={consistency.thisWeekCount >= (goals?.gym_days ?? 4) ? 'var(--c-green)' : undefined}
          />
          <StatCard label="Volume · 30d" value={consistency.volume30 >= 1000 ? `${(consistency.volume30 / 1000).toFixed(1)}t` : `${Math.round(consistency.volume30)}kg`} sub="lifted" />
          <StatCard label="Body weight" value={latestWeight !== null ? `${latestWeight.toFixed(1)}` : '—'} sub={weightDelta !== null ? `${weightDelta > 0 ? '+' : ''}${weightDelta.toFixed(1)}kg ${direction === 'gain' ? 'gained' : direction === 'lose' ? 'lost' : 'overall'}` : 'kg'} color={weightColor} />
          <StatCard label="Avg calories" value={nutrition.avgKcal ? nutrition.avgKcal.toLocaleString() : '—'} sub={nutrition.loggedDays ? `${nutrition.avgProtein}g protein/day` : 'no logs yet'} />
        </div>

        {/* Weekly volume */}
        {consistency.weeks.length > 0 && (
          <Card>
            <SectionLabel>Weekly volume</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
              {consistency.weeks.map(([wk, d]) => (
                <div key={wk} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ width: '100%', maxWidth: 26, height: `${Math.max(4, (d.volume / maxWeekVol) * 70)}px`, background: 'var(--c-accent)', borderRadius: 4, transition: 'height .4s ease' }} title={`${Math.round(d.volume)}kg · ${d.count} workout${d.count !== 1 ? 's' : ''}`} />
                  <div style={{ fontSize: 9, color: 'var(--c-label-faint)', whiteSpace: 'nowrap' }}>{fmtShort(wk)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 8 }}>{consistency.totalWorkouts} workouts logged · last 8 weeks shown</div>
          </Card>
        )}

        {/* Strength per exercise */}
        {strength.length > 0 && (
          <Card>
            <SectionLabel>Strength by exercise</SectionLabel>
            {strength.map((s, i) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < strength.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, color: 'var(--c-label)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>
                    {s.pr ? `PR ${s.pr.weight_kg}kg × ${s.pr.reps}` : `${s.sessions} session${s.sessions !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                    {s.latest.topWeight}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--c-label-faint)' }}>kg</span>
                  </div>
                  {s.trend !== 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: s.trend > 0 ? 'var(--c-green)' : 'var(--c-orange)' }}>
                      {s.trend > 0 ? '↑' : '↓'} {Math.abs(s.trend).toFixed(1)}kg
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}

        {/* Body weight trend */}
        <Card>
          <SectionLabel>Body-weight trend</SectionLabel>
          {weights.length >= 2 ? (
            <Suspense fallback={<div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--c-label-faint)' }}>…</div>}>
              <WeightTrendChart weights={weights} />
            </Suspense>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--c-label-faint)' }}>Log your weight a few times (Today → Weight tile) to see the trend.</div>
          )}
        </Card>

        {/* Nutrition trend */}
        <Card>
          <SectionLabel>Calories · last 14 days</SectionLabel>
          {food.some(d => d.logged) ? (
            <Suspense fallback={<div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--c-label-faint)' }}>…</div>}>
              <CalorieTrendChart history={food} goal={goals?.calories ?? 2200} days={14} />
            </Suspense>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--c-label-faint)' }}>No food logged yet.</div>
          )}
          {nutrition.loggedDays > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 8 }}>
              Avg {nutrition.avgKcal.toLocaleString()} kcal · {nutrition.avgProtein}g protein over {nutrition.loggedDays} logged day{nutrition.loggedDays !== 1 ? 's' : ''}
              {goals?.protein ? ` (goal ${goals.protein}g)` : ''}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
