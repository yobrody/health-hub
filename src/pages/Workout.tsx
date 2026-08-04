import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { api } from '../api/client'
import type { WorkoutData, ExerciseSet, ParsedRoutine } from '../api/client'
import { showToast } from '../toast'
import { GymChatSheet } from '../components/GymChatSheet'
import { PROGRAM, ROTATION, getNextDay, rirFor, seedLabel, RAMP_UP_SETS } from '../program'
import type { DayName, ProgramDay, ExerciseSwap } from '../program'
import type { ParsedSession } from '../api/client'
import {
  isProperlyEating,
  predictNextWeight,
  parseRepRange,
  type DailyTotals,
} from '../lib/workout-progression'
import { decideNextSet, type DecisionResult } from '../lib/gym-decision'
import {
  countCompletedSets,
  countTotalSets,
  describeNext,
  findNextIncompleteSet,
  findFirstIncompleteSet,
} from '../lib/workout-flow'
import { genericIncrement, learnFromLogs, resolveEquipment, nextUpWeight, nextDownWeight, snapToStack } from '../lib/gym-equipment'
import { diagnoseProgress, type WeighIn, type LiftTrend } from '../lib/progress-diagnosis'
import { useWakeLock } from '../lib/useWakeLock'
import { analyzeWorkout, type WorkoutAnalysis } from '../lib/gym-analysis'
import { weeklyVolumeByMuscle, type MuscleVolume } from '../lib/gym-muscles'
import { PostWorkoutSheet } from '../components/PostWorkoutSheet'
import { Section, SectionRow } from '../components/Section'
import { searchExerciseDB, getExercisesByGroup, findExercise } from '../lib/exercises'
import type { MuscleGroup } from '../lib/exercises'

interface LiveSet extends ExerciseSet { done: boolean; rir?: number; drop?: boolean; target?: number }

// Effort tiers the user taps during rest → reps-in-reserve. Beginner-friendly:
// they report how it FELT, not what's "correct".
const TIER_RIR: Record<'easy' | 'good' | 'hard' | 'fail', number> = { easy: 4, good: 2, hard: 1, fail: 0 }
const TIER_LABEL: Array<['easy' | 'good' | 'hard' | 'fail', string]> = [
  ['easy', 'Too easy'], ['good', 'Just right'], ['hard', 'Hard'], ['fail', "Couldn't finish"],
]
// Consequence colours: blue = no change, green = on track, amber/red = backing off.
const TIER_DOT: Record<'easy' | 'good' | 'hard' | 'fail', string> = {
  easy: 'var(--blue)', good: 'var(--green)', hard: 'var(--orange)', fail: 'var(--red)',
}

interface LiveExercise {
  name: string
  sets: LiveSet[]
  prevBest?: { weight_kg: number; reps: number }
  // Program guidance
  repRange?: string
  rir?: string
  restSeconds?: number
  notes?: string
  /** Curated same-muscle alternatives from the program, each with its own
   * starting load. Surfaced when the machine is occupied. */
  swaps?: ExerciseSwap[]
  /** Why the engine chose this weight. Shown on the card - the number is
   * useless if you cannot see the reasoning behind it. */
  reason?: string
  /** Real adjacent notches on this machine, so +/- cannot land on a weight
   * that does not physically exist. */
  stackUp?: number
  stackDown?: number
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

// Subtle muscle-group accent. One desaturated colour per group, no rainbow
// gradients. Used as a thin top-stripe on the active card, not as a full
// background — the gym view should feel calm, not a workout app from 2014.
function getExerciseAccent(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('squat') || n.includes('leg') || n.includes('deadlift') || n.includes('rdl')) return '#5B7C99' // legs — slate blue
  if (n.includes('bench') || n.includes('chest') || (n.includes('press') && !n.includes('overhead') && !n.includes('shoulder') && !n.includes('leg'))) return '#8C5A5A' // push — muted brick
  if (n.includes('overhead') || n.includes('shoulder') || n.includes('ohp')) return '#7A6E8A' // shoulders — muted plum
  if (n.includes('pull') || n.includes('row') || n.includes('lat')) return '#5C7A6F' // pull — sage
  if (n.includes('curl') || n.includes('tricep') || n.includes('bicep') || n.includes('pushdown')) return '#8A7A55' // arms — bronze
  if (n.includes('run') || n.includes('cardio') || n.includes('cycle')) return '#5A7A8A' // cardio — steel
  if (n.includes('core') || n.includes('abs') || n.includes('plank')) return '#7A5A6E' // core — dusty rose
  return '#5E6877' // neutral graphite
}

// Cardio moves are logged by effort/time, not load — so the active card must
// not prompt for a weight (treadmill "asks for weight" was the bug). Word-
// bounded so it never catches strength lifts like "seated row" or "incline press".
function isCardio(name: string): boolean {
  const n = name.toLowerCase()
  return /\b(treadmill|walk|walking|jog|jogging|run|running|sprint|cycle|cycling|elliptical|cross.?trainer|stair|stairmaster|rowing machine|row erg|erg|cardio|bike|spin)\b/.test(n)
}

// Local exercise DB search + fallback to wger API for custom exercises
function searchExercisesLocal(query: string): string[] {
  const results = searchExerciseDB(query)
  return results.slice(0, 10).map(e => e.name)
}

async function searchExercisesRemote(query: string): Promise<string[]> {
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
  // Deadline-based, NOT a decrementing counter. Browsers throttle timers hard
  // in a backgrounded PWA and all but stop them when the screen is off, so
  // subtracting 1 per tick loses real time: pocket the phone for 90s and a
  // naive timer still shows a minute left. Wall-clock arithmetic is immune,
  // and visibilitychange re-syncs the moment you look at it.
  // Set in the [seconds] effect below - calling Date.now() during render is impure.
  const deadlineRef = useRef(0)
  const [remaining, setRemaining] = useState(seconds)
  const onCompleteRef = useRef(onComplete)
  const firedRef = useRef(false)
  const lastBuzzRef = useRef<number | null>(null)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    deadlineRef.current = Date.now() + seconds * 1000
    firedRef.current = false
    lastBuzzRef.current = null
  }, [seconds])

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, (deadlineRef.current - Date.now()) / 1000)
      setRemaining(left)
      const bucket = Math.ceil(left)
      if (left > 0 && bucket % 15 === 0 && bucket < seconds && bucket !== lastBuzzRef.current) {
        lastBuzzRef.current = bucket
        if (navigator.vibrate) navigator.vibrate(30)
      }
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200])
        onCompleteRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 200)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [seconds])
  const displaySecs = Math.ceil(remaining)
  const mins = String(Math.floor(displaySecs / 60)).padStart(2, '0')
  const secs = String(displaySecs % 60).padStart(2, '0')
  const pct = Math.max(0, remaining / seconds)
  // Color shifts: blue -> orange at 3s -> red at 1s
  const timerColor = remaining <= 1 ? 'var(--red, #FF3B30)' : remaining <= 3 ? 'var(--orange, #FF9500)' : 'var(--label)'
  const barColor = remaining <= 1 ? 'var(--red, #FF3B30)' : remaining <= 3 ? 'var(--orange, #FF9500)' : 'var(--blue)'
  return (
    <div>
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, color: timerColor, transition: 'color 0.3s' }}>
        {mins}:{secs}
      </div>
      <div style={{ height: 4, background: 'var(--gray5)', borderRadius: 2, overflow: 'hidden', maxWidth: 220, margin: '12px auto 0' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 2, transition: remaining <= 3 ? 'width 0.1s linear, background 0.3s' : 'width 1s linear, background 0.3s' }} />
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
  accent, exerciseName, setNumber, totalSets,
  weight, reps, isDone,
  onWeight, onReps, onSubmit, onSwipe, onUncomplete, repsInputRef, reason, stackUp, stackDown, isRamp,
}: {
  accent: string
  exerciseName: string
  setNumber: number
  totalSets: number
  weight: number | undefined
  reps: number | undefined
  isDone: boolean
  reason?: string
  isRamp?: boolean
  stackUp?: number
  stackDown?: number
  onWeight: (v: number | undefined) => void
  onReps: (v: number | undefined) => void
  onSubmit: () => void
  onSwipe: (dx: number) => void
  onUncomplete?: () => void
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

  // Step to the next weight that actually exists on this machine. Falls back
  // to a generic increment only when the catalog has nothing to say.
  function stepWeight(dir: -1 | 1) {
    if (dir > 0 && stackUp !== undefined) { onWeight(stackUp); return }
    if (dir < 0 && stackDown !== undefined) { onWeight(stackDown); return }
    const inc = (weight ?? 0) >= 40 ? 2.5 : 1.25
    onWeight(Math.max(0, Math.round(((weight ?? 0) + dir * inc) * 4) / 4))
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
        background: 'var(--card)',
        borderRadius: 22,
        padding: '0',
        marginTop: 8,
        color: 'var(--label)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.06), 0 0 0 1px var(--separator)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle accent strip — the only colour cue. Replaces the previous
          full-card vivid gradient. */}
      <div style={{ height: 4, background: accent, opacity: 0.85 }} />
      <div style={{ padding: '22px 22px 20px' }}>
      {/* Header — exercise name + set marker. No emoji. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {exerciseName}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', letterSpacing: 0.7, flexShrink: 0 }}>
          {setNumber} / {totalSets}
        </div>
      </div>

      {isRamp && (
        <div style={{ border: '1px dashed var(--separator)', borderRadius: 18, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)', lineHeight: 1.2 }}>Warm-up set</div>
          <div style={{ fontSize: 13, color: 'var(--label3)', marginTop: 3 }}>Doesn&rsquo;t count toward progress</div>
        </div>
      )}
      {/* Weight pill — tap to expand +/- controls. Calm chips, no glass blur.
          Hidden for cardio (treadmill/walk/run…), which isn't a loaded lift. */}
      {!isCardio(exerciseName) && (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 18 }}>
        {!showWeightEdit ? (
          <button
            onClick={() => setShowWeightEdit(true)}
            style={{
              background: 'var(--gray6)', border: '1px solid var(--separator)', borderRadius: 22,
              color: 'var(--label)', padding: '9px 18px', fontSize: 15, fontWeight: 600,
              cursor: 'pointer',
            }}
          >{weight !== undefined ? `${weight}kg` : 'Set weight'} ▾</button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--gray6)', border: '1px solid var(--separator)', borderRadius: 22, padding: '4px 6px' }}>
            <button onClick={() => stepWeight(-1)} style={{ background: 'none', border: 'none', fontSize: 16, fontWeight: 600, cursor: 'pointer', color: 'var(--label)', width: 40, height: 32, borderRadius: 16 }} aria-label="Lighter">&minus;</button>
            <input
              type="number" inputMode="decimal"
              value={weight ?? ''}
              onChange={e => { const v = e.target.value; onWeight(v === '' ? undefined : parseFloat(v)) }}
              style={{ width: 70, background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 14, outline: 'none', fontSize: 18, fontWeight: 700, textAlign: 'center', color: 'var(--label)', height: 32 }}
              placeholder="kg"
            />
            <button onClick={() => stepWeight(1)} style={{ background: 'none', border: 'none', fontSize: 16, fontWeight: 600, cursor: 'pointer', color: 'var(--label)', width: 40, height: 32, borderRadius: 16 }} aria-label="Heavier">+</button>
            <button onClick={() => setShowWeightEdit(false)} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 13, fontWeight: 600, marginLeft: 2, cursor: 'pointer', height: 32 }}>Done</button>
          </div>
        )}
        {!isDone && !isRamp && stackUp !== undefined && weight !== undefined && stackUp !== weight && (
          <div style={{ fontSize: 12, color: 'var(--label3)' }}>next notch {stackUp}kg</div>
        )}
      </div>
      )}

      {reason && !isDone && (
        <div style={{ fontSize: 16, color: 'var(--label)', lineHeight: 1.4, margin: '-2px 0 16px', textWrap: 'pretty' } as React.CSSProperties}>
          {reason}
        </div>
      )}
      {/* The one input the user actually fills in. Big numerals, on-card. */}
      <div style={{ background: 'var(--gray6)', borderRadius: 16, padding: '16px 14px 18px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--label2)', textAlign: 'center', letterSpacing: 1.5, marginBottom: 2 }}>REPS</div>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{
            flex: 1, background: 'rgba(52,199,89,0.12)', color: 'var(--green)',
            borderRadius: 16, padding: '14px', textAlign: 'center', fontSize: 15, fontWeight: 700,
          }}>Logged</div>
          {onUncomplete && (
            <button
              onClick={onUncomplete}
              style={{ background: 'var(--gray6)', border: '1px solid var(--separator)', borderRadius: 16, padding: '0 16px', fontSize: 14, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
            >Edit set</button>
          )}
        </div>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!reps || reps <= 0}
          style={{
            width: '100%',
            background: !reps || reps <= 0 ? 'var(--gray5)' : 'var(--blue)',
            color: !reps || reps <= 0 ? 'var(--label3)' : '#fff',
            border: 'none', borderRadius: 14,
            padding: '15px',
            fontSize: 16, fontWeight: 700, letterSpacing: 0.2,
            cursor: !reps || reps <= 0 ? 'default' : 'pointer',
            transition: 'background 0.15s',
          }}
        >Log set</button>
      )}
      </div>
    </div>
  )
}

