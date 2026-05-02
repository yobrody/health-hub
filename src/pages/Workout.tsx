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

// Exercise icon + gradient — keeps the active card visual without adding image
// assets. Matches by substring against the exercise name; falls back to a
// barbell. Add new entries here as your program adds new movements.
function getExerciseEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('bench') || n.includes('press') && n.includes('chest')) return '🏋️'
  if (n.includes('squat') || n.includes('leg press')) return '🦵'
  if (n.includes('deadlift') || n.includes('rdl')) return '🔱'
  if (n.includes('overhead') || n.includes('shoulder press') || n.includes('ohp')) return '💪'
  if (n.includes('pull') && (n.includes('up') || n.includes('-up'))) return '🤸'
  if (n.includes('row') || n.includes('lat pulldown')) return '🚣'
  if (n.includes('curl') || n.includes('bicep')) return '💪'
  if (n.includes('tricep') || n.includes('pushdown') || n.includes('dip')) return '✋'
  if (n.includes('press')) return '🏋️'
  if (n.includes('run') || n.includes('cardio') || n.includes('cycle')) return '🏃'
  if (n.includes('core') || n.includes('abs') || n.includes('plank')) return '🔥'
  return '🏋️'
}

function getExerciseGradient(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('squat') || n.includes('leg') || n.includes('deadlift')) {
    return 'linear-gradient(135deg, #34C759 0%, #30B0C7 100%)' // green → teal: legs
  }
  if (n.includes('bench') || n.includes('press') || n.includes('chest')) {
    return 'linear-gradient(135deg, #FF3B30 0%, #FF9500 100%)' // red → orange: push
  }
  if (n.includes('pull') || n.includes('row') || n.includes('lat')) {
    return 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)' // indigo → purple: pull
  }
  if (n.includes('curl') || n.includes('tricep') || n.includes('bicep')) {
    return 'linear-gradient(135deg, #FF9500 0%, #FFCC00 100%)' // orange → yellow: arms
  }
  if (n.includes('run') || n.includes('cardio') || n.includes('cycle')) {
    return 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)' // blue: cardio
  }
  return 'linear-gradient(135deg, #007AFF 0%, #AF52DE 100%)'
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

/**
 * Inline rest timer used by the focus-mode rest phase. Counts down + auto-fires
 * onComplete when remaining hits 0. Renders inline in its parent (no fixed
 * positioning), unlike the legacy floating RestTimer above. White-on-gradient
 * styling so it sits cleanly inside the rest card.
 */
function RestTimerInline({ seconds, onComplete }: { seconds: number; onComplete: () => void }) {
  const [remaining, setRemaining] = useState(seconds)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    if (remaining <= 0) { onCompleteRef.current(); return }
    if (remaining % 15 === 0 && remaining < seconds && navigator.vibrate) navigator.vibrate(30)
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining, seconds])

  useEffect(() => {
    if (remaining === 0 && navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200])
  }, [remaining])

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0')
  const secs = String(remaining % 60).padStart(2, '0')
  const pct = Math.max(0, remaining / seconds)
  return (
    <div>
      <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
        {mins}:{secs}
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 3, overflow: 'hidden', maxWidth: 240, margin: '14px auto 0' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: 'rgba(255,255,255,0.95)', borderRadius: 3, transition: 'width 1s linear' }} />
      </div>
    </div>
  )
}

/**
 * Hero card for the active phase — the only thing the user sees during a set.
 * Big gradient background, exercise emoji + name, reps input dominant,
 * weight as a tappable label that expands inline +/- controls.
 *
 * Submit gestures (both work, your pick):
 *   - Tap the big "Log set" button below the inputs
 *   - Swipe left across the card (gym-friendly when hands are full)
 */
