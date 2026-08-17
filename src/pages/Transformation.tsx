import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { WorkoutData, PR, BodyMetric, UserProfile } from '../api/client'
import { showToast } from '../toast'
import { analyzeWeightTrend, type WeightEntry } from '../lib/calorie-target'
import { strengthTargetFor } from '../lib/strength-targets'
import { projectRoadmap, physiqueMilestones } from '../lib/transformation'
import { PROGRAM, ROTATION } from '../program'

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

function Bar({ pct, color = 'var(--c-accent)' }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 7, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, pct * 100))}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
    </div>
  )
}

// Month + year only — a weekly projection can't honestly pin a specific day.
function fmtMonthYear(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function Transformation() {
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [prs, setPRs] = useState<Record<string, PR>>({})
  const [metrics, setMetrics] = useState<BodyMetric[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  useEffect(() => {
    Promise.allSettled([
      api.getWeightLog(365),
      api.getWorkouts(60),
      api.getPRs(),
      api.getMetrics(365),
      api.getProfile(),
    ]).then(([w, wo, p, m, pr]) => {
      if (w.status === 'fulfilled') setWeights((w.value?.entries ?? []).map(e => ({ date: e.date, kg: e.kg })))
      if (wo.status === 'fulfilled') setWorkouts(wo.value ?? [])
      if (p.status === 'fulfilled') setPRs(p.value ?? {})
      if (m.status === 'fulfilled') setMetrics(m.value?.metrics ?? [])
      if (pr.status === 'fulfilled') setProfile(pr.value)
    }).finally(() => setLoading(false))
  }, [])

  const currentKg = weights.length ? weights[weights.length - 1].kg : null
  const startKg = weights.length ? weights[0].kg : currentKg
  const todayIso = new Date().toISOString().slice(0, 10)

  // The goal is REAL only once the user saves it to their profile. Until then we
  // show a "set your goal" prompt and never project against a guessed default —
  // no hardcoded number is ever presented as the user's data or auto-written to
  // their profile. The fallback below is only consumed by computations the
  // render gates behind `hasGoal`; anchoring it to current weight keeps any
  // stray value from being a fabricated target.
  const savedGoal = profile?.target_weight_kg ?? null
  const hasGoal = savedGoal != null
  const goalKg = savedGoal ?? (currentKg ?? 0)

  const trend = useMemo(() => analyzeWeightTrend(weights), [weights])
  const roadmap = currentKg != null
    ? projectRoadmap({
        currentKg, goalKg,
        weeklyChangeKg: trend?.reliable ? trend.weeklyChangeKg : null,
        reliable: !!trend?.reliable,
        todayIso,
      })
    : null

  // Latest body-fat reading, if any (drives the abs milestone honestly).
  const latestBodyFat = useMemo(() => {
    const withBf = metrics.filter(m => m.body_fat_pct != null)
    return withBf.length ? withBf[withBf.length - 1].body_fat_pct! : null
  }, [metrics])

  const milestones = (currentKg != null && startKg != null)
    ? physiqueMilestones({ startKg, currentKg, goalKg, bodyFatPct: latestBodyFat })
    : []

  // Current best working weight per exercise (newest session top set).
  const bestByExercise = useMemo(() => {
    const map: Record<string, number> = {}
    const newest = [...workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))
    for (const w of newest) {
      for (const ex of w.exercises) {
        const working = ex.sets.filter(s => !s.ramp && typeof s.weight_kg === 'number' && s.weight_kg! > 0)
        if (!working.length) continue
        const top = Math.max(...working.map(s => s.weight_kg!))
        if (map[ex.name] == null || top > map[ex.name]) map[ex.name] = top
      }
    }
    // Fold in PRs as a fallback for exercises not in the recent window.
    for (const [name, pr] of Object.entries(prs)) {
      if (map[name] == null && pr.weight_kg > 0) map[name] = pr.weight_kg
    }
    return map
  }, [workouts, prs])

  // Program exercises in rotation order, unique by name, with a goal target.
  const targets = useMemo(() => {
    const seen = new Set<string>()
    const rows: { name: string; day: string; currentBestKg?: number; target: ReturnType<typeof strengthTargetFor> }[] = []
    for (const day of ROTATION) {
      for (const ex of PROGRAM[day].exercises) {
        if (seen.has(ex.name)) continue
        seen.add(ex.name)
        const currentBestKg = bestByExercise[ex.name]
        const target = strengthTargetFor(ex.name, goalKg, { currentWeightKg: currentKg ?? undefined, currentBestKg })
        if (target) rows.push({ name: ex.name, day, currentBestKg, target })
      }
    }
    return rows
  }, [bestByExercise, goalKg, currentKg])

  async function saveGoal() {
    const kg = parseFloat(goalDraft)
    if (isNaN(kg) || kg < 30 || kg > 300) { showToast('Goal must be 30–300 kg', 'err'); return }
    setSavingGoal(true)
    try {
      await api.updateTdeeProfile({ target_weight_kg: kg })
      setProfile(p => (p ? { ...p, target_weight_kg: kg } : p))
      setEditingGoal(false)
      showToast(`Goal weight set to ${kg}kg`)
    } catch { showToast('Could not save goal', 'err') }
    finally { setSavingGoal(false) }
  }

  if (loading) {
    return (
      <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <span style={{ fontSize: 14, color: 'var(--c-label-faint)' }}>Loading your transformation…</span>
        </div>
      </div>
    )
  }

  const journeyPct = (currentKg != null && startKg != null && goalKg !== startKg)
    ? (currentKg - startKg) / (goalKg - startKg)
    : 0

  return (
    <div className="page" style={{ background: 'var(--c-bg)', color: 'var(--c-label)' }}>
      <div className="page-content">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 4 }}>Where you're headed</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Transformation</div>
        </div>

        {/* ── Goal + roadmap ── */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <SectionLabel>Goal weight</SectionLabel>
            <button onClick={() => { setEditingGoal(v => !v); setGoalDraft(String(goalKg)) }} style={{
              background: 'none', border: 'none', color: 'var(--c-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>{editingGoal ? 'Cancel' : 'Edit'}</button>
          </div>

          {editingGoal ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input className="input-field" style={{ flex: 1, padding: '10px 12px', fontSize: 16 }} type="number" step="0.5" inputMode="decimal" autoFocus value={goalDraft} onChange={e => setGoalDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveGoal()} />
              <button onClick={saveGoal} disabled={savingGoal} style={{ background: 'var(--c-accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                {savingGoal ? '…' : 'Save'}
              </button>
            </div>
          ) : hasGoal ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 34, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '-0.03em' }}>
                {currentKg != null ? currentKg.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 16, color: 'var(--c-label-dim)' }}>→ {goalKg}kg goal</span>
            </div>
          ) : (
            <button onClick={() => { setEditingGoal(true); setGoalDraft(currentKg != null ? String(Math.round(currentKg)) : '') }} style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              border: '1px solid var(--c-accent)', background: 'var(--c-card)', borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ fontSize: 14, color: 'var(--c-accent)', fontWeight: 700 }}>Set your goal weight</div>
              <div style={{ fontSize: 13, color: 'var(--c-label-dim)', marginTop: 3 }}>Your roadmap, targets and milestones build from it.</div>
            </button>
          )}

          {hasGoal && currentKg != null && (
            <>
              <Bar pct={Math.max(0, journeyPct)} color={journeyPct >= 1 ? 'var(--c-green)' : 'var(--c-accent)'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-label-faint)', marginTop: 6 }}>
                <span>start {startKg?.toFixed(1)}kg</span>
                <span>{roadmap && roadmap.direction !== 'maintain' ? `${roadmap.remainingKg.toFixed(1)}kg to go` : 'at goal'}</span>
                <span>{goalKg}kg</span>
              </div>
            </>
          )}

          {hasGoal && roadmap && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--c-border)', borderRadius: 10 }}>
              {roadmap.weeksToGoal != null && roadmap.etaIso ? (
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                  ~{roadmap.weeksToGoal} weeks · around {fmtMonthYear(roadmap.etaIso)}
                </div>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>You're at your goal weight 🎯</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--c-label-dim)', lineHeight: 1.5 }}>{roadmap.note}</div>
              <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 8 }}>
                {roadmap.rateSource === 'observed'
                  ? `Projected from your real ${roadmap.rateKgPerWeek.toFixed(2)} kg/wk trend.`
                  : 'Projected from a healthy default rate — log weight for ≥2 weeks to use your real pace.'}
              </div>
            </div>
          )}
          {hasGoal && currentKg == null && (
            <div style={{ fontSize: 13, color: 'var(--c-label-faint)' }}>Log your weight (Goals → Body Weight) to project a timeline.</div>
          )}
        </Card>

        {/* ── Physique milestones ── */}
        {hasGoal && milestones.length > 0 && (
          <Card>
            <SectionLabel>Physique milestones</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {milestones.map(m => {
                const reached = m.status === 'reached'
                const color = reached ? 'var(--c-green)' : m.status === 'needs-data' ? 'var(--c-label-faint)' : 'var(--c-accent)'
                return (
                  <div key={m.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: reached ? 'var(--c-green)' : 'var(--c-label)' }}>
                        {reached ? '✓ ' : ''}{m.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--c-label-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {m.anchor === 'weight' && m.targetWeightKg != null ? `~${m.targetWeightKg}kg` : m.status === 'needs-data' ? 'log body-fat' : `~${m.targetBodyFatPct}% BF`}
                      </span>
                    </div>
                    {/* A milestone beyond the current goal isn't an active
                        target — show a greyed stub (with its explaining note)
                        rather than a partial bar stuck "approaching" forever. */}
                    {m.progressPct != null && !m.beyondGoal ? <Bar pct={m.progressPct} color={color} /> : (
                      <div style={{ height: 7, background: 'var(--c-border)', borderRadius: 4, opacity: 0.5 }} />
                    )}
                    <div style={{ fontSize: 12, color: 'var(--c-label-dim)', lineHeight: 1.5, marginTop: 6 }}>{m.note}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 14, lineHeight: 1.5 }}>
              Estimates, not promises — everyone's different, and these are driven by muscle & body-fat, not the scale alone. Track them with monthly measurements on the Body page.
            </div>
          </Card>
        )}

        {/* ── Per-exercise targets ── */}
        {hasGoal && targets.length > 0 && (
          <Card>
            <SectionLabel>Strength targets at {goalKg}kg</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {targets.map(row => {
                const t = row.target!
                const hasData = t.progressPct != null
                const pct = t.progressPct ?? 0
                const done = pct >= 1
                return (
                  <div key={row.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                      <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', ui-monospace, monospace", flexShrink: 0, color: done ? 'var(--c-green)' : 'var(--c-label)' }}>
                        {row.currentBestKg != null ? `${row.currentBestKg}` : '—'}<span style={{ color: 'var(--c-label-faint)' }}> / {t.targetKg}kg</span>
                      </span>
                    </div>
                    {hasData
                      ? <Bar pct={pct} color={done ? 'var(--c-green)' : 'var(--c-accent)'} />
                      : <div style={{ height: 7, background: 'var(--c-border)', borderRadius: 4, opacity: 0.5 }} title="No sessions logged yet" />}
                    <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 5 }}>
                      {t.basis === 'bw-ratio' ? t.label : 'Keeps pace with your bodyweight'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 14, lineHeight: 1.5 }}>
              Compound targets are typical intermediate benchmarks for a {goalKg}kg lifter — machines vary, so treat them as a direction. Isolations scale from your own best.
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
