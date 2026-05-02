import { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../api/client'
import type { WorkoutData, ExerciseSet } from '../api/client'
import { showToast } from '../toast'
import { PROGRAM, ROTATION, getNextDay } from '../program'
import type { DayName, ProgramDay } from '../program'
import {
  isProperlyEating,
  predictNextWeight,
  type DailyTotals,
} from '../lib/workout-progression'

interface LiveSet extends ExerciseSet { done: boolean }
interface LiveExercise {
  name: string
  sets: LiveSet[]
  prevBest?: { weight_kg: number; reps: number }
  // Program guidance
  repRange?: string
  rir?: string
  restSeconds?: number
  notes?: string
}
interface LiveWorkout {
  title: string
  startTime: string
  exercises: LiveExercise[]
  // When set, finishing the workout PATCHes an existing record instead of
  // creating a new one. Allows editing finished workouts — open from the
  // recent list, change anything, save back to the same id.
  editingId?: string
  // Preserve the original end_time when editing so we don't bump the workout
  // forward in the timeline on every edit.
  editingEndTime?: string
}

function parseRepRange(repRange?: string): { min: number; max: number } | null {
  if (!repRange) return null
  const m = repRange.match(/(\d+)\s*-\s*(\d+)/)
  if (!m) return null
  return { min: parseInt(m[1]), max: parseInt(m[2]) }
}

function progressionHint(ex: LiveExercise): string | null {
  const doneSets = ex.sets.filter(s => s.done && s.weight_kg != null && s.reps != null)
  if (doneSets.length === 0) return null
  const rr = parseRepRange(ex.repRange)
  if (!rr) return null
  const allAtTop = doneSets.every(s => (s.reps ?? 0) >= rr.max)
  const allBelowMin = doneSets.every(s => (s.reps ?? 0) < rr.min)
  const currentWeight = doneSets[0]?.weight_kg ?? ex.prevBest?.weight_kg
  if (!currentWeight) return null

  if (allAtTop) {
    const bump = currentWeight >= 40 ? 2.5 : 1.25
    return `Next time: try +${bump}kg (${(currentWeight + bump).toFixed(2)}kg)`
  }
  if (allBelowMin) {
    return 'Keep weight steady and build reps first'
  }
  return 'Progressing well — add reps before weight'
}

function publishCoachFeed(live: LiveWorkout) {
  const doneSets = live.exercises.flatMap(ex => ex.sets.filter(s => s.done))
  const hardSets = doneSets.length
  const proteinTarget = Math.min(60, Math.max(20, Math.round(hardSets * 1.8)))
  const grocery = ['greek yogurt', 'eggs', 'chicken breast', 'bananas', 'oats']
  const payload = {
    date: new Date().toISOString(),
    title: live.title,
    hardSets,
    proteinTarget,
    grocery,
  }
  try { localStorage.setItem('coach_feed', JSON.stringify(payload)) } catch { /* ignore quota errors */ }
}

// Wger exercise search
async function searchExercises(query: string): Promise<string[]> {
  try {
    const url = `https://wger.de/api/v2/exercise/search/?term=${encodeURIComponent(query)}&language=english&format=json`
    const res = await fetch(url)
    const data = await res.json()
    return (data.suggestions ?? []).slice(0, 8).map((s: { value: string }) => s.value)
  } catch {
    return []
  }
}

function RestTimer({ seconds, onSkip }: { seconds: number; onSkip: () => void }) {
  const [remaining, setRemaining] = useState(seconds)
  const pct = remaining / seconds
  // onSkip is typically an inline arrow from the parent, so its identity changes every parent render.
  // Stash the latest in a ref so the tick effect doesn't restart the countdown on every re-render.
  const onSkipRef = useRef(onSkip)
  useEffect(() => { onSkipRef.current = onSkip }, [onSkip])

  useEffect(() => {
    if (remaining <= 0) { onSkipRef.current(); return }
    if (remaining % 15 === 0 && remaining < seconds && navigator.vibrate) navigator.vibrate(30)
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining, seconds])

  useEffect(() => {
    if (remaining === 0 && navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200])
  }, [remaining])

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0')
  const secs = String(remaining % 60).padStart(2, '0')

  return (
    <div style={{ position: 'fixed', bottom: 'calc(var(--tab-bar-height) + var(--safe-bottom))', left: 0, right: 0, zIndex: 50 }}>
      <div style={{ background: 'var(--card)', padding: '12px 20px 14px', borderTop: '0.5px solid var(--separator)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)' }}>Rest</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: remaining <= 10 ? 'var(--red)' : 'var(--label)', letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
            {mins}:{secs}
          </div>
          <button onClick={onSkip} style={{ background: 'none', border: '1.5px solid var(--blue)', borderRadius: 16, color: 'var(--blue)', fontSize: 14, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}>Skip</button>
        </div>
        <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: remaining <= 10 ? 'var(--red)' : 'var(--blue)', width: `${pct * 100}%`, borderRadius: 3, transition: 'width 1s linear, background 0.3s' }} />
        </div>
      </div>
    </div>
  )
}

function ElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [startTime])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{h > 0 ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
}

function SetRow({ set, idx, onUpdate, onDone, prevSets }: {
  set: LiveSet; idx: number
  onUpdate: (field: 'weight_kg' | 'reps', val: number | undefined) => void
  onDone: () => void
  prevSets: ExerciseSet[]
}) {
  const hasWeight = set.weight_kg !== undefined && set.weight_kg !== null && !isNaN(set.weight_kg)
  const hasReps = set.reps !== undefined && set.reps !== null && set.reps > 0
  const canComplete = hasReps && hasWeight

  const prevBest = prevSets[0]
  const isPR = set.done && hasWeight && hasReps &&
    (!prevBest?.weight_kg || (set.weight_kg ?? 0) > (prevBest.weight_kg ?? 0))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '0.5px solid var(--separator)', opacity: set.done ? 0.55 : 1, transition: 'opacity 0.3s' }}>
      <div style={{ width: 24, fontSize: 13, color: 'var(--label2)', fontWeight: 600, textAlign: 'center' }}>{idx + 1}</div>

      {prevSets[idx] && (
        <div style={{ width: 58, fontSize: 11, color: 'var(--label3)', textAlign: 'center', lineHeight: 1.2 }}>
          {prevSets[idx].weight_kg ?? 0}kg<br />×{prevSets[idx].reps}
        </div>
      )}

      <input
        type="number" inputMode="decimal" placeholder="kg"
        style={{ flex: 1, background: 'var(--bg)', border: 'none', borderRadius: 10, padding: '10px 8px', fontSize: 17, fontWeight: 600, textAlign: 'center', color: 'var(--label)', outline: 'none', minWidth: 0 }}
        value={set.weight_kg !== undefined ? set.weight_kg : ''}
        onChange={e => { const v = e.target.value; onUpdate('weight_kg', v === '' ? undefined : parseFloat(v)) }}
        disabled={set.done}
      />

      <input
        type="number" inputMode="numeric" placeholder="reps"
        style={{ flex: 1, background: 'var(--bg)', border: 'none', borderRadius: 10, padding: '10px 8px', fontSize: 17, fontWeight: 600, textAlign: 'center', color: 'var(--label)', outline: 'none', minWidth: 0 }}
        value={set.reps !== undefined ? set.reps : ''}
        onChange={e => { const v = e.target.value; onUpdate('reps', v === '' ? undefined : parseInt(v)) }}
        disabled={set.done}
      />

      <button
        onClick={onDone} disabled={set.done || !canComplete}
        style={{ width: 40, height: 40, borderRadius: 20, border: 'none', flexShrink: 0, background: set.done ? 'var(--green)' : canComplete ? 'var(--blue)' : 'var(--gray5)', cursor: set.done ? 'default' : canComplete ? 'pointer' : 'default', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: (set.done || canComplete) ? '#fff' : 'var(--label3)', transition: 'background 0.2s' }}
      >{set.done ? (isPR ? '🏆' : '✓') : '✓'}</button>
    </div>
  )
}