function ActiveSetCard({
  gradient, emoji, exerciseName, setNumber, totalSets,
  weight, reps, isDone,
  onWeight, onReps, onSubmit, onSwipe, repsInputRef,
}: {
  gradient: string
  emoji: string
  exerciseName: string
  setNumber: number
  totalSets: number
  weight: number | undefined
  reps: number | undefined
  isDone: boolean
  onWeight: (v: number | undefined) => void
  onReps: (v: number | undefined) => void
  onSubmit: () => void
  onSwipe: (dx: number) => void
  repsInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [showWeightEdit, setShowWeightEdit] = useState(false)
  const swipeStartX = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)

  // Refocus reps on every set transition. autoFocus only fires on mount; using
  // a key on the parent forces remount, but the input ref needs an explicit
  // focus call so iOS shows the keyboard.
  useEffect(() => {
    if (!isDone) {
      // Slight delay lets iOS install the new keyboard cleanly.
      const t = setTimeout(() => repsInputRef.current?.focus(), 90)
      return () => clearTimeout(t)
    }
  }, [isDone, repsInputRef])

  function bumpWeight(delta: number) {
    const next = Math.max(0, Math.round(((weight ?? 0) + delta) * 4) / 4)
    onWeight(next)
  }

  return (
    <div
      onPointerDown={e => { swipeStartX.current = e.clientX; swipeStartY.current = e.clientY }}
      onPointerUp={e => {
        if (swipeStartX.current === null || swipeStartY.current === null) return
        const dx = e.clientX - swipeStartX.current
        const dy = e.clientY - swipeStartY.current
        // Only fire as a swipe if mostly horizontal — avoids triggering when
        // the user drags vertically while scrolling.
        if (Math.abs(dx) > 80 && Math.abs(dy) < 40) onSwipe(dx)
        swipeStartX.current = null; swipeStartY.current = null
      }}
      style={{
        background: gradient,
        borderRadius: 24,
        padding: '28px 22px 24px',
        marginTop: 8,
        color: '#fff',
        boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Hero — emoji + name + set N of M */}
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{
          fontSize: 56, lineHeight: 1, marginBottom: 10,
          filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.22))',
        }}>{emoji}</div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
          {exerciseName}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.92, marginTop: 4, letterSpacing: 0.5 }}>
          SET {setNumber} / {totalSets}
        </div>
      </div>

      {/* Weight pill — tap to expand +/- controls. Default shows the predicted
          value; user only interacts when they want to change. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
        {!showWeightEdit ? (
          <button
            onClick={() => setShowWeightEdit(true)}
            style={{
              background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 22,
              color: '#fff', padding: '10px 18px', fontSize: 16, fontWeight: 700,
              cursor: 'pointer', backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >{weight !== undefined ? `${weight}kg` : 'Set weight'} ▾</button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.95)', borderRadius: 22, padding: '4px 6px' }}>
            <button onClick={() => bumpWeight(-2.5)} style={{ background: 'none', border: 'none', fontSize: 18, fontWeight: 700, cursor: 'pointer', color: 'var(--label)', width: 36, height: 36, borderRadius: 18 }}>−2.5</button>
            <input
              type="number" inputMode="decimal"
              value={weight ?? ''}
              onChange={e => { const v = e.target.value; onWeight(v === '' ? undefined : parseFloat(v)) }}
              style={{ width: 80, background: 'none', border: 'none', outline: 'none', fontSize: 20, fontWeight: 800, textAlign: 'center', color: 'var(--label)' }}
              placeholder="kg"
            />
            <button onClick={() => bumpWeight(2.5)} style={{ background: 'none', border: 'none', fontSize: 18, fontWeight: 700, cursor: 'pointer', color: 'var(--label)', width: 36, height: 36, borderRadius: 18 }}>+2.5</button>
            <button onClick={() => setShowWeightEdit(false)} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 18, padding: '6px 12px', fontSize: 13, fontWeight: 700, marginLeft: 4, cursor: 'pointer' }}>Done</button>
          </div>
        )}
      </div>

      {/* The one input the user actually fills in */}
      <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 18, padding: '18px 16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--label3)', textAlign: 'center', letterSpacing: 1.5, marginBottom: 4 }}>REPS</div>
        <input
          ref={repsInputRef}
          type="number" inputMode="numeric"
          value={reps ?? ''}
          onChange={e => { const v = e.target.value; onReps(v === '' ? undefined : parseInt(v)) }}
          onKeyDown={e => { if (e.key === 'Enter' && !isDone) onSubmit() }}
          placeholder="—"
          style={{
            width: '100%', background: 'none', border: 'none', outline: 'none',
            fontSize: 56, fontWeight: 800, textAlign: 'center', color: 'var(--label)',
            letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums',
            padding: 0,
          }}
          disabled={isDone}
        />
      </div>

      {/* Big submit. Disabled until reps > 0; isDone path shows a green confirm. */}
      {isDone ? (
        <div style={{
          background: 'rgba(255,255,255,0.95)', color: 'var(--green)',
          borderRadius: 18, padding: '16px', textAlign: 'center', fontSize: 16, fontWeight: 800,
        }}>✓ Logged · resting next</div>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!reps || reps <= 0}
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.95)',
            color: !reps || reps <= 0 ? 'rgba(0,0,0,0.3)' : 'var(--label)',
            border: 'none', borderRadius: 18,
            padding: '18px',
            fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
            cursor: !reps || reps <= 0 ? 'default' : 'pointer',
            transition: 'opacity 0.2s',
          }}
        >Log set →</button>
      )}

      <div style={{ marginTop: 10, fontSize: 11, textAlign: 'center', opacity: 0.75, fontWeight: 500 }}>
        Tip: swipe left to log
      </div>
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

    // Note: free Prev/Next navigation removed from the active card per the
    // user's "no clutter" feedback. Set jumps now happen from the Manage sheet.

    return (
      <div
        className="page"
        style={{
          background: phase === 'active' && focusEx
            ? `radial-gradient(circle at top, ${getExerciseGradient(focusEx.name)} 0%, transparent 60%), var(--bg)`
            : 'var(--bg)',
          transition: 'background 0.5s',
        }}
      >
        <div className="page-content" style={{ paddingTop: 8 }}>
          {/* Minimal header — title + progress + Manage. Eating badge moved to
              the Manage sheet so it doesn't clutter the active view. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--label3)', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 1 }}>
                {liveNonNull.title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 500 }}>
                <ElapsedTimer startTime={liveNonNull.startTime} /> · {totalDone}/{totalCount} sets
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowManage(true)}
                aria-label="Manage exercises"
                style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, width: 36, height: 36, fontSize: 17, cursor: 'pointer', color: 'var(--label)' }}
              >☰</button>
              {isEditing && (
                <button
                  onClick={() => { setLive(null); setRestTimer(null); setPhase('active') }}
                  style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, padding: '0 14px', height: 36, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--label)' }}
                >Cancel</button>
              )}
              <button
                onClick={finishWorkout}
                disabled={finishing || liveNonNull.exercises.length === 0 || (!isEditing && totalDone === 0)}
                style={{ background: 'var(--blue)', border: 'none', borderRadius: 18, padding: '0 16px', height: 36, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (finishing || liveNonNull.exercises.length === 0 || (!isEditing && totalDone === 0)) ? 0.4 : 1 }}
              >{finishing ? '…' : (isEditing ? 'Save' : 'Finish')}</button>
            </div>
          </div>

          {/* ── ACTIVE: hero card with exercise visual + reps focus ── */}
          {phase === 'active' && focusEx && focusSet && (() => {
            const isThisSetDone = focusSet.done
            const gradient = getExerciseGradient(focusEx.name)
            const emoji = getExerciseEmoji(focusEx.name)
            const handleSwipe = (dx: number) => {
              if (dx < -80 && !isThisSetDone && (focusSet.reps ?? 0) > 0) {
                // Swipe left = log set (gym-friendly: thumb swipe across screen)
                submitCurrentSet()
              }
            }
            return (
              <ActiveSetCard
                key={`${focusExIdx}-${focusSetIdx}`}
                gradient={gradient}
                emoji={emoji}
                exerciseName={focusEx.name}
                setNumber={focusSetIdx + 1}
                totalSets={focusEx.sets.length}
                weight={focusSet.weight_kg}
                reps={focusSet.reps}
                isDone={isThisSetDone}
                onWeight={(v) => updateSet(focusExIdx, focusSetIdx, 'weight_kg', v)}
                onReps={(v) => updateSet(focusExIdx, focusSetIdx, 'reps', v)}
                onSubmit={submitCurrentSet}
                onSwipe={handleSwipe}
                repsInputRef={repsInputRef}
              />
            )
          })()}

          {/* ── REST: full-card timer with prominent Skip ── */}
          {phase === 'rest' && (() => {
            const fromExIdx = focusSetIdx === 0 && focusExIdx > 0 ? focusExIdx - 1 : focusExIdx
            const fromSetIdx = focusSetIdx === 0 && focusExIdx > 0
              ? Math.max(0, (liveNonNull.exercises[focusExIdx - 1]?.sets.length ?? 1) - 1)
              : Math.max(0, focusSetIdx - 1)
            const previewBase = describeNext(liveNonNull.exercises, { exerciseIdx: fromExIdx, setIdx: fromSetIdx })
            return (
              <div style={{
                background: focusEx ? `linear-gradient(135deg, ${getExerciseGradient(focusEx.name)})` : 'var(--blue)',
                borderRadius: 22,
                padding: '36px 24px 28px',
                marginTop: 8,
                color: '#fff',
                textAlign: 'center',
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.85, marginBottom: 10 }}>Rest</div>
                <RestTimerInline
                  key={`rest-${focusExIdx}-${focusSetIdx}-${restTimer?.seconds ?? 90}`}
                  seconds={restTimer?.seconds ?? focusEx?.restSeconds ?? 90}
                  onComplete={endRest}
                />
                <div style={{ marginTop: 14, fontSize: 15, opacity: 0.95 }}>
                  {previewBase.kind === 'next-set' && (
                    <>Next: <strong>Set {previewBase.setNumber} of {previewBase.exerciseName}</strong></>
                  )}
                  {previewBase.kind === 'next-exercise' && (
                    <>Next exercise: <strong>{previewBase.exerciseName}</strong> · Set 1 of {previewBase.totalSets}</>
                  )}
                  {previewBase.kind === 'workout-complete' && (
                    <strong>Workout complete</strong>
                  )}
                </div>
                <button
                  onClick={endRest}
                  style={{ marginTop: 22, background: 'rgba(255,255,255,0.95)', color: 'var(--label)', border: 'none', borderRadius: 16, padding: '14px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minWidth: 180 }}
                >Skip rest →</button>
              </div>
            )
          })()}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div style={{
              background: 'linear-gradient(135deg, #34C759 0%, #5AC8FA 100%)',
              borderRadius: 22,
              padding: '40px 24px',
              marginTop: 8,
              color: '#fff',
              textAlign: 'center',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}>
              <div style={{ fontSize: 64, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Workout complete</div>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                {totalDone}/{totalCount} sets · <ElapsedTimer startTime={liveNonNull.startTime} />
              </div>
              <button
                onClick={finishWorkout}
                disabled={finishing}
                style={{ marginTop: 24, background: 'rgba(255,255,255,0.95)', color: 'var(--label)', border: 'none', borderRadius: 16, padding: '14px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minWidth: 220, opacity: finishing ? 0.5 : 1 }}
              >{finishing ? 'Saving…' : 'Save workout'}</button>
            </div>
          )}

          {/* ── EMPTY workout fallback ── */}
          {liveNonNull.exercises.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 8 }}>🏋️</div>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 16, color: 'var(--label2)' }}>No exercises yet</div>
              <button
                onClick={() => setShowManage(true)}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >+ Add exercise</button>
            </div>
          )}
        </div>

        {/* ── MANAGE SHEET ── */}
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

              {!isEditing && (
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, padding: '8px 12px', borderRadius: 10, background: properlyEating ? 'rgba(52,199,89,0.12)' : 'rgba(255,149,0,0.12)', color: properlyEating ? 'var(--green)' : 'var(--orange)' }}>
                  {properlyEating
                    ? '🟢 Fueled — progressive overload active today'
                    : '🟡 Holding weight — eat your protein for the next bump'}
                </div>
              )}

              {liveNonNull.exercises.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  {liveNonNull.exercises.map((ex, exIdx) => (
                    <div key={exIdx} className="list-row" style={{ gap: 8, borderBottom: exIdx < liveNonNull.exercises.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                      <button
                        onClick={() => { setFocusExIdx(exIdx); setFocusSetIdx(0); setPhase('active'); setShowManage(false) }}
                        style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: 'inherit', minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}
                      >
                        <span style={{ fontSize: 22 }}>{getExerciseEmoji(ex.name)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                            {ex.sets.filter(s => s.done).length}/{ex.sets.length} sets done
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => addSet(exIdx)}
                        aria-label="Add set"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: 'var(--label)' }}
                      >+</button>
                      {liveNonNull.exercises.length > 1 && (
                        <>
                          <button
                            onClick={() => moveExercise(exIdx, -1)}
                            disabled={exIdx === 0}
                            aria-label="Move up"
                            style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: exIdx === 0 ? 'default' : 'pointer', color: exIdx === 0 ? 'var(--label3)' : 'var(--label)' }}
                          >↑</button>
                          <button
                            onClick={() => moveExercise(exIdx, 1)}
                            disabled={exIdx === liveNonNull.exercises.length - 1}
                            aria-label="Move down"
                            style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: exIdx === liveNonNull.exercises.length - 1 ? 'default' : 'pointer', color: exIdx === liveNonNull.exercises.length - 1 ? 'var(--label3)' : 'var(--label)' }}
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