// 8-week consistency calendar. Cells = days, blue if a workout fell on that day.
// Most-recent week is on the right; days are M T W T F S S top-to-bottom on each
// column. Tap a cell to see what was done.
function ConsistencyCalendar({ workouts }: { workouts: WorkoutData[] }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weeks = 8
  // Map ISO date → workout, newest wins on duplicates
  const byDate = new Map<string, WorkoutData>()
  for (const w of workouts) {
    const k = w.start_time.slice(0, 10)
    byDate.set(k, w)
  }

  // Build columns oldest → newest. Each column is a week starting Monday.
  const dayOfWeek = (today.getDay() + 6) % 7 // 0 = Mon
  const startOfThisWeek = new Date(today)
  startOfThisWeek.setDate(today.getDate() - dayOfWeek)

  const cols: { date: Date; iso: string; workout?: WorkoutData; future: boolean }[][] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = new Date(startOfThisWeek)
    monday.setDate(startOfThisWeek.getDate() - 7 * w)
    const col: typeof cols[number] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday)
      date.setDate(monday.getDate() + d)
      const iso = date.toISOString().slice(0, 10)
      col.push({ date, iso, workout: byDate.get(iso), future: date > today })
    }
    cols.push(col)
  }

  const totalSessions = workouts.filter(w => {
    const d = new Date(w.start_time)
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - weeks * 7)
    return d >= cutoff
  }).length

  // Current streak — consecutive weeks with ≥1 workout, walking back from this week.
  let streak = 0
  for (let w = 0; w < weeks; w++) {
    const monday = new Date(startOfThisWeek)
    monday.setDate(startOfThisWeek.getDate() - 7 * w)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const has = workouts.some(wk => {
      const d = new Date(wk.start_time)
      return d >= monday && d <= sunday
    })
    if (has) streak++
    else if (w > 0) break
    else break // current week empty → streak 0
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-label" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
        <span>Consistency</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label2)', textTransform: 'none', letterSpacing: 0 }}>
          {totalSessions} session{totalSessions === 1 ? '' : 's'} · last {weeks} weeks{streak > 0 && ` · ${streak}wk streak`}
        </span>
      </div>
      <div className="card" style={{ padding: '14px 12px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Day-of-week labels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 9, color: 'var(--label3)', fontWeight: 600 }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} style={{ height: 13, display: 'flex', alignItems: 'center' }}>{d}</div>
            ))}
          </div>
          {/* Week columns */}
          <div style={{ flex: 1, display: 'flex', gap: 3, justifyContent: 'space-between' }}>
            {cols.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                {col.map(cell => (
                  <div
                    key={cell.iso}
                    title={cell.workout ? `${cell.workout.title} on ${cell.iso}` : cell.iso}
                    style={{
                      height: 13, borderRadius: 3,
                      background: cell.future
                        ? 'transparent'
                        : cell.workout
                          ? 'var(--blue)'
                          : 'var(--gray5)',
                      opacity: cell.future ? 0.3 : 1,
                      border: cell.iso === today.toISOString().slice(0, 10) ? '1.5px solid var(--blue)' : 'none',
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}


/** Workout template — saved to localStorage after completing a workout. */
interface WorkoutTemplate {
  id: string
  name: string
  exercises: { name: string; sets: number; weight_kg?: number; reps?: number }[]
  savedAt: string
}

function loadTemplates(): WorkoutTemplate[] {
  try {
    const raw = localStorage.getItem('workout_templates')
    return raw ? JSON.parse(raw) as WorkoutTemplate[] : []
  } catch { return [] }
}

function saveTemplates(templates: WorkoutTemplate[]) {
  try { localStorage.setItem('workout_templates', JSON.stringify(templates)) } catch { /* quota */ }
}

/** RIR from the last set of a session that actually reported one. The tier
 * buttons ("Too easy" / "Just right" / ...) write this; before now it was
 * collected and thrown away. */
function lastRirOf(sets?: Array<{ rir?: number }>): number | null {
  if (!sets || sets.length === 0) return null
  for (let i = sets.length - 1; i >= 0; i--) {
    const r = sets[i]?.rir
    if (typeof r === 'number') return r
  }
  return null
}

export default function Workout({ onOpenSkill }: { onOpenSkill?: () => void }) {
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [weighIns, setWeighIns] = useState<WeighIn[]>([])
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [prs, setPRs] = useState<Record<string, { weight_kg: number; reps: number; date: string }>>({})
  const [live, setLive] = useState<LiveWorkout | null>(null)
  // Live-workout persistence: hydrated flips true after the restore effect so the
  // persist effect can't clobber the saved snapshot on the first render.
  const [hydrated, setHydrated] = useState(false)
  // Screen stays on while a session is running - roughly 20 unlocks saved.
  useWakeLock(live !== null)

  // Every path that receives workout history goes through here. learnFromLogs
  // teaches the equipment catalog which weights actually exist on these
  // machines, inferred from what has genuinely been lifted - so a hardcoded
  // guess gets corrected by reality instead of persisting forever. It writes
  // to localStorage synchronously, so it must run BEFORE the state update that
  // triggers the render reading it, not in an effect afterwards.
  const applyWorkouts = useCallback((list: WorkoutData[]) => {
    try { learnFromLogs(list) } catch { /* storage disabled - not fatal */ }
    // Cache history so a mid-session network drop still leaves the adaptive
    // engine with weights/RIR to work from, instead of collapsing to the
    // static program template (issue #8: "went offline, adaptation broke").
    try { localStorage.setItem('gym_workouts_cache', JSON.stringify(list)) } catch { /* quota */ }
    setWorkouts(list)
  }, [])
  const [restTimer, setRestTimer] = useState<{ seconds: number } | null>(null)
  const [exSearch, setExSearch] = useState('')
  const [exResults, setExResults] = useState<string[]>([])
  const [showExSearch, setShowExSearch] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [cancelArmed, setCancelArmed] = useState(false)
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
  const [showSwap, setShowSwap] = useState(false)
  const [swapExIdx, setSwapExIdx] = useState<number | null>(null)
  const [swapSearch, setSwapSearch] = useState('')
  const [swapResults, setSwapResults] = useState<string[]>([])
  // The full catalogue is ~200 rows across every body part, down to foam
  // rolling. Fine as a fallback, wrong as a default when someone is waiting
  // for the machine - so it hides behind a tap until asked for.
  const [showAllEx, setShowAllEx] = useState(false)
  const [templates, setTemplates] = useState<WorkoutTemplate[]>(loadTemplates)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showCoach, setShowCoach] = useState(false)
  // Paste-a-routine importer state.
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<ParsedRoutine | null>(null)
  // Describe a finished session in prose instead of tapping it in set by set.
  const [showLog, setShowLog] = useState(false)
  const [logText, setLogText] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [logPreview, setLogPreview] = useState<ParsedSession | null>(null)
  // Scorecard shown once a session is saved: PRs hit, volume vs last time,
  // muscle coverage. The component existed and was wired to nothing.
  const [postWorkout, setPostWorkout] = useState<{ analysis: WorkoutAnalysis; weeklyVolume: MuscleVolume[] } | null>(null)
  const repsInputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    // Seed instantly from the last-known cache so the engine always has history
    // to adapt from — even offline — before the network answers.
    try {
      const wc = localStorage.getItem('gym_workouts_cache')
      if (wc) { const list = JSON.parse(wc) as WorkoutData[]; if (Array.isArray(list) && list.length) applyWorkouts(list) }
      const pc = localStorage.getItem('gym_prs_cache')
      if (pc) setPRs(JSON.parse(pc))
    } catch { /* corrupt cache — ignore */ }
    api.getWorkouts(20).then(applyWorkouts).catch(() => { /* offline: cache already seeded */ })
    api.getPRs().then(p => { setPRs(p); try { localStorage.setItem('gym_prs_cache', JSON.stringify(p)) } catch { /* quota */ } })
      .catch(() => { /* offline: cache already seeded */ })
    api.getWeightLog(90).then(r => setWeighIns(r.entries ?? [])).catch(() => setWeighIns([]))
    // Fetch nutrition signal for the predicted-weight rule. Failure is silent —
    // we just default to "not properly eating" and weight bumps are suppressed,
    // which is the safer fallback than over-predicting on missing data.
    Promise.all([api.getFoodHistory(7), api.getGoals()])
      .then(([history, goalsResp]) => {
        const totals: DailyTotals[] = (history ?? []).map(d => ({
          date: d.date,
          total_kcal: d.total_kcal,
          // /food/history now returns total_protein_g, so the eating gate
          // considers protein as well as calories.
          total_protein_g: d.total_protein_g,
          logged: d.logged,
        }))
        setProperlyEating(isProperlyEating(totals, goalsResp.parsed))
      })
      .catch(() => { setProperlyEating(false) })
  }, [applyWorkouts])

  // ── Live-workout persistence ──────────────────────────────────────────────
  // A live workout is just React state, so switching tabs (which unmounts this
  // page), backgrounding the PWA, or the phone killing it all used to wipe an
  // in-progress session. Snapshot it to localStorage on every change and restore
  // on mount so none of that loses your logged sets. The rest countdown is saved
  // as an absolute deadline, so time keeps elapsing while you're away.
  const LIVE_KEY = 'gym_live_v1'
  const restDeadlineRef = useRef<number | null>(null)
  const prevRestRef = useRef<{ seconds: number } | null>(null)

  // Restore once, before the persist effect is allowed to run.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_KEY)
      if (raw) {
        const snap = JSON.parse(raw)
        if (snap?.live?.exercises && Array.isArray(snap.live.exercises)) {
          setLive(snap.live)
          setFocusExIdx(snap.focusExIdx || 0)
          setFocusSetIdx(snap.focusSetIdx || 0)
          if (snap.phase === 'rest' && snap.restEndsAt) {
            const rem = Math.round((snap.restEndsAt - Date.now()) / 1000)
            if (rem > 1) { setPhase('rest'); setRestTimer({ seconds: rem }) }
            else { setPhase('active') }  // rest already elapsed while away
          } else {
            setPhase(snap.phase === 'done' ? 'done' : 'active')
          }
        }
      }
    } catch { /* corrupt snapshot — start fresh */ }
    setHydrated(true)
  }, [])

  // Convert the current rest timer into an absolute deadline the moment it starts.
  useEffect(() => {
    if (restTimer && restTimer !== prevRestRef.current) {
      restDeadlineRef.current = Date.now() + restTimer.seconds * 1000
    }
    if (!restTimer) restDeadlineRef.current = null
    prevRestRef.current = restTimer
  }, [restTimer])

  // Persist (only after hydration, so we never overwrite the snapshot with the
  // null initial state before restore has run).
  useEffect(() => {
    if (!hydrated) return
    try {
      if (live) {
        localStorage.setItem(LIVE_KEY, JSON.stringify({
          live, focusExIdx, focusSetIdx, phase,
          restEndsAt: phase === 'rest' ? restDeadlineRef.current : null,
        }))
      } else {
        localStorage.removeItem(LIVE_KEY)
      }
    } catch { /* quota — best effort */ }
  }, [hydrated, live, focusExIdx, focusSetIdx, phase, restTimer])

  // Last-session sets per exercise — the "did all reps hit?" signal for predictNextWeight.
  // Walks the workouts list newest-first and records the first occurrence of each exercise.
  // Per-exercise session history, newest first. Feeds two-session stall
  // detection, the >10-day layoff rule, and last-session RIR.
  const historyByExercise = useMemo(() => {
    const map: Record<string, { sets: ExerciseSet[]; date: string }[]> = {}
    const newest = [...workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))
    for (const w of newest) {
      for (const ex of w.exercises) {
        if (!map[ex.name]) map[ex.name] = []
        map[ex.name].push({ sets: ex.sets, date: w.start_time })
      }
    }
    return map
  }, [workouts])

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
      setExResults([])
      return
    }
    const local = searchExercisesLocal(exSearch)
    setExResults(local)
    if (local.length < 4) {
      clearTimeout(searchTimeout.current)
      searchTimeout.current = setTimeout(async () => {
        const remote = await searchExercisesRemote(exSearch)
        const combined = [...local, ...remote.filter(r => !local.includes(r))].slice(0, 12)
        setExResults(combined)
      }, 400)
    }
  }, [exSearch])

  useEffect(() => {
    if (!swapSearch) { setSwapResults([]); return }
    const local = searchExercisesLocal(swapSearch)
    setSwapResults(local.slice(0, 10))
  }, [swapSearch])

  function swapExercise(exIdx: number, newName: string, seedKg?: number) {
    if (!live) return
    setLive(prev => {
      if (!prev) return prev
      const exercises = prev.exercises.map((ex, i) => {
        if (i !== exIdx) return ex
        const pr = prs[newName]
        const t = targetFor(newName, ex.repRange, ex.restSeconds, i, prev.exercises.length, seedKg !== undefined ? seedKg + 'kg' : undefined)
        return {
          ...ex,
          name: newName,
          prevBest: pr,
          sets: ex.sets.map(s => ({
            ...s,
            weight_kg: s.done ? s.weight_kg : (t.weight_kg ?? s.weight_kg),
            reps: s.done ? s.reps : (t.repsTarget ?? s.reps),
          })),
        }
      })
      return { ...prev, exercises }
    })
    showToast(`Swapped to ${newName}`)
    setShowSwap(false)
    setSwapExIdx(null)
    setSwapSearch('')
    setSwapResults([])
  }

  const recentTitles = [...workouts].reverse().map(w => w.title)
  const nextDay = getNextDay(recentTitles)
  const displayDay = selectedDay ?? nextDay

  // Adaptive target for one exercise. The resurrected decision engine drives
  // weight + reps from eating (properlyEating) and training history (PRs + last
  // sets), snapping to real gym-stack increments. Used for BOTH the Next-Up
  // card and seeding a live workout, so the preview matches what you'll lift.
  // What next session becomes if you answer a given way. The effort question
  // is trivial to ignore, and ignoring it makes the app worse - so show the
  // consequence on the button rather than asking blind.
  function projectNext(exIdx: number, rir: number): number | undefined {
    const ex = live?.exercises[exIdx]
    if (!ex) return undefined
    const prevSets = ex.sets
      .filter(s => s.done && !s.ramp && (s.reps ?? 0) > 0)
      .map(s => ({ weight_kg: s.weight_kg, reps: s.reps }))
    if (prevSets.length === 0) return undefined
    return decideNextSet({
      exerciseName: ex.name,
      prevBest: ex.prevBest,
      prevSets,
      repRange: ex.repRange,
      programRestSeconds: ex.restSeconds,
      lastSessionRIR: rir,
      session: { positionInSession: 0, totalExercises: 1, sessionVolumeSoFar: 0 },
    }).weight_kg
  }

  function targetFor(exerciseName: string, repRange: string | null | undefined, restSeconds: number | undefined, positionInSession: number, totalExercises: number, startingWeight?: string, recalibrating?: boolean): DecisionResult {
    const pr = prs[exerciseName]
    const hist = historyByExercise[exerciseName] ?? []
    const prevSets = hist[0]?.sets.filter(s => !s.ramp)
    const priorSets = hist[1]?.sets.filter(s => !s.ramp)
    const daysSinceLast = hist[0]
      ? Math.floor((Date.now() - new Date(hist[0].date).getTime()) / 86400000)
      : null
    const lastSessionRIR = lastRirOf(hist[0]?.sets.filter(s => !s.ramp))
    // No PR and no logged sets yet? Seed the engine with the program's starting
    // weight (at the bottom of the rep range, so it holds rather than bumps) —
    // this lets the number still adapt to EATING before any history exists.
    let prevBest = pr ? { weight_kg: pr.weight_kg, reps: pr.reps } : null
    if (!prevBest && !(prevSets && prevSets.length) && startingWeight) {
      const m = startingWeight.match(/(\d+(?:\.\d+)?)\s*kg/i)
      if (m) prevBest = { weight_kg: parseFloat(m[1]), reps: parseRepRange(repRange)?.min ?? 8 }
    }
    return decideNextSet({
      exerciseName,
      prevBest,
      prevSets,
      repRange,
      programRestSeconds: restSeconds,
      lastSetRIR: null,
      sleepHours: null,
      priorSets,
      lastSessionRIR,
      daysSinceLast,
      recalibrating,
      session: { positionInSession, totalExercises, sessionVolumeSoFar: 0 },
      isFirstSet: true,
    })
  }

  function startWorkout(day?: ProgramDay) {
    const hour = new Date().getHours()
    const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
    const title = day?.name ?? `${timeOfDay} Session`

    if (day) {
      const exercises: LiveExercise[] = day.exercises.map((ex, i) => {
        const pr = prs[ex.name]
        const t = targetFor(ex.name, ex.repRange, ex.restSeconds, i, day.exercises.length, seedLabel(ex), ex.recalibrating)
        // 50% x 8 then 75% x 4 on the first compound only. Flagged so they are
        // excluded from volume, PRs and - critically - progression evaluation.
        const working = t.weight_kg
        // Warm-up weights must snap to REAL machine notches too — rounding to
        // 0.25kg produced off-stack warm-ups (13.5kg on a machine whose notches
        // are 9/14/18/23/27). Caught by on-device verification 2026-08-04.
        const rampStack = resolveEquipment(ex.name).effectiveStack
        const rampSets: LiveSet[] = (ex.rampUp && working != null && working > 0)
          ? RAMP_UP_SETS.map(r => ({
              weight_kg: rampStack
                ? snapToStack(rampStack, working * r.pctOfWorking)
                : Math.round(working * r.pctOfWorking * 4) / 4,
              reps: r.reps, done: false, ramp: true,
            }))
          : []
        const sets: LiveSet[] = [...rampSets, ...Array.from({ length: ex.sets }, () => ({
          weight_kg: t.weight_kg,
          reps: t.repsTarget,
          target: t.repsTarget,  // prescribed reps — a shortfall counts as a miss, not "too easy"
          done: false,
        }))]
        return { name: ex.name, sets, prevBest: pr, repRange: ex.repRange, rir: rirFor(ex.lift), restSeconds: ex.restSeconds, notes: ex.notes, swaps: ex.swaps, reason: t.reasonNote, stackUp: t.weightUp, stackDown: t.weightDown }
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

  // Un-complete a logged set so its reps become editable again. The edit-mode
  // hydration comment always promised this ("the user can untoggle to
  // re-edit a set") but no handler ever existed — reps were uneditable.
  function uncompleteSet(exIdx: number, setIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], done: false }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
    setRestTimer(null)
    setPhase('active')
    setFocusExIdx(exIdx)
    setFocusSetIdx(setIdx)
  }

  // Remove the LAST set of an exercise if it isn't logged yet — the undo for
  // a mis-tapped "+" (which used to be permanent for the session).
  function removeSet(exIdx: number) {
    const ex = live?.exercises[exIdx]
    if (!ex || ex.sets.length <= 1) { showToast('Only one set left', 'info'); return }
    if (ex.sets.at(-1)?.done) { showToast('Last set is already logged — un-log it first', 'info'); return }
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      exercises[exIdx] = { ...exercises[exIdx], sets: exercises[exIdx].sets.slice(0, -1) }
      return { ...w, exercises }
    })
    if (focusExIdx === exIdx && focusSetIdx >= (ex.sets.length - 1)) setFocusSetIdx(Math.max(0, ex.sets.length - 2))
  }

  // Remove an exercise outright, as long as nothing is logged on it (logged
  // sets shouldn't silently vanish — un-log them first if you really mean it).
  function removeExercise(exIdx: number) {
    const ex = live?.exercises[exIdx]
    if (!ex) return
    if (ex.sets.some(st => st.done)) { showToast('Has logged sets — un-log them first', 'info'); return }
    if ((live?.exercises.length ?? 0) <= 1) { showToast('Last exercise — finish or cancel instead', 'info'); return }
    setLive(w => {
      if (!w) return w
      const exercises = w.exercises.filter((_, i) => i !== exIdx)
      return { ...w, exercises }
    })
    if (focusExIdx >= exIdx) { setFocusExIdx(Math.max(0, focusExIdx - 1)); setFocusSetIdx(0) }
    showToast(`Removed ${ex.name}`)
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
    // Editing a saved workout skips the rest phase entirely (free navigation,
    // no timer) — documented behaviour that was never actually implemented.
    if (!live?.editingId) {
      const restSecs = live?.exercises[exIdx]?.restSeconds ?? 90
      setRestTimer({ seconds: restSecs })
    }
    if (navigator.vibrate) navigator.vibrate([10, 10, 30])
  }

  // Reopen the "how did it feel" picker for a set (clears its RIR).
  function clearSetFeeling(exIdx: number, setIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = w.exercises.map((ex, ei) => ei !== exIdx ? ex : {
        ...ex, sets: ex.sets.map((st, si) => si === setIdx ? { ...st, rir: undefined } : st),
      })
      return { ...w, exercises }
    })
  }

  // Adjust the reps recorded on a just-completed set (during rest, ±1).
  function adjustDoneReps(exIdx: number, setIdx: number, delta: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      const cur = sets[setIdx]
      sets[setIdx] = { ...cur, reps: Math.max(0, (cur.reps ?? 0) + delta) }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
  }

  // Record how a set felt, then SELF-CORRECT the remaining sets AND the rest
  // timer. Every tier now does something (before, 'good' and 'hard' were inert,
  // which is why picking "hard" felt like it changed nothing). On this gym's
  // coarse imperial stacks a notch is a big jump, so:
  //   easy → up a real notch      good → hold        (both keep normal rest)
  //   hard → hold + more rest      fail → down a real notch (+ drop-set cue)
  // Adjustments use the machine's real stack, never a phantom 1.25kg step.
  function applySetFeedback(exIdx: number, setIdx: number, tier: 'easy' | 'good' | 'hard' | 'fail') {
    const exName = live?.exercises[exIdx]?.name ?? ''
    const eq = resolveEquipment(exName)
    // A set logged below its prescribed reps is a miss — you aimed for the target
    // and fell short. It must NOT count as "too easy" (that would push the weight
    // up off a set you actually failed) and it records as a near-failure so the
    // next session knows. Downgrade an 'easy' tap on a missed set to a hold.
    const doneSet = live?.exercises[exIdx]?.sets[setIdx]
    const missedTarget = !!doneSet && doneSet.target != null && (doneSet.reps ?? 0) < doneSet.target
    const effTier: 'easy' | 'good' | 'hard' | 'fail' = (tier === 'easy' && missedTarget) ? 'good' : tier
    setLive(w => {
      if (!w) return w
      const exercises = w.exercises.map((ex, ei) => {
        if (ei !== exIdx) return ex
        const sets = ex.sets.map((s, si) => si === setIdx
          ? { ...s, rir: missedTarget ? Math.min(TIER_RIR[effTier], 1) : TIER_RIR[effTier] }
          : s)
        const doneWeight = sets[setIdx].weight_kg
        if (doneWeight != null && doneWeight > 0 && (effTier === 'easy' || effTier === 'fail')) {
          let adj = doneWeight
          if (eq.effectiveStack) {
            adj = effTier === 'easy'
              ? nextUpWeight(eq.effectiveStack, doneWeight)
              : nextDownWeight(eq.effectiveStack, doneWeight)
          } else {
            const inc = genericIncrement(doneWeight)
            adj = effTier === 'easy'
              ? Math.round((doneWeight + inc) * 100) / 100
              : Math.max(0, Math.round((doneWeight - inc) * 100) / 100)
          }
          for (let si = setIdx + 1; si < sets.length; si++) {
            if (!sets[si].done) sets[si] = { ...sets[si], weight_kg: adj }
          }
        }
        return { ...ex, sets }
      })
      return { ...w, exercises }
    })
    // Adaptive rest — size the break to how that set actually felt, not a flat
    // 2 minutes. Near-failure earns more recovery; an easy set, less.
    if (!live?.editingId) {
      const baseRest = live?.exercises[exIdx]?.restSeconds ?? 90
      const factor = effTier === 'easy' ? 0.8 : effTier === 'good' ? 1.0 : effTier === 'hard' ? 1.2 : 1.3
      setRestTimer({ seconds: Math.max(30, Math.round(baseRest * factor / 5) * 5) })
    }
    if (navigator.vibrate) navigator.vibrate(12)
    if (missedTarget && tier === 'easy') showToast(`Logged ${doneSet?.reps}/${doneSet?.target} reps — holding the weight, not a fail on you`)
    else if (effTier === 'easy') showToast('Up a notch next set 💪')
    else if (effTier === 'good') showToast('Held the weight — dialled in')
    else if (effTier === 'hard') showToast('Holding the weight, giving you more rest')
    else showToast('Down a notch next set — or drop & keep going')
  }

  // Drop set: you couldn't finish at this weight, so log what you DID, then
  // drop to the next notch down and keep going as part of the same effort.
  // Research-backed (rest-pause / drop sets ≈ straight sets for growth) — and
  // it's what you naturally did on rear delt fly. Splits the current set into
  // "done reps @ this weight" + a fresh lighter set inserted right after.
  function dropAndContinue(exIdx: number, setIdx: number) {
    const exName = live?.exercises[exIdx]?.name ?? ''
    const eq = resolveEquipment(exName)
    setLive(w => {
      if (!w) return w
      const exercises = w.exercises.map((ex, ei) => {
        if (ei !== exIdx) return ex
        const cur = ex.sets[setIdx]
        const curW = cur.weight_kg
        const lighter = curW != null && curW > 0
          ? (eq.effectiveStack ? nextDownWeight(eq.effectiveStack, curW) : Math.max(0, Math.round((curW - genericIncrement(curW)) * 100) / 100))
          : curW
        const dropped: LiveSet = { weight_kg: lighter, reps: undefined, done: false, drop: true }
        const sets = [...ex.sets.slice(0, setIdx + 1), dropped, ...ex.sets.slice(setIdx + 1)]
        return { ...ex, sets }
      })
      return { ...w, exercises }
    })
    // Jump straight to the lighter continuation set, no rest.
    setRestTimer(null)
    setPhase('active')
    setFocusExIdx(exIdx)
    setFocusSetIdx(setIdx + 1)
    if (navigator.vibrate) navigator.vibrate(10)
    showToast('Dropped a notch — keep going')
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
    // Snapshot the old PRs - analyzeWorkout diffs against them to find new ones.
    const prevPRs = prs
    const endTime = live.editingEndTime ?? new Date().toISOString()
    const payload = {
      title: live.title,
      start_time: live.startTime,
      end_time: endTime,
      exercises: live.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.filter(s => s.done).map(s => {
          const { done, drop, ...rest } = s
          void done; void drop  // client-only UI flags — not persisted
          return rest
        }),
      })),
    }
    // Guarded save — this used to have NO error handling: a network blip on
    // Finish left the button permanently stuck on "…" and lost the session.
    try {
      if (live.editingId) {
        await api.updateWorkout(live.editingId, payload)
      } else {
        await api.saveWorkout(payload)
      }
    } catch {
      setFinishing(false)
      showToast('Could not save — check connection and tap Finish again', 'err')
      return
    }
    // Post-save refresh is best-effort: the workout IS saved at this point,
    // so a refresh failure must not resurrect the session or lose the save.
    let updated: WorkoutData[] = []
    try {
      const [u, updatedPRs] = await Promise.all([api.getWorkouts(20), api.getPRs()])
      updated = u
      applyWorkouts(u)
      setPRs(updatedPRs)
    } catch { /* saved fine; scorecard just won't show */ }
    const savedId = live.editingId
    const saved = savedId ? updated.find(w => w.id === savedId) : updated[0]
    if (saved) {
      setPostWorkout({
        analysis: analyzeWorkout(saved, updated.filter(w => w.id !== saved.id), prevPRs),
        weeklyVolume: weeklyVolumeByMuscle(updated, 7),
      })
    }
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


  function saveAsTemplate(name: string) {
    if (!live || !name.trim()) return
    const tmpl: WorkoutTemplate = {
      id: `tmpl-${Date.now()}`,
      name: name.trim(),
      exercises: live.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.length,
        weight_kg: ex.sets[0]?.weight_kg,
        reps: ex.sets[0]?.reps,
      })),
      savedAt: new Date().toISOString(),
    }
    const updated = [tmpl, ...templates.filter(t => t.id !== tmpl.id)].slice(0, 20)
    setTemplates(updated)
    saveTemplates(updated)
    setShowSaveTemplate(false)
    setTemplateName('')
    showToast(`Template "${name.trim()}" saved`)
  }

  async function parseLoggedSession() {
    if (!logText.trim() || logBusy) return
    setLogBusy(true); setLogPreview(null)
    try {
      // Everything the programme knows about, including swap alternatives,
      // so parsed names snap to what history is keyed by.
      const known = new Set<string>()
      for (const d of ROTATION) {
        for (const ex of PROGRAM[d].exercises) {
          known.add(ex.name)
          for (const sw of ex.swaps ?? []) known.add(sw.name)
        }
        for (const sk of PROGRAM[d].skill) known.add(sk.name)
      }
      for (const n of Object.keys(prs)) known.add(n)
      const r = await api.parseSession(logText, [...known])
      if (r.ok && r.exercises.length) setLogPreview(r)
      else showToast(r.error || 'No completed sets in that description', 'err')
    } catch { showToast('Could not read that session', 'err') }
    finally { setLogBusy(false) }
  }

  async function saveLoggedSession() {
    if (!logPreview || logBusy) return
    setLogBusy(true)
    const end = new Date()
    const start = new Date(end.getTime() - 60 * 60000)
    try {
      await api.saveWorkout({
        title: logPreview.title,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        exercises: logPreview.exercises.map(ex => ({ name: ex.name, sets: ex.sets })),
      })
      showToast('Session logged')
      void api.getWorkouts(20).then(applyWorkouts).catch(() => {})
      void api.getPRs().then(setPRs).catch(() => {})
    } catch {
      showToast('Saved offline - will sync', 'err')
    } finally {
      setLogBusy(false); setShowLog(false); setLogPreview(null); setLogText('')
    }
  }

  async function parseImport() {
    const text = importText.trim()
    if (!text || importBusy) return
    setImportBusy(true)
    setImportPreview(null)
    try {
      const r = await api.parseRoutine(text)
      if (!r.ok || !r.exercises.length) {
        showToast(r.error || "Couldn't read that routine — try simpler text", 'err')
      } else {
        setImportPreview(r)
        if (navigator.vibrate) navigator.vibrate(10)
      }
    } catch (err) {
      const msg = String(err)
      const busy = /\b(429|500|502|503|504)\b/.test(msg)
      showToast(busy ? 'The parser is briefly busy — tap again.' : 'Import failed — try again', 'err')
    } finally {
      setImportBusy(false)
    }
  }

  // Start a live workout from a parsed routine. Each exercise is engine-seeded
  // (targetFor) so imported routines adapt to eating + history just like the program.
  function startFromRoutine(routine: ParsedRoutine) {
    const exercises: LiveExercise[] = routine.exercises.map((ex, i) => {
      const pr = prs[ex.name]
      const t = targetFor(ex.name, ex.repRange, ex.restSeconds, i, routine.exercises.length)
      const sets: LiveSet[] = Array.from({ length: ex.sets }, () => ({ weight_kg: t.weight_kg, reps: t.repsTarget, done: false }))
      return { name: ex.name, sets, prevBest: pr, repRange: ex.repRange, rir: ex.rir, restSeconds: ex.restSeconds }
    })
    setLive({ title: routine.title, startTime: new Date().toISOString(), exercises })
    setFocusExIdx(0); setFocusSetIdx(0); setPhase('active'); setRestTimer(null)
    setShowImport(false); setImportPreview(null); setImportText('')
    if (navigator.vibrate) navigator.vibrate(20)
  }

  function startFromTemplate(tmpl: WorkoutTemplate) {
    const exercises: LiveExercise[] = tmpl.exercises.map(ex => {
      const pr = prs[ex.name]
      const prevSets = lastSetsByExercise[ex.name]
      const predicted = predictNextWeight({
        prevBest: pr ? { weight_kg: pr.weight_kg, reps: pr.reps } : null,
        prevSets,
      })
      const sets: LiveSet[] = Array.from({ length: ex.sets }, () => ({
        weight_kg: predicted.weight_kg ?? ex.weight_kg,
        reps: predicted.reps ?? ex.reps,
        done: false,
      }))
      return { name: ex.name, sets, prevBest: pr }
    })
    setLive({ title: tmpl.name, startTime: new Date().toISOString(), exercises })
    setFocusExIdx(0)
    setFocusSetIdx(0)
    setPhase('active')
    setRestTimer(null)
    if (navigator.vibrate) navigator.vibrate(20)
  }

  function deleteTemplate(id: string) {
    const updated = templates.filter(t => t.id !== id)
    setTemplates(updated)
    saveTemplates(updated)
    showToast('Template removed')
  }

  async function deleteWorkout(w: WorkoutData) {
    if (!confirm(`Delete "${w.title}" from ${new Date(w.start_time).toLocaleDateString()}?`)) return
    try {
      await api.deleteWorkout(w.id)
      const [updated, updatedPRs] = await Promise.all([api.getWorkouts(20), api.getPRs()])
      applyWorkouts(updated)
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
      // Snapshot with this set marked done (setLive hasn't flushed yet). Prefer
      // the next set forward; if nothing remains forward, loop back to an
      // exercise PARKED earlier (skipped for a busy machine) so it's never
      // stranded and the workout doesn't end with sets still owed.
      const snapshot = liveNonNull.exercises.map((ex, ei) => ei === exIdx
        ? { ...ex, sets: ex.sets.map((s, si) => si === setIdx ? { ...s, done: true } : s) }
        : ex)
      const next = findNextIncompleteSet(snapshot, exIdx, setIdx) ?? findFirstIncompleteSet(snapshot)
      if (next) {
        setFocusExIdx(next.exerciseIdx)
        setFocusSetIdx(next.setIdx)
        setPhase(liveNonNull.editingId ? 'active' : 'rest')
        // Auto-scroll to the active exercise card after advancing
        setTimeout(() => document.getElementById('active-exercise')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
      } else {
        setRestTimer(null)
        setPhase('done')
      }
    }

    // Machine busy? Park the current exercise and jump to the next one with
    // sets left (searching forward, then wrapping). You'll be routed back to
    // the parked one automatically once everything else is done.
    function skipToNextExercise() {
      const exs = liveNonNull.exercises
      for (let i = 1; i <= exs.length; i++) {
        const idx = (focusExIdx + i) % exs.length
        if (idx === focusExIdx) continue
        const setIdx = exs[idx].sets.findIndex(s => !s.done)
        if (setIdx >= 0) {
          const parked = exs[focusExIdx]?.name
          setFocusExIdx(idx)
          setFocusSetIdx(setIdx)
          setPhase('active')
          setRestTimer(null)
          if (navigator.vibrate) navigator.vibrate(10)
          if (parked) showToast(`Parked ${parked} — come back when it's free`)
          setTimeout(() => document.getElementById('active-exercise')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
          return
        }
      }
      showToast('No other exercise to jump to')
    }

    // Note: free Prev/Next navigation removed from the active card per the
    // user's "no clutter" feedback. Set jumps now happen from the Manage sheet.

    return (
      <div
        className="page"
        style={{
          background: 'var(--bg)',
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
              {phase !== 'done' && liveNonNull.exercises.length > 1 && (
                <button
                  onClick={skipToNextExercise}
                  title="Machine busy? Skip to the next exercise — you'll come back to this one"
                  style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, padding: '0 12px', height: 36, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--label)', display: 'flex', alignItems: 'center', gap: 5 }}
                >&#9197; Skip</button>
              )}
              {phase !== 'done' && focusEx?.swaps && focusEx.swaps.length > 0 && (
                <button
                  onClick={() => { setSwapExIdx(focusExIdx); setShowSwap(true); setSwapSearch(''); setSwapResults([]); setShowAllEx(false) }}
                  title="Machine taken? Swap to a program alternative"
                  style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, padding: '0 12px', height: 36, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--label)', display: 'flex', alignItems: 'center', gap: 5 }}
                >&#8646; Swap</button>
              )}
              <button
                onClick={() => setShowCoach(true)}
                aria-label="Ask the coach"
                title="Ask the coach — machines, swaps, form"
                style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, width: 36, height: 36, fontSize: 16, cursor: 'pointer', color: 'var(--label)' }}
              >💬</button>
              <button
                onClick={() => setShowManage(true)}
                aria-label="Manage exercises"
                style={{ background: 'var(--gray6)', border: 'none', borderRadius: 18, width: 36, height: 36, fontSize: 17, cursor: 'pointer', color: 'var(--label)' }}
              >☰</button>
              {isEditing && (
                <button
                  onClick={() => {
                    // Two-tap: first tap arms, second within 3s discards. A
                    // single mis-tap used to throw away every edit instantly.
                    if (!cancelArmed) {
                      setCancelArmed(true)
                      showToast('Tap Cancel again to discard changes', 'info')
                      window.setTimeout(() => setCancelArmed(false), 3000)
                      return
                    }
                    setLive(null); setRestTimer(null); setPhase('active'); setCancelArmed(false)
                  }}
                  style={{ background: cancelArmed ? 'rgba(229,72,77,0.15)' : 'var(--gray6)', border: 'none', borderRadius: 18, padding: '0 14px', height: 36, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: cancelArmed ? 'var(--red, #e5484d)' : 'var(--label)' }}
                >{cancelArmed ? 'Discard?' : 'Cancel'}</button>
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
            const accent = getExerciseAccent(focusEx.name)
            const handleSwipe = (dx: number) => {
              if (dx < -80 && !isThisSetDone && (focusSet.reps ?? 0) > 0) {
                submitCurrentSet()
              }
            }
            return (
              <>
                <div id="active-exercise">
                <ActiveSetCard
                  key={`${focusExIdx}-${focusSetIdx}`}
                  accent={accent}
                  exerciseName={focusEx.name}
                  setNumber={focusSetIdx + 1}
                  totalSets={focusEx.sets.length}
                  weight={focusSet.weight_kg}
                  reps={focusSet.reps}
                  isDone={isThisSetDone}
                  isRamp={focusSet.ramp}
                  reason={focusEx.reason}
                  stackUp={focusEx.stackUp}
                  stackDown={focusEx.stackDown}
                  onWeight={(v) => updateSet(focusExIdx, focusSetIdx, 'weight_kg', v)}
                  onReps={(v) => updateSet(focusExIdx, focusSetIdx, 'reps', v)}
                  onSubmit={submitCurrentSet}
                  onSwipe={handleSwipe}
                  onUncomplete={() => uncompleteSet(focusExIdx, focusSetIdx)}
                  repsInputRef={repsInputRef}
                />
                {/* Exercise form description + muscle tags from the DB */}
                {(() => {
                  const dbEx = findExercise(focusEx.name)
                  if (!dbEx) return null
                  return (
                    <div style={{ marginTop: 10 }}>
                      {dbEx.description && (
                        <div style={{ fontSize: 13, color: 'var(--label2)', lineHeight: 1.45, marginBottom: 8 }}>
                          {dbEx.description}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {dbEx.primaryMuscles.map(m => (
                          <span key={m} style={{ fontSize: 10, fontWeight: 600, background: 'rgba(59,130,246,0.15)', color: 'var(--blue)', borderRadius: 6, padding: '2px 7px' }}>{m}</span>
                        ))}
                        {dbEx.secondaryMuscles.map(m => (
                          <span key={m} style={{ fontSize: 10, fontWeight: 600, background: 'var(--gray5)', color: 'var(--label2)', borderRadius: 6, padding: '2px 7px' }}>{m}</span>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* Programme guidance — moved out of the active card so the card
                    stays focused on the inputs. Only shown when the program
                    actually carries guidance for this exercise. */}
                {(focusEx.repRange || focusEx.rir || focusEx.prevBest) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--label2)' }}>
                    {focusEx.repRange && (
                      <span style={{ background: 'var(--card)', borderRadius: 8, padding: '5px 10px', fontWeight: 600 }}>Target {focusEx.repRange}</span>
                    )}
                    {focusEx.rir && (
                      <span style={{ background: 'var(--card)', borderRadius: 8, padding: '5px 10px', fontWeight: 600 }}>{focusEx.rir} RIR</span>
                    )}
                    {focusEx.prevBest && (
                      <span style={{ background: 'var(--card)', borderRadius: 8, padding: '5px 10px', fontWeight: 600 }}>
                        Best {focusEx.prevBest.weight_kg}kg × {focusEx.prevBest.reps}
                      </span>
                    )}
                  </div>
                )}
              </div>
              </>
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
                background: 'var(--card)',
                borderRadius: 22,
                padding: '0',
                marginTop: 8,
                textAlign: 'center',
                boxShadow: '0 4px 18px rgba(0,0,0,0.06), 0 0 0 1px var(--separator)',
                overflow: 'hidden',
              }}>
                <div style={{ height: 4, background: focusEx ? getExerciseAccent(focusEx.name) : 'var(--gray3)', opacity: 0.85 }} />
                <div style={{ padding: '32px 22px 24px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--label2)', marginBottom: 10 }}>Rest</div>
                  <RestTimerInline
                    key={`rest-${focusExIdx}-${focusSetIdx}-${restTimer?.seconds ?? 90}`}
                    seconds={restTimer?.seconds ?? focusEx?.restSeconds ?? 90}
                    onComplete={endRest}
                  />
                  <div style={{ marginTop: 14, fontSize: 14, color: 'var(--label2)' }}>
                    {previewBase.kind === 'next-set' && (
                      <>Next: <strong style={{ color: 'var(--label)' }}>Set {previewBase.setNumber} of {previewBase.exerciseName}</strong></>
                    )}
                    {previewBase.kind === 'next-exercise' && (
                      <>Up next: <strong style={{ color: 'var(--label)' }}>{previewBase.exerciseName}</strong> · Set 1 of {previewBase.totalSets}</>
                    )}
                    {previewBase.kind === 'workout-complete' && (
                      <strong style={{ color: 'var(--label)' }}>Workout complete</strong>
                    )}
                  </div>
                  {(() => {
                    const doneEx = liveNonNull.exercises[fromExIdx]
                    const doneSet = doneEx?.sets[fromSetIdx]
                    if (!doneSet) return null
                    const feelingGiven = doneSet.rir !== undefined
                    // Once you've said how it felt, the buttons collapse to a
                    // single personalized line + a get-ready cue for whatever's
                    // next — so the rest screen becomes calm, not a form.
                    return (
                      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--separator)', textAlign: 'left' }}>
                        {!feelingGiven ? (
                          <>
                            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--label)' }}>How did that feel?</div>
                            <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 12 }}>{doneEx.name} · Set {fromSetIdx + 1}</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 14 }}>
                              <button onClick={() => adjustDoneReps(fromExIdx, fromSetIdx, -1)} style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--separator)', background: 'var(--card)', color: 'var(--label)', fontSize: 22, cursor: 'pointer' }}>−</button>
                              <div style={{ textAlign: 'center', minWidth: 72 }}>
                                <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--label)' }}>{doneSet.reps ?? 0}</div>
                                <div style={{ fontSize: 11, color: 'var(--label2)' }}>reps done</div>
                              </div>
                              <button onClick={() => adjustDoneReps(fromExIdx, fromSetIdx, 1)} style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--separator)', background: 'var(--card)', color: 'var(--label)', fontSize: 22, cursor: 'pointer' }}>+</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {TIER_LABEL.map(([k, label]) => {
                                const proj = projectNext(fromExIdx, TIER_RIR[k])
                                return (
                                  <button key={k} onClick={() => applySetFeedback(fromExIdx, fromSetIdx, k)}
                                    style={{ height: 58, background: 'var(--bg)', border: '1px solid var(--separator)', borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', textAlign: 'left' }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 5, background: TIER_DOT[k], flexShrink: 0 }} />
                                    <span style={{ flex: 1, fontSize: 17, fontWeight: 600, color: 'var(--label)' }}>{label}</span>
                                    {proj !== undefined && (
                                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--label2)', whiteSpace: 'nowrap' }}>{proj}kg next</span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                            {(doneSet.weight_kg ?? 0) > 0 && (
                              <button
                                onClick={() => dropAndContinue(fromExIdx, fromSetIdx)}
                                style={{ width: '100%', marginTop: 12, background: 'var(--bg)', border: '1px dashed var(--separator)', borderRadius: 14, padding: '12px', fontSize: 14, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
                              >Couldn&rsquo;t finish? Drop a notch &amp; keep going ↓</button>
                            )}
                          </>
                        ) : (() => {
                          // Personalized line from how the session is going + a
                          // get-ready cue for the next machine / bench setup.
                          const tier = doneSet.rir! >= 4 ? 'easy' : doneSet.rir! >= 2 ? 'good' : doneSet.rir! >= 1 ? 'hard' : 'fail'
                          const lead = tier === 'easy' ? 'That one had more in it — nudged the next set up.'
                            : tier === 'good' ? 'Dialled in — right where you want to be.'
                            : tier === 'hard' ? 'Tough set — holding the weight and giving you a longer breather.'
                            : 'Eased it down a notch — protect the form.'
                          const pct = totalCount > 0 ? totalDone / totalCount : 0
                          const pace = pct >= 0.85 ? 'Last few sets — finish strong.'
                            : pct >= 0.5 ? `Over halfway — ${totalDone} of ${totalCount} done.`
                            : `${totalDone} of ${totalCount} sets in. Settling into it.`
                          const nextName = previewBase.kind === 'next-exercise' ? previewBase.exerciseName : null
                          let setup: string | null = null
                          if (nextName) {
                            const nn = nextName.toLowerCase()
                            if (nn.includes('incline')) setup = 'Set the bench to ~30–45°.'
                            else if (nn.includes('decline')) setup = 'Set the bench to a slight decline.'
                            else if (nn.includes('flat') || (nn.includes('bench') && nn.includes('press'))) setup = 'Flat bench.'
                            else if (nn.includes('seated')) setup = 'Seated — set the seat so the handles sit at the right height.'
                            const dbEx2 = findExercise(nextName)
                            if (dbEx2?.equipment) setup = (setup ? setup + ' ' : '') + `(${dbEx2.equipment})`
                          }
                          return (
                            <>
                              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>✓ Set {fromSetIdx + 1} logged</div>
                              <div style={{ fontSize: 14, color: 'var(--label)', marginTop: 8, lineHeight: 1.45 }}>{lead}</div>
                              <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 4 }}>{pace}</div>
                              {nextName && (
                                <div style={{ marginTop: 14, background: 'var(--bg)', borderRadius: 14, padding: '12px 14px' }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--label3)', marginBottom: 3 }}>Get ready</div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label)' }}>{nextName}</div>
                                  {setup && <div style={{ fontSize: 12.5, color: 'var(--label2)', marginTop: 3, lineHeight: 1.4 }}>{setup}</div>}
                                </div>
                              )}
                              <button onClick={() => clearSetFeeling(fromExIdx, fromSetIdx)}
                                style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--label2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Change how it felt</button>
                            </>
                          )
                        })()}
                      </div>
                    )
                  })()}

                  <button
                    onClick={endRest}
                    style={{ marginTop: 18, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer', minWidth: 160 }}
                  >Skip rest</button>
                </div>
              </div>
            )
          })()}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div style={{
              background: 'var(--card)',
              borderRadius: 22,
              padding: '0',
              marginTop: 8,
              textAlign: 'center',
              boxShadow: '0 4px 18px rgba(0,0,0,0.06), 0 0 0 1px var(--separator)',
              overflow: 'hidden',
            }}>
              <div style={{ height: 4, background: 'var(--green)', opacity: 0.85 }} />
              <div style={{ padding: '36px 24px 28px' }}>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.4px' }}>Workout complete</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>
                  {totalDone}/{totalCount} sets · <ElapsedTimer startTime={liveNonNull.startTime} />
                </div>
                <button
                  onClick={finishWorkout}
                  disabled={finishing}
                  style={{ marginTop: 22, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '13px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer', minWidth: 200, opacity: finishing ? 0.5 : 1 }}
                >{finishing ? 'Saving...' : 'Save workout'}</button>
                {/* Save as template */}
                {!showSaveTemplate ? (
                  <button
                    onClick={() => { setShowSaveTemplate(true); setTemplateName(liveNonNull.title) }}
                    style={{ marginTop: 10, background: 'none', border: '1px solid var(--separator)', borderRadius: 14, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--label2)' }}
                  >Save as template</button>
                ) : (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <input
                      value={templateName}
                      onChange={e => setTemplateName(e.target.value)}
                      placeholder="Template name"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter' && templateName.trim()) saveAsTemplate(templateName) }}
                      style={{ flex: 1, maxWidth: 180, background: 'var(--bg)', border: '1px solid var(--separator)', borderRadius: 10, padding: '8px 12px', fontSize: 14, color: 'var(--label)', textAlign: 'center' }}
                      autoComplete="on"
                      autoCorrect="on"
                      spellCheck={true}
                    />
                    <button
                      onClick={() => saveAsTemplate(templateName)}
                      disabled={!templateName.trim()}
                      style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: templateName.trim() ? 1 : 0.4 }}
                    >Save</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── EMPTY workout fallback ── */}
          {liveNonNull.exercises.length === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--label2)' }}>No exercises yet</div>
              <button
                onClick={() => setShowManage(true)}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              >Add exercise</button>
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
                    ? 'Fueled — progressive overload active today'
                    : 'Holding weight — hit your protein target for the next bump'}
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
                        {/* Muscle-group accent dot replaces the emoji. Same visual job
                            (group at-a-glance) without the cartoony feel. */}
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: getExerciseAccent(ex.name), flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1 }}>
                            {ex.sets.filter(s => s.done).length}/{ex.sets.length} sets done
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => { setSwapExIdx(exIdx); setShowSwap(true); setSwapSearch(''); setSwapResults([]); setShowAllEx(false) }}
                        aria-label="Swap exercise"
                        title="Swap this exercise for another"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: 'pointer', color: 'var(--label)' }}
                      >⇄</button>
                      <button
                        onClick={() => addSet(exIdx)}
                        aria-label="Add set"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: 'var(--label)' }}
                      >+</button>
                      <button
                        onClick={() => removeSet(exIdx)}
                        aria-label="Remove last set"
                        title="Remove the last (unlogged) set"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: 'var(--label)' }}
                      >&minus;</button>
                      <button
                        onClick={() => removeExercise(exIdx)}
                        aria-label="Remove exercise"
                        title="Remove this exercise (only when nothing is logged on it)"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: 'pointer', color: 'var(--red, #e5484d)' }}
                      >🗑</button>
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
                  <input className="input-field" placeholder="Search exercises (e.g. bench press)" value={exSearch} onChange={e => setExSearch(e.target.value)} autoFocus style={{ marginBottom: 8 }} autoComplete="on" autoCorrect="on" spellCheck={true} />
                  {exResults.length > 0 && (
                    <div className="card">
                      {exResults.map((r, i) => (
                        <button key={i} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => { addExercise(r); setShowManage(false); setShowExSearch(false); setExSearch('') }}>
                          <span style={{ fontSize: 15 }}>{r}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!exSearch && (() => {
                    // Show recent exercises from past workouts, then grouped DB
                    const recentExNames = [...new Set(workouts.flatMap(w => w.exercises.map(ex => ex.name)))].slice(0, 6)
                    const groups = getExercisesByGroup()
                    return (
                      <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                        {recentExNames.length > 0 && (
                          <div className="card" style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent</div>
                            {recentExNames.map(ex => (
                              <button key={ex} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => { addExercise(ex); setShowManage(false); setShowExSearch(false); setExSearch('') }}>
                                <span style={{ fontSize: 15 }}>{ex}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {(Object.keys(groups) as MuscleGroup[]).map(group => (
                          <div key={group} className="card" style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{group}</div>
                            {groups[group].map(ex => (
                              <button key={ex.name} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8 }} onClick={() => { addExercise(ex.name); setShowManage(false); setShowExSearch(false); setExSearch('') }}>
                                <span style={{ fontSize: 15 }}>{ex.name}</span>
                                <span style={{ fontSize: 11, color: 'var(--label3)', marginLeft: 'auto' }}>{ex.equipment}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  <button onClick={() => { setShowExSearch(false); setExSearch('') }} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 14, fontWeight: 500, padding: '14px 0', cursor: 'pointer' }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Exercise swap sheet — pick a replacement for the selected exercise */}
        {showSwap && swapExIdx !== null && (() => {
          const currentEx = liveNonNull.exercises[swapExIdx]
          const dbEx = findExercise(currentEx.name)
          const sameGroup = dbEx
            ? getExercisesByGroup()[dbEx.muscleGroup as MuscleGroup]?.filter(e => e.name !== currentEx.name) ?? []
            : []
          return (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
              onClick={e => { if (e.target === e.currentTarget) { setShowSwap(false); setSwapSearch(''); setSwapResults([]) } }}
            >
              <div style={{ background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%', padding: '16px 20px calc(32px + var(--safe-bottom))', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>Swap exercise</div>
                    <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 2 }}>replacing: {currentEx.name}</div>
                  </div>
                  <button onClick={() => { setShowSwap(false); setSwapSearch(''); setSwapResults([]); setShowAllEx(false) }} className="sheet-close">×</button>
                </div>
                {currentEx.swaps && currentEx.swaps.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--label3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '2px 0 6px' }}>From your program</div>
                    <div className="card" style={{ marginBottom: 12 }}>
                      {currentEx.swaps.map((sw, i) => (
                        <button key={i} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8, display: 'flex', alignItems: 'center' }}
                          onClick={() => swapExercise(swapExIdx, sw.name, sw.startingWeightKg)}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>{sw.name}</div>
                            {sw.note && <div style={{ fontSize: 11, color: 'var(--label3)', marginTop: 2, lineHeight: 1.35 }}>{sw.note}</div>}
                          </div>
                          {sw.startingWeightKg !== undefined && (
                            <span style={{ fontSize: 13, color: 'var(--label2)', marginLeft: 'auto', fontWeight: 700, flexShrink: 0 }}>{sw.startingWeightKg}kg</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <input
                  className="input-field"
                  placeholder="Search exercises…"
                  value={swapSearch}
                  onChange={e => setSwapSearch(e.target.value)}
                  autoFocus
                  style={{ marginBottom: 10 }}
                />
                {swapResults.length > 0 && (
                  <div className="card" style={{ marginBottom: 10 }}>
                    {swapResults.map((r, i) => (
                      <button key={i} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => swapExercise(swapExIdx, r)}>
                        <span style={{ fontSize: 15 }}>{r}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!swapSearch && sameGroup.length > 0 && (
                  <div className="card" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Same muscle group{dbEx ? ` · ${dbEx.muscleGroup}` : ''}
                    </div>
                    {sameGroup.map(ex => (
                      <button key={ex.name} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8 }}
                        onClick={() => swapExercise(swapExIdx, ex.name)}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: getExerciseAccent(ex.name), flexShrink: 0 }} />
                        <span style={{ fontSize: 15, flex: 1 }}>{ex.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--label3)' }}>{ex.equipment}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!swapSearch && !showAllEx && (
                  <button onClick={() => setShowAllEx(true)}
                    style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 12, padding: '13px', color: 'var(--label2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 2 }}>
                    Browse all exercises
                  </button>
                )}
                {!swapSearch && showAllEx && (() => {
                  const groups = getExercisesByGroup()
                  return (Object.keys(groups) as MuscleGroup[]).map(group => (
                    <div key={group} className="card" style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 600, padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{group}</div>
                      {groups[group].map(ex => (
                        <button key={ex.name} className="list-row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8, opacity: ex.name === currentEx.name ? 0.3 : 1 }}
                          onClick={() => ex.name !== currentEx.name && swapExercise(swapExIdx, ex.name)}>
                          <span style={{ fontSize: 15, flex: 1 }}>{ex.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--label3)' }}>{ex.equipment}</span>
                        </button>
                      ))}
                    </div>
                  ))
                })()}
              </div>
            </div>
          )
        })()}

        {showCoach && <GymChatSheet onClose={() => setShowCoach(false)} />}
      </div>
    )
  }

  // ── IDLE VIEW ──────────────────────────────────────────────────
  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 16 }}>Workout</div>

        {/* ── Today's session ──────────────────────────────────────────
            One thing dominates this screen: starting today. Everything else
            is collapsed behind disclosure. Previously eleven controls stacked
            vertically, all competing for the same attention. */}
        <div style={{ paddingTop: 2 }}>
          <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--label)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Today is {displayDay.toLowerCase()} day
          </div>
          <div style={{ fontSize: 15, color: 'var(--label2)', marginTop: 4 }}>
            {PROGRAM[displayDay].focus}
          </div>
        </div>

        {(() => {
          const day = PROGRAM[displayDay]
          const targets = day.exercises.map((ex, i) =>
            targetFor(ex.name, ex.repRange, ex.restSeconds, i, day.exercises.length, seedLabel(ex), ex.recalibrating))
          // Include the ramp sets - the live header counts them, so the estimate
          // must too or the two screens disagree before you have lifted anything.
          const rampCount = day.exercises.filter(ex => ex.rampUp).length * RAMP_UP_SETS.length
          const totalSets = day.exercises.reduce((a, ex) => a + ex.sets, 0) + rampCount
          // ~40s of working time per set on top of the prescribed rest.
          const estMin = Math.round(
            day.exercises.reduce((a, ex, i) => a + ex.sets * ((targets[i]?.restSeconds ?? 90) + 40), 0) / 60)
          const firstLift = targets[0]?.weight_kg

          return (
            <div style={{
              background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 18,
              padding: 16, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 600, color: 'var(--label)', lineHeight: 1.15 }}>{day.name}</div>
                  <div style={{ fontSize: 14, color: 'var(--label2)', marginTop: 3, lineHeight: 1.35 }}>
                    {day.exercises.slice(0, 4).map(e => e.name.replace(/ \(.*\)$/, '')).join(' \u00b7 ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label3)', fontWeight: 600 }}>SETS</div>
                  <div style={{ fontSize: 34, fontWeight: 600, color: 'var(--label)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalSets}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--separator)', borderRadius: 14, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label3)', fontWeight: 600 }}>EST. TIME</div>
                  <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--label)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{estMin} min</div>
                </div>
                <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--separator)', borderRadius: 14, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label3)', fontWeight: 600 }}>FIRST LIFT</div>
                  <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--label)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                    {firstLift !== undefined ? firstLift + 'kg' : '\u2014'}
                  </div>
                </div>
              </div>

              <button
                onClick={() => startWorkout(day)}
                style={{
                  height: 72, background: 'var(--blue)', border: 'none', borderRadius: 20,
                  color: '#fff', fontSize: 21, fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.01em',
                }}
              >Start {day.name}</button>

              <button
                onClick={() => setOpenSection(s => s === 'more' ? null : 'more')}
                style={{ height: 44, background: 'transparent', border: 'none', color: 'var(--label2)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              >Not today — pick something else</button>
            </div>
          )
        })()}

        {/* ── Progress ─────────────────────────────────────────────── */}
        {(() => {
          const byLift: Record<string, number[]> = {}
          const newest = [...workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))
          for (const w of newest) {
            for (const ex of w.exercises) {
              const top = Math.max(0, ...ex.sets.filter(s => !s.ramp).map(s => s.weight_kg ?? 0))
              if (top <= 0) continue
              if (!byLift[ex.name]) byLift[ex.name] = []
              byLift[ex.name].push(top)
            }
          }
          const trends: LiftTrend[] = Object.keys(byLift).map(name => ({ name, topWeights: byLift[name] }))
          const d = diagnoseProgress(weighIns, trends)
          const strengthPRs = Object.entries(prs).filter(([, pr]) => pr.reps > 0 && pr.reps <= 12)
          const tone = (d.kind === 'eat-more' || d.kind === 'gaining-fast') ? 'var(--orange)' : 'var(--label)'

          return (
            <Section
              title="Progress"
              sub={d.headline}
              open={openSection === 'progress'}
              onToggle={() => setOpenSection(s => s === 'progress' ? null : 'progress')}
            >
              <div style={{ fontSize: 14, color: tone === 'var(--label)' ? 'var(--label2)' : tone, lineHeight: 1.5, marginBottom: 14 }}>{d.detail}</div>
              <ConsistencyCalendar workouts={workouts} />
              {strengthPRs.length > 0 && (
                <>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label3)', fontWeight: 600, margin: '4px 0 8px' }}>PERSONAL RECORDS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {strengthPRs.slice(0, 6).map(([ex, pr]) => (
                      <div key={ex} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ fontSize: 16, color: 'var(--label)', minWidth: 0 }}>{ex}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {pr.weight_kg}kg {'\u00d7'} {pr.reps}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Section>
          )
        })()}

        {/* ── Train something else ─────────────────────────────────── */}
        <Section
          title="Train something else"
          sub="Skill block, custom, paste a routine"
          open={openSection === 'more'}
          onToggle={() => setOpenSection(s => s === 'more' ? null : 'more')}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {ROTATION.map(day => (
              <button
                key={day}
                onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                style={{
                  flex: 1, padding: '10px 4px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: displayDay === day ? 'var(--blue)' : 'var(--bg)',
                  color: displayDay === day ? '#fff' : 'var(--label2)',
                }}
              >{day}</button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {onOpenSkill && (
              <SectionRow name="Skill block" sub="Home · handstand ladder" onClick={onOpenSkill} />
            )}
            <SectionRow name="Custom workout" sub="Build it set by set" onClick={() => startWorkout()} />
            <SectionRow name="Log a past session" sub="Describe it, I'll log the sets" onClick={() => { setShowLog(true); setLogPreview(null) }} />
            <SectionRow name="Paste a routine" sub="Text in, sets out" onClick={() => { setShowImport(true); setImportPreview(null) }} />
            <SectionRow name="Ask the coach" sub="One question about today" onClick={() => setShowCoach(true)} />
          </div>

          {templates.length > 0 && (
            <>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label3)', fontWeight: 600, margin: '16px 0 8px' }}>TEMPLATES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {templates.map(tmpl => (
                  <div key={tmpl.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => startFromTemplate(tmpl)}
                      style={{
                        flex: 1, height: 56, background: 'var(--bg)', border: '1px solid var(--separator)',
                        borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '0 14px', textAlign: 'left', color: 'inherit',
                      }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label)' }}>{tmpl.name}</span>
                      <span style={{ fontSize: 13, color: 'var(--label3)' }}>{tmpl.exercises.length} exercises</span>
                    </button>
                    <button
                      onClick={() => deleteTemplate(tmpl.id)}
                      aria-label="Remove template"
                      style={{ background: 'none', border: 'none', color: 'var(--label3)', cursor: 'pointer', fontSize: 18, padding: '0 6px' }}
                    >×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>


        {/* Recent workouts — only completed sessions (audit P0-5).
            Filter rules:
              • mins > 0  AND
              • at least one set has either reps or weight logged
            so 0-min / 0-kg "drafts" don't pollute the list. */}
        {(() => {
          const completed = [...workouts].reverse().filter(w => {
            const mins = (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000
            const hasAnyLoggedSet = w.exercises.some(ex => ex.sets.some(s => (s.reps ?? 0) > 0 || (s.weight_kg ?? 0) > 0))
            return mins >= 1 && hasAnyLoggedSet
          })
          if (completed.length === 0) return null
          return (
            <>
              <div className="section-label">Recent</div>
              <div className="card">
                {completed.slice(0, 5).map((w, i) => {
                  const start = new Date(w.start_time)
                  const end = new Date(w.end_time)
                  const mins = Math.round((end.getTime() - start.getTime()) / 60000)
                  const vol = w.exercises.reduce((a, ex) => a + ex.sets.reduce((b, s) => b + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0)
                  const isProgramDay = ROTATION.includes(w.title as DayName)
                  return (
                    <div key={w.id || i} className="list-row" style={{ gap: 10 }}>
                    <button
                      onClick={() => loadWorkoutForEdit(w)}
                      title="Tap to edit this workout"
                      style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: 'inherit' }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {w.title}
                        {isProgramDay && <span className="badge badge-blue" style={{ fontSize: 10 }}>{(PROGRAM as Record<string, ProgramDay>)[w.title]?.focus}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
                        {start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {mins} min · {w.exercises.length} exercises · {Math.round(vol).toLocaleString()}kg
                      </div>
                    </button>
                    <button
                      onClick={() => loadWorkoutForEdit(w)}
                      aria-label="Edit workout"
                      style={{ background: 'var(--gray6)', border: 'none', color: 'var(--label2)', cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 14, flexShrink: 0 }}
                    >Edit</button>
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
          )
        })()}

        {workouts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🏋️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label)', marginBottom: 8 }}>
              Start your first workout
            </div>
            <div style={{ fontSize: 14, color: 'var(--label2)', lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>
              Your program is ready above. Tap Begin to start tracking sets, rest timers, and progressive overload.
            </div>
          </div>
        )}
      </div>

      {showCoach && <GymChatSheet onClose={() => setShowCoach(false)} />}

      {postWorkout && (
        <PostWorkoutSheet
          analysis={postWorkout.analysis}
          weeklyVolume={postWorkout.weeklyVolume}
          onClose={() => setPostWorkout(null)}
        />
      )}

      {showLog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'var(--bg, #09090b)', display: 'flex', flexDirection: 'column', padding: 16, animation: 'hhImportIn 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--label)' }}>Log a past session</div>
            <button onClick={() => { setShowLog(false); setLogPreview(null) }} style={{ background: 'var(--card)', border: '1px solid var(--separator)', color: 'var(--label)', borderRadius: 18, padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--label2)', marginBottom: 10, lineHeight: 1.5 }}>
            Describe it however it comes out. Walking a weight down, failing a rep, per-arm sets and swapped machines are all understood.
          </div>
          <textarea value={logText} onChange={e => setLogText(e.target.value)}
            placeholder={'e.g.\nShoulder press, failed on 5 at 32kg, barely 4 on set 2, dropped to 27 for 5\nPec deck 45kg: 19, 16, 10\nCable lateral raise 3.4kg, 10 each arm then 19 then 12\nEnded with ab crunch 20 at 36kg then 15, 15 at 41kg'}
            style={{ width: '100%', minHeight: 150, background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 12, padding: 12, fontSize: 14, color: 'var(--label)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5 }} />
          <button onClick={parseLoggedSession} disabled={!logText.trim() || logBusy}
            style={{ width: '100%', background: 'var(--blue)', border: 'none', color: '#fff', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 10, opacity: (!logText.trim() || logBusy) ? 0.5 : 1 }}>
            {logBusy ? 'Reading...' : 'Read my session'}
          </button>

          {logPreview && (
            <div style={{ marginTop: 16, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)', marginBottom: 8 }}>
                {logPreview.title} &middot; {logPreview.exercises.reduce((a, e) => a + e.sets.length, 0)} sets
              </div>
              <div style={{ fontSize: 12, color: 'var(--label3)', marginBottom: 10, lineHeight: 1.4 }}>
                Check these before saving &mdash; anything wrong here becomes wrong history, and the engine reasons from history.
              </div>
              {logPreview.exercises.map((ex, i) => (
                <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>{ex.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 3 }}>
                    {ex.sets.map((s, j) => (
                      <span key={j}>
                        {j > 0 ? '  \u00b7  ' : ''}
                        {s.weight_kg !== undefined ? s.weight_kg + 'kg \u00d7 ' : ''}{s.reps}
                        {s.rir !== undefined ? ' (RIR ' + s.rir + ')' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={saveLoggedSession} disabled={logBusy}
                style={{ width: '100%', background: 'var(--green)', border: 'none', color: '#fff', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, marginBottom: 24, opacity: logBusy ? 0.5 : 1 }}>
                {logBusy ? 'Saving...' : 'Log this session'}
              </button>
            </div>
          )}
        </div>
      )}

      {showImport && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'var(--bg, #09090b)', display: 'flex', flexDirection: 'column', padding: 16, animation: 'hhImportIn 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
          <style>{'@keyframes hhImportIn { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: none } }'}</style>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--label)' }}>📋 Import a routine</div>
            <button onClick={() => { setShowImport(false); setImportPreview(null) }} style={{ background: 'var(--card)', border: '1px solid var(--separator)', color: 'var(--label)', borderRadius: 18, padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--label2)', marginBottom: 10, lineHeight: 1.5 }}>Paste a routine from ChatGPT, a website, or your notes — I'll turn it into a tracked workout that adapts to your eating + history.</div>
          <textarea value={importText} onChange={e => setImportText(e.target.value)}
            placeholder={'e.g.\nPush Day\nBench Press 4x6-8\nIncline DB Press 3x10-12\nLateral Raises 3x15\nTricep Pushdown 3x12'}
            style={{ width: '100%', minHeight: 130, background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 12, padding: 12, fontSize: 14, color: 'var(--label)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={parseImport} disabled={!importText.trim() || importBusy}
            style={{ width: '100%', background: 'var(--blue)', border: 'none', color: '#fff', borderRadius: 12, padding: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 10, opacity: (!importText.trim() || importBusy) ? 0.5 : 1 }}>
            {importBusy ? 'Reading…' : 'Parse routine'}
          </button>

          {importPreview && (
            <div style={{ marginTop: 16, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)', marginBottom: 8 }}>{importPreview.title} · {importPreview.exercises.length} exercises</div>
              {importPreview.exercises.map((ex, i) => (
                <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>{ex.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--label2)' }}>{ex.sets}×{ex.repRange} · {ex.restSeconds}s rest · RIR {ex.rir}</div>
                </div>
              ))}
              <button onClick={() => startFromRoutine(importPreview)}
                style={{ width: '100%', background: 'var(--green)', border: 'none', color: '#fff', borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, marginBottom: 24 }}>
                Start this workout →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
