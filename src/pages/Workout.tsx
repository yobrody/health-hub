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
import {
  countCompletedSets,
  countTotalSets,
  describeNext,
  findNextIncompleteSet,
} from '../lib/workout-flow'

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
  // Focus-mode pointer + phase. While `live` is set, the screen shows ONE
  // exercise/set at a time (active or rest), not the previous all-stacked view.
  // Editing-mode (live.editingId) skips the rest phase entirely so the user
  // can free-navigate any set without a timer firing.
  const [focusExIdx, setFocusExIdx] = useState(0)
  const [focusSetIdx, setFocusSetIdx] = useState(0)
  const [phase, setPhase] = useState<'active' | 'rest' | 'done'>('active')
  const [showManage, setShowManage] = useState(false)
  const repsInputRef = useRef<HTMLInputElement>(null)
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
    // Always start a fresh workout at the very first set in active phase.
    setFocusExIdx(0)
    setFocusSetIdx(0)
    setPhase('active')
    setRestTimer(null)
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
    setFocusExIdx(0)
    setFocusSetIdx(0)
    setPhase('active')
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
    // Capture as a const so TypeScript narrows null inside nested closures
    // (submitCurrentSet, navTo) that the type system can't flow-track through.
    const liveNonNull = live
    const totalDone = countCompletedSets(liveNonNull.exercises)
    const totalCount = countTotalSets(liveNonNull.exercises)
    const isEditing = !!liveNonNull.editingId
    const focusEx = liveNonNull.exercises[focusExIdx]
    const focusSet = focusEx?.sets[focusSetIdx]
    const focusExPR = focusEx ? prs[focusEx.name] : undefined

    function endRest() {
      setRestTimer(null)
      setPhase('active')
      // Give iOS a moment to install the new keyboard before refocusing.
      setTimeout(() => repsInputRef.current?.focus(), 80)
    }

    // Submit the current set: mark done, advance to the next not-yet-done set
    // (auto-starting rest), or end the workout if nothing else remains. Used
    // by Enter on the reps input AND the big "Log set" button.
    function submitCurrentSet() {
      if (!focusEx || !focusSet) return
      // Refuse if reps is missing — weight may legitimately be 0 (bodyweight).
      if (!focusSet.reps || focusSet.reps <= 0) return
      const exIdx = focusExIdx
      const setIdx = focusSetIdx
      // Mark done in state. completeSet also auto-starts rest timer for the
      // exercise's restSeconds, which we want here.
      completeSet(exIdx, setIdx)
      // Advance the focus pointer. We compute on the just-completed snapshot —
      // findNextIncompleteSet starts at setIdx+1, so it ignores the set we
      // just marked done even though setLive hasn't flushed yet.
      const next = findNextIncompleteSet(liveNonNull.exercises, exIdx, setIdx)
      if (next) {
        setFocusExIdx(next.exerciseIdx)
        setFocusSetIdx(next.setIdx)
        setPhase('rest')
      } else {
        setRestTimer(null)
        setPhase('done')
      }
    }

    function navTo(direction: -1 | 1) {
      // Free navigation across all sets (used in editing mode + while the
      // user wants to go back and tweak a just-completed set).
      const target = direction > 0 ? focusSetIdx + 1 : focusSetIdx - 1
      if (direction > 0 && target < focusEx!.sets.length) {
        setFocusSetIdx(target)
      } else if (direction < 0 && target >= 0) {
        setFocusSetIdx(target)
      } else if (direction > 0 && focusExIdx + 1 < liveNonNull.exercises.length) {
        setFocusExIdx(focusExIdx + 1); setFocusSetIdx(0)
      } else if (direction < 0 && focusExIdx > 0) {
        const prevEx = liveNonNull.exercises[focusExIdx - 1]
        setFocusExIdx(focusExIdx - 1); setFocusSetIdx(Math.max(0, prevEx.sets.length - 1))
      }
      setPhase('active')
    }

    return (
      <div className="page" style={{ background: 'var(--bg)' }}>
        <div className="page-content">
          {/* Compact header — kept small so the focus card dominates the screen. */}
          <div style={{ background: 'var(--blue)', borderRadius: 14, padding: '10px 14px', marginBottom: 12, color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{live.title}</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>
                  <ElapsedTimer startTime={live.startTime} /> · {totalDone}/{totalCount} sets
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setShowManage(true)}
                  aria-label="Manage exercises"
                  style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 20, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer' }}
                >☰</button>
                {isEditing && (
                  <button
                    onClick={() => { setLive(null); setRestTimer(null); setPhase('active') }}
                    style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 20, padding: '0 12px', height: 36, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >Cancel</button>
                )}
                <button
                  onClick={finishWorkout}
                  disabled={finishing || live.exercises.length === 0 || (!isEditing && totalDone === 0)}
                  style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 20, padding: '0 14px', height: 36, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (finishing || live.exercises.length === 0 || (!isEditing && totalDone === 0)) ? 0.5 : 1 }}
                >{finishing ? '…' : (isEditing ? 'Save' : 'Finish')}</button>
              </div>
            </div>
            {!isEditing && (
              <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, opacity: 0.95 }}>
                {properlyEating
                  ? '🟢 Fueled — progressive overload active'
                  : '🟡 Holding weight — eat your protein for the next bump'}
              </div>
            )}
          </div>

          {/* ── ACTIVE SET CARD ── */}
          {phase === 'active' && focusEx && focusSet && (() => {
            const isThisSetDone = focusSet.done
            const restLabel = focusEx.restSeconds ? (focusEx.restSeconds >= 60 ? `${focusEx.restSeconds / 60} min` : `${focusEx.restSeconds}s`) : null
            return (
              <div className="card" style={{ padding: '20px 18px 22px', marginBottom: 12 }}>
                {/* Prev / Exercise / Next */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <button
                    onClick={() => navTo(-1)}
                    disabled={focusExIdx === 0 && focusSetIdx === 0}
                    aria-label="Previous set"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 8, color: (focusExIdx === 0 && focusSetIdx === 0) ? 'var(--label3)' : 'var(--label)' }}
                  >‹</button>
                  <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 21, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focusEx.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 600, marginTop: 2 }}>
                      Set {focusSetIdx + 1} of {focusEx.sets.length}
                      {focusEx.repRange && ` · ${focusEx.repRange} reps`}
                      {focusEx.rir && ` · ${focusEx.rir} RIR`}
                    </div>
                    {focusExPR && (
                      <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 2 }}>
                        Best: {focusExPR.weight_kg}kg × {focusExPR.reps}{restLabel ? ` · ${restLabel} rest` : ''}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => navTo(1)}
                    disabled={focusExIdx === live.exercises.length - 1 && focusSetIdx === focusEx.sets.length - 1}
                    aria-label="Next set"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 8, color: (focusExIdx === live.exercises.length - 1 && focusSetIdx === focusEx.sets.length - 1) ? 'var(--label3)' : 'var(--label)' }}
                  >›</button>
                </div>

                {focusEx.notes && <div style={{ fontSize: 12, color: 'var(--label3)', textAlign: 'center', marginTop: 2, marginBottom: 6 }}>{focusEx.notes}</div>}

                {/* Big inputs */}
                <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>WEIGHT (KG)</div>
                    <input
                      type="number" inputMode="decimal" placeholder="—"
                      style={{ width: '100%', background: 'var(--bg)', border: '1.5px solid var(--separator)', borderRadius: 14, padding: '14px 8px', fontSize: 30, fontWeight: 700, textAlign: 'center', color: 'var(--label)', outline: 'none' }}
                      value={focusSet.weight_kg ?? ''}
                      onChange={e => { const v = e.target.value; updateSet(focusExIdx, focusSetIdx, 'weight_kg', v === '' ? undefined : parseFloat(v)) }}
                    />
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>REPS</div>
                    <input
                      ref={repsInputRef}
                      type="number" inputMode="numeric" placeholder="—"
                      style={{ width: '100%', background: 'var(--bg)', border: '1.5px solid var(--blue)', borderRadius: 14, padding: '14px 8px', fontSize: 30, fontWeight: 700, textAlign: 'center', color: 'var(--label)', outline: 'none' }}
                      value={focusSet.reps ?? ''}
                      onChange={e => { const v = e.target.value; updateSet(focusExIdx, focusSetIdx, 'reps', v === '' ? undefined : parseInt(v)) }}
                      onKeyDown={e => { if (e.key === 'Enter' && !isThisSetDone) submitCurrentSet() }}
                      autoFocus={!isThisSetDone}
                    />
                  </div>
                </div>

                {/* Submit / Done indicator */}
                {isThisSetDone ? (
                  <div style={{ marginTop: 18, padding: '12px 14px', background: 'var(--green)', color: '#fff', borderRadius: 14, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>
                    ✓ Logged — tap › to advance
                  </div>
                ) : (
                  <button
                    onClick={submitCurrentSet}
                    disabled={!focusSet.reps || focusSet.reps <= 0}
                    style={{
                      width: '100%', marginTop: 18,
                      background: focusSet.reps ? 'var(--blue)' : 'var(--gray5)',
                      color: '#fff', border: 'none', borderRadius: 14, padding: '16px',
                      fontSize: 17, fontWeight: 700, cursor: focusSet.reps ? 'pointer' : 'default',
                    }}
                  >Log set ↵</button>
                )}

                {/* Compact set strip — small dots showing this exercise's set status */}
                {focusEx.sets.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14 }}>
                    {focusEx.sets.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => { setFocusSetIdx(i); setPhase('active') }}
                        style={{
                          width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer',
                          background: i === focusSetIdx ? 'var(--blue)' : s.done ? 'var(--green)' : 'var(--gray4)',
                        }}
                        aria-label={`Go to set ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── REST CARD ── */}
          {phase === 'rest' && (() => {
            const previewBase = (() => {
              // Show what the user is heading INTO. focusEx/focusSet point to
              // the next set already (we advanced before flipping to rest), so
              // describe relative to the set we just finished.
              const fromExIdx = focusSetIdx === 0 && focusExIdx > 0 ? focusExIdx - 1 : focusExIdx
              const fromSetIdx = focusSetIdx === 0 && focusExIdx > 0
                ? Math.max(0, (live.exercises[focusExIdx - 1]?.sets.length ?? 1) - 1)
                : Math.max(0, focusSetIdx - 1)
              return describeNext(live.exercises, { exerciseIdx: fromExIdx, setIdx: fromSetIdx })
            })()
            return (
              <div className="card" style={{ padding: '24px 20px 22px', marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label2)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>Rest</div>
                <RestTimer
                  key={`rest-${focusExIdx}-${focusSetIdx}-${restTimer?.seconds ?? 90}`}
                  seconds={restTimer?.seconds ?? focusEx?.restSeconds ?? 90}
                  onSkip={endRest}
                />
                <div style={{ marginTop: 14, fontSize: 14, color: 'var(--label2)' }}>
                  {previewBase.kind === 'next-set' && (
                    <>Next: <strong style={{ color: 'var(--label)' }}>Set {previewBase.setNumber} of {previewBase.exerciseName}</strong></>
                  )}
                  {previewBase.kind === 'next-exercise' && (
                    <>Next exercise: <strong style={{ color: 'var(--label)' }}>{previewBase.exerciseName}</strong> — Set 1 of {previewBase.totalSets}</>
                  )}
                  {previewBase.kind === 'workout-complete' && (
                    <strong style={{ color: 'var(--green)' }}>Workout complete</strong>
                  )}
                </div>
                <button
                  onClick={endRest}
                  style={{ marginTop: 16, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
                >Skip rest →</button>
              </div>
            )
          })()}

          {/* ── DONE CARD ── */}
          {phase === 'done' && (
            <div className="card" style={{ padding: '28px 20px', marginBottom: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Workout complete!</div>
              <div style={{ fontSize: 14, color: 'var(--label2)' }}>
                {totalDone}/{totalCount} sets · <ElapsedTimer startTime={live.startTime} />
              </div>
              <button
                onClick={finishWorkout}
                disabled={finishing}
                style={{ marginTop: 22, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 14, padding: '16px 24px', fontSize: 17, fontWeight: 700, cursor: 'pointer', width: '100%', opacity: finishing ? 0.5 : 1 }}
              >{finishing ? 'Saving…' : 'Save workout'}</button>
            </div>
          )}

          {/* ── EMPTY-WORKOUT FALLBACK ── */}
          {live.exercises.length === 0 && (
            <div className="card" style={{ padding: '28px 20px', marginBottom: 12, textAlign: 'center', color: 'var(--label2)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No exercises yet</div>
              <button
                onClick={() => setShowManage(true)}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >+ Add exercise</button>
            </div>
          )}
        </div>

        {/* ── MANAGE SHEET — reorder, add exercise, add set ── */}
        {showManage && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'flex-end' }}
            onClick={e => { if (e.target === e.currentTarget) { setShowManage(false); setShowExSearch(false); setExSearch('') } }}
          >
            <div style={{
              background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
              padding: '16px 20px calc(32px + var(--safe-bottom))',
              maxHeight: '88vh', overflowY: 'auto',
            }}>
              <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Exercises</div>
                <button onClick={() => { setShowManage(false); setShowExSearch(false); setExSearch('') }} className="sheet-close">×</button>
              </div>

              {live.exercises.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  {live.exercises.map((ex, exIdx) => (
                    <div key={exIdx} className="list-row" style={{ gap: 8, borderBottom: exIdx < live.exercises.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                      <button
                        onClick={() => { setFocusExIdx(exIdx); setFocusSetIdx(0); setPhase('active'); setShowManage(false) }}
                        style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: 'inherit', minWidth: 0 }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                          {ex.sets.filter(s => s.done).length}/{ex.sets.length} sets done
                        </div>
                      </button>
                      <button
                        onClick={() => addSet(exIdx)}
                        aria-label="Add set"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: 'var(--label)' }}
                      >+</button>
                      {live.exercises.length > 1 && (
                        <>
                          <button
                            onClick={() => moveExercise(exIdx, -1)}
                            disabled={exIdx === 0}
                            aria-label="Move up"
                            style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: exIdx === 0 ? 'default' : 'pointer', color: exIdx === 0 ? 'var(--label3)' : 'var(--label)' }}
                          >↑</button>
                          <button
                            onClick={() => moveExercise(exIdx, 1)}
                            disabled={exIdx === live.exercises.length - 1}
                            aria-label="Move down"
                            style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: exIdx === live.exercises.length - 1 ? 'default' : 'pointer', color: exIdx === live.exercises.length - 1 ? 'var(--label3)' : 'var(--label)' }}
                          >↓</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!showExSearch ? (
                <button
                  onClick={() => setShowExSearch(true)}
                  style={{ width: '100%', background: 'var(--blue)', border: 'none', borderRadius: 14, padding: '14px', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}
                >+ Add exercise</button>
              ) : (
                <div>
                  <input className="input-field" placeholder="Search exercises (e.g. bench press)" value={exSearch} onChange={e => setExSearch(e.target.value)} autoFocus style={{ marginBottom: 8 }} />
                  {exResults.length > 0 && (
                    <div className="card">
                      {exResults.map((r, i) => (
                        <button key={i} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => { addExercise(r); setShowManage(false); setShowExSearch(false); setExSearch('') }}>
                          <span style={{ fontSize: 15 }}>{r}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!exSearch && (
                    <div className="card">
                      <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick add</div>
                      {['Bench Press (Barbell)', 'Squat (Barbell)', 'Deadlift (Barbell)', 'Overhead Press (Barbell)', 'Pull-Up', 'Barbell Row', 'Dumbbell Curl', 'Tricep Pushdown'].map(ex => (
                        <button key={ex} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => { addExercise(ex); setShowManage(false); setShowExSearch(false); setExSearch('') }}>
                          <span style={{ fontSize: 15 }}>{ex}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowExSearch(false); setExSearch('') }} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 14, fontWeight: 500, padding: '14px 0', cursor: 'pointer' }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
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