// Program day card for the idle screen
function DayCard({ day, isNext, onStart }: { day: ProgramDay; isNext: boolean; onStart: () => void }) {
  return (
    <div style={{
      background: isNext ? 'var(--blue)' : 'var(--card)',
      borderRadius: 16, padding: '16px 16px 12px',
      border: isNext ? 'none' : '1px solid var(--separator)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: isNext ? '#fff' : 'var(--label)' }}>{day.name}</div>
          <div style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.75)' : 'var(--label2)', marginTop: 2 }}>{day.focus}</div>
        </div>
        <button
          onClick={onStart}
          style={{
            background: isNext ? 'rgba(255,255,255,0.22)' : 'var(--blue)',
            color: '#fff', border: 'none', borderRadius: 20,
            padding: '8px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >{isNext ? 'Begin' : 'Start'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {day.exercises.slice(0, 4).map((ex, i) => (
          <div key={i} style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.8)' : 'var(--label2)' }}>
            {ex.sets}×{ex.repRange} {ex.name}
          </div>
        ))}
        {day.exercises.length > 4 && (
          <div style={{ fontSize: 12, color: isNext ? 'rgba(255,255,255,0.55)' : 'var(--label3)', marginTop: 2 }}>
            +{day.exercises.length - 4} more exercises
          </div>
        )}
      </div>
    </div>
  )
}

export default function Workout() {
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [prs, setPRs] = useState<Record<string, { weight_kg: number; reps: number; date: string }>>({})
  const [live, setLive] = useState<LiveWorkout | null>(null)
  const [restTimer, setRestTimer] = useState<{ seconds: number } | null>(null)
  const [exSearch, setExSearch] = useState('')
  const [exResults, setExResults] = useState<string[]>([])
  const [showExSearch, setShowExSearch] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [selectedDay, setSelectedDay] = useState<DayName | null>(null)
  // properlyEating gates the progressive-overload bump. Computed from the most
  // recent fully-logged day's calories + protein vs the user's goals.
  const [properlyEating, setProperlyEating] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    api.getWorkouts(20).then(setWorkouts)
    api.getPRs().then(setPRs)
    // Fetch nutrition signal for the predicted-weight rule. Failure is silent —
    // we just default to "not properly eating" and weight bumps are suppressed,
    // which is the safer fallback than over-predicting on missing data.
    Promise.all([api.getFoodHistory(7), api.getGoals()])
      .then(([history, goalsResp]) => {
        const totals: DailyTotals[] = (history ?? []).map(d => ({
          date: d.date,
          total_kcal: d.total_kcal,
          // Note: HistoryDay doesn't currently expose protein totals — when the
          // backend adds it, isProperlyEating will start gating on protein too.
          total_protein_g: undefined,
          logged: d.logged,
        }))
        setProperlyEating(isProperlyEating(totals, goalsResp.parsed))
      })
      .catch(() => setProperlyEating(false))
  }, [])

  // Last-session sets per exercise — the "did all reps hit?" signal for predictNextWeight.
  // Walks the workouts list newest-first and records the first occurrence of each exercise.
  const lastSetsByExercise = useMemo(() => {
    const map: Record<string, ExerciseSet[]> = {}
    const newestFirst = [...workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))
    for (const w of newestFirst) {
      for (const ex of w.exercises) {
        if (!(ex.name in map)) map[ex.name] = ex.sets
      }
    }
    return map
  }, [workouts])

  useEffect(() => {
    if (!exSearch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when query empties
      setExResults([])
      return
    }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      const results = await searchExercises(exSearch)
      setExResults(results)
    }, 300)
  }, [exSearch])

  const recentTitles = [...workouts].reverse().map(w => w.title)
  const nextDay = getNextDay(recentTitles)
  const displayDay = selectedDay ?? nextDay

  function startWorkout(day?: ProgramDay) {
    const hour = new Date().getHours()
    const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
    const title = day?.name ?? `${timeOfDay} Session`

    if (day) {
      const exercises: LiveExercise[] = day.exercises.map(ex => {
        const pr = prs[ex.name]
        const prevSets = lastSetsByExercise[ex.name]
        const predicted = predictNextWeight({
          prevBest: pr ? { weight_kg: pr.weight_kg, reps: pr.reps } : null,
          prevSets,
          repRange: ex.repRange,
          properlyEating,
        })
        const sets: LiveSet[] = Array.from({ length: ex.sets }, () => ({
          weight_kg: predicted.weight_kg,
          reps: predicted.reps,
          done: false,
        }))
        return { name: ex.name, sets, prevBest: pr, repRange: ex.repRange, rir: ex.rir, restSeconds: ex.restSeconds, notes: ex.notes }
      })
      setLive({ title, startTime: new Date().toISOString(), exercises })
    } else {
      setLive({ title, startTime: new Date().toISOString(), exercises: [] })
    }
    setSelectedDay(null)
    if (navigator.vibrate) navigator.vibrate(20)
  }

  function addExercise(name: string) {
    if (!live) return
    const pr = prs[name]
    const prevSets = lastSetsByExercise[name]
    const predicted = predictNextWeight({
      prevBest: pr ? { weight_kg: pr.weight_kg, reps: pr.reps } : null,
      prevSets,
      // Custom-added exercises don't carry program rep range — predictor falls back to baseline.
      properlyEating,
    })
    const defaultSets: LiveSet[] = [
      { weight_kg: predicted.weight_kg, reps: predicted.reps, done: false },
      { weight_kg: predicted.weight_kg, reps: predicted.reps, done: false },
      { weight_kg: predicted.weight_kg, reps: predicted.reps, done: false },
    ]
    setLive(w => w ? { ...w, exercises: [...w.exercises, { name, sets: defaultSets, prevBest: pr }] } : w)
    setExSearch('')
    setExResults([])
    setShowExSearch(false)
    if (navigator.vibrate) navigator.vibrate(10)
  }

  function updateSet(exIdx: number, setIdx: number, field: 'weight_kg' | 'reps', val: number | undefined) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], [field]: val }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
  }

  function completeSet(exIdx: number, setIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], done: true }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
    const restSecs = live?.exercises[exIdx]?.restSeconds ?? 90
    setRestTimer({ seconds: restSecs })
    if (navigator.vibrate) navigator.vibrate([10, 10, 30])
  }

  function addSet(exIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const lastSet = exercises[exIdx].sets.at(-1)
      exercises[exIdx] = { ...exercises[exIdx], sets: [...exercises[exIdx].sets, { weight_kg: lastSet?.weight_kg, reps: lastSet?.reps, done: false }] }
      return { ...w, exercises }
    })
  }

  function moveExercise(exIdx: number, direction: -1 | 1) {
    setLive(w => {
      if (!w) return w
      const target = exIdx + direction
      if (target < 0 || target >= w.exercises.length) return w
      const next = [...w.exercises]
      const [item] = next.splice(exIdx, 1)
      next.splice(target, 0, item)
      return { ...w, exercises: next }
    })
    if (navigator.vibrate) navigator.vibrate(8)
  }

  async function finishWorkout() {
    if (!live) return
    setFinishing(true)
    const endTime = live.editingEndTime ?? new Date().toISOString()
    const payload = {
      title: live.title,
      start_time: live.startTime,
      end_time: endTime,
      exercises: live.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.filter(s => s.done).map(s => {
          const { done, ...rest } = s
          void done
          return rest
        }),
      })),
    }
    if (live.editingId) {
      await api.updateWorkout(live.editingId, payload)
    } else {
      await api.saveWorkout(payload)
    }
    const [updated, updatedPRs] = await Promise.all([api.getWorkouts(20), api.getPRs()])
    setWorkouts(updated)
    setPRs(updatedPRs)
    if (!live.editingId) publishCoachFeed(live)
    setLive(null)
    setRestTimer(null)
    setFinishing(false)
    if (navigator.vibrate) navigator.vibrate([50, 50, 200])
    showToast(live.editingId ? 'Workout updated' : 'Workout saved')
  }

  function loadWorkoutForEdit(w: WorkoutData) {
    // Hydrate a saved workout back into the live editor. Sets are marked done
    // because they were completed; the user can untoggle to re-edit a set.
    const exercises: LiveExercise[] = w.exercises.map(ex => {
      const pr = prs[ex.name]
      const sets: LiveSet[] = ex.sets.map(s => ({ ...s, done: true }))
      return { name: ex.name, sets, prevBest: pr }
    })
    setLive({
      title: w.title,
      startTime: w.start_time,
      exercises,
      editingId: w.id,
      editingEndTime: w.end_time,
    })
    setRestTimer(null)
    if (navigator.vibrate) navigator.vibrate(15)
  }

  async function deleteWorkout(w: WorkoutData) {
    if (!confirm(`Delete "${w.title}" from ${new Date(w.start_time).toLocaleDateString()}?`)) return
    try {
      await api.deleteWorkout(w.id)
      const [updated, updatedPRs] = await Promise.all([api.getWorkouts(20), api.getPRs()])
      setWorkouts(updated)
      setPRs(updatedPRs)
      showToast('Workout deleted')
    } catch {
      showToast('Failed to delete workout', 'err')
    }
  }

  // ── LIVE WORKOUT VIEW ──────────────────────────────────────────
  if (live) {
    const totalSets = live.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0)
    const totalVolume = live.exercises.reduce((a, ex) =>
      a + ex.sets.filter(s => s.done && s.weight_kg !== undefined && s.reps)
        .reduce((b, s) => b + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0)

    return (
      <div className="page" style={{ background: 'var(--bg)' }}>
        <div className="page-content" style={{ paddingBottom: restTimer !== null ? 'calc(var(--tab-bar-height) + var(--safe-bottom) + 90px)' : undefined }}>
          {/* Live header */}
          <div style={{ background: 'var(--blue)', borderRadius: 16, padding: '14px 16px', marginBottom: 16, color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{live.title}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                  <ElapsedTimer startTime={live.startTime} /> · {totalSets} sets · {Math.round(totalVolume).toLocaleString()}kg vol
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {live.editingId && (
                  <button
                    onClick={() => { setLive(null); setRestTimer(null) }}
                    style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 20, padding: '8px 12px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >Cancel</button>
                )}
                <button
                  onClick={finishWorkout} disabled={finishing || live.exercises.length === 0}
                  style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 20, padding: '8px 16px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (finishing || live.exercises.length === 0) ? 0.5 : 1 }}
                >{finishing ? '…' : (live.editingId ? 'Save' : 'Finish')}</button>
              </div>
            </div>
            {/* Eating-status badge — tells the user whether the predicted-weight rule
                is bumping or holding today. Quiet when it's holding (red would feel
                punishing); celebratory when it's bumping. */}
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, opacity: 0.95 }}>
              {properlyEating
                ? '🟢 Fueled — progressive overload active'
                : '🟡 Holding weight — eat your protein for the next bump'}
            </div>
          </div>

          {/* Exercises */}
          {live.exercises.map((ex, exIdx) => {
            const exPR = prs[ex.name]
            const hasNewPR = ex.sets.some(s => s.done && s.weight_kg !== undefined && exPR && (s.weight_kg ?? 0) > exPR.weight_kg)
            const restLabel = ex.restSeconds ? (ex.restSeconds >= 60 ? `${ex.restSeconds / 60} min` : `${ex.restSeconds}s`) : null
            const hint = progressionHint(ex)

            return (
              <div key={exIdx} className="card" style={{ marginBottom: 12, padding: '0 16px' }}>
                <div style={{ padding: '14px 0 10px', borderBottom: '0.5px solid var(--separator)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>{ex.name}</div>
                      {/* Program targets */}
                      {ex.repRange && (
                        <div style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600, marginTop: 3 }}>
                          {ex.sets.length} sets · {ex.repRange} reps · {ex.rir} RIR{restLabel ? ` · ${restLabel} rest` : ''}
                        </div>
                      )}
                      {ex.notes && <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 2 }}>{ex.notes}</div>}
                      {exPR && <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 2 }}>Best: {exPR.weight_kg}kg × {exPR.reps}</div>}
                      {hint && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2, fontWeight: 600 }}>{hint}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      {hasNewPR && <span className="badge badge-gold">🏆 PR!</span>}
                      {/* Reorder controls — mobile-bulletproof tap targets. Hidden when there's
                          only one exercise so the card stays clean. */}
                      {live.exercises.length > 1 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => moveExercise(exIdx, -1)}
                            disabled={exIdx === 0}
                            aria-label="Move up"
                            style={{
                              width: 32, height: 32, borderRadius: 8, border: 'none',
                              background: 'var(--gray6)', color: exIdx === 0 ? 'var(--label3)' : 'var(--label)',
                              cursor: exIdx === 0 ? 'default' : 'pointer', fontSize: 16, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >↑</button>
                          <button
                            onClick={() => moveExercise(exIdx, 1)}
                            disabled={exIdx === live.exercises.length - 1}
                            aria-label="Move down"
                            style={{
                              width: 32, height: 32, borderRadius: 8, border: 'none',
                              background: 'var(--gray6)',
                              color: exIdx === live.exercises.length - 1 ? 'var(--label3)' : 'var(--label)',
                              cursor: exIdx === live.exercises.length - 1 ? 'default' : 'pointer',
                              fontSize: 16, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >↓</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '4px 0 8px' }}>
                  {/* Column headers */}
                  <div style={{ display: 'flex', gap: 8, padding: '6px 0 4px' }}>
                    <div style={{ width: 24 }} />
                    {exPR && <div style={{ width: 58, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>prev</div>}
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>kg</div>
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>reps</div>
                    <div style={{ width: 40 }} />
                  </div>
                  {ex.sets.map((set, setIdx) => (
                    <SetRow
                      key={setIdx} set={set} idx={setIdx}
                      prevSets={exPR ? [{ weight_kg: exPR.weight_kg, reps: exPR.reps }] : []}
                      onUpdate={(f, v) => updateSet(exIdx, setIdx, f, v)}
                      onDone={() => completeSet(exIdx, setIdx)}
                    />
                  ))}
                </div>

                <button
                  onClick={() => addSet(exIdx)}
                  style={{ width: '100%', background: 'none', border: '1.5px dashed var(--gray4)', borderRadius: 10, padding: '10px', color: 'var(--label2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
                >+ Add Set</button>
              </div>
            )
          })}

          {/* Add exercise */}
          <div className="card" style={{ overflow: 'visible', marginBottom: 8 }}>
            {!showExSearch ? (
              <button
                onClick={() => setShowExSearch(true)}
                style={{ width: '100%', background: 'none', border: 'none', padding: '16px', color: 'var(--blue)', fontSize: 17, fontWeight: 600, cursor: 'pointer' }}
              >+ Add Exercise</button>
            ) : (
              <div style={{ padding: 12 }}>
                <input className="input-field" placeholder="Search exercises (e.g. bench press)" value={exSearch} onChange={e => setExSearch(e.target.value)} autoFocus />
                {exResults.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {exResults.map((r, i) => (
                      <button key={i} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 10 }} onClick={() => addExercise(r)}>
                        <span style={{ fontSize: 15 }}>{r}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!exSearch && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '6px 4px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick add</div>
                    {['Bench Press (Barbell)', 'Squat (Barbell)', 'Deadlift (Barbell)', 'Overhead Press (Barbell)', 'Pull-Up', 'Barbell Row', 'Dumbbell Curl', 'Tricep Pushdown'].map(ex => (
                      <button key={ex} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => addExercise(ex)}>
                        <span style={{ fontSize: 15 }}>{ex}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setShowExSearch(false); setExSearch('') }} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 14, fontWeight: 500, padding: '10px 0', cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {restTimer !== null && (
          <RestTimer key={restTimer.seconds + live.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0)} seconds={restTimer.seconds} onSkip={() => setRestTimer(null)} />
        )}
      </div>
    )
  }

  // ── IDLE VIEW ──────────────────────────────────────────────────
  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 16 }}>Workout</div>

        {/* Next up — big card */}
        <div className="section-label" style={{ marginTop: 0 }}>Next up</div>
        <DayCard day={PROGRAM[displayDay]} isNext={true} onStart={() => startWorkout(PROGRAM[displayDay])} />

        {/* Day picker */}
        <div style={{ display: 'flex', gap: 8, margin: '12px 0 4px' }}>
          {ROTATION.map(day => (
            <button
              key={day}
              onClick={() => setSelectedDay(day === selectedDay ? null : day)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: displayDay === day ? 'var(--blue)' : 'var(--card)',
                color: displayDay === day ? '#fff' : 'var(--label2)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >{day}</button>
          ))}
        </div>

        {/* Other days preview (if not default) */}
        {selectedDay && selectedDay !== nextDay && (
          <div style={{ marginBottom: 4 }} />
        )}

        {/* Custom workout */}
        <button
          onClick={() => startWorkout()}
          style={{ width: '100%', background: 'none', border: '1.5px dashed var(--gray4)', borderRadius: 14, padding: '13px', color: 'var(--label2)', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 12, marginBottom: 8 }}
        >+ Custom Workout</button>

        {/* PRs */}
        {Object.keys(prs).length > 0 && (
          <>
            <div className="section-label">Personal Records</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {Object.entries(prs).slice(0, 6).map(([ex, pr]) => (
                <div key={ex} style={{ background: 'var(--card)', borderRadius: 12, padding: '10px 14px', minWidth: 140, flex: '1 1 140px' }}>
                  <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{ex}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{pr.weight_kg}kg <span style={{ fontSize: 14, fontWeight: 400 }}>× {pr.reps}</span></div>
                  <div className="badge badge-gold" style={{ marginTop: 4 }}>🏆 PR</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Recent workouts */}
        {workouts.length > 0 && (
          <>
            <div className="section-label">Recent</div>
            <div className="card">
              {[...workouts].reverse().slice(0, 5).map((w, i) => {
                const start = new Date(w.start_time)
                const end = new Date(w.end_time)
                const mins = Math.round((end.getTime() - start.getTime()) / 60000)
                const vol = w.exercises.reduce((a, ex) => a + ex.sets.reduce((b, s) => b + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0)
                const isProgramDay = ROTATION.includes(w.title as DayName)
                return (
                  <div key={w.id || i} className="list-row" style={{ gap: 10 }}>
                    <button
                      onClick={() => loadWorkoutForEdit(w)}
                      style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: 'inherit' }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {w.title}
                        {isProgramDay && <span className="badge badge-blue" style={{ fontSize: 10 }}>{(PROGRAM as Record<string, ProgramDay>)[w.title]?.focus}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
                        {start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {mins} min
                      </div>
                    </button>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{w.exercises.length} exercises</div>
                      <div style={{ fontSize: 12, color: 'var(--label2)' }}>{Math.round(vol).toLocaleString()}kg vol</div>
                    </div>
                    <button
                      onClick={() => deleteWorkout(w)}
                      aria-label="Delete workout"
                      style={{ background: 'none', border: 'none', color: 'var(--label3)', cursor: 'pointer', padding: '4px 6px', fontSize: 18, borderRadius: 8, flexShrink: 0 }}
                    >×</button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {workouts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 24px', color: 'var(--label2)' }}>
            <div style={{ fontSize: 14 }}>Tap Begin above to start your first session</div>
          </div>
        )}
      </div>
    </div>
  )
}
