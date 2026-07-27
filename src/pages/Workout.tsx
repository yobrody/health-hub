import { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../api/client'
import type { WorkoutData, ExerciseSet, ParsedRoutine } from '../api/client'
import { showToast } from '../toast'
import { GymChatSheet } from '../components/GymChatSheet'
import { PROGRAM, ROTATION, getNextDay, rirFor, seedLabel } from '../program'
import type { DayName, ProgramDay, ExerciseSwap } from '../program'
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
import { genericIncrement } from '../lib/gym-equipment'
import { searchExerciseDB, getExercisesByGroup, findExercise } from '../lib/exercises'
import type { MuscleGroup } from '../lib/exercises'

interface LiveSet extends ExerciseSet { done: boolean; rir?: number }

// Effort tiers the user taps during rest → reps-in-reserve. Beginner-friendly:
// they report how it FELT, not what's "correct".
const TIER_RIR: Record<'easy' | 'good' | 'hard' | 'fail', number> = { easy: 4, good: 2, hard: 1, fail: 0 }
const TIER_LABEL: Array<['easy' | 'good' | 'hard' | 'fail', string]> = [
  ['easy', 'Too easy'], ['good', 'Just right'], ['hard', 'Hard'], ['fail', "Couldn't finish"],
]
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
  const [remaining, setRemaining] = useState(seconds)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    if (remaining <= 0) { onCompleteRef.current(); return }
    if (remaining % 15 === 0 && remaining < seconds && navigator.vibrate) navigator.vibrate(30)
    // Tick faster in the final 3 seconds for tension
    const interval = remaining <= 3 ? 100 : 1000
    const decrement = remaining <= 3 ? 0.1 : 1
    const t = setTimeout(() => setRemaining(r => Math.max(0, parseFloat((r - decrement).toFixed(1)))), interval)
    return () => clearTimeout(t)
  }, [remaining, seconds])

  useEffect(() => {
    if (remaining === 0 && navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200])
  }, [remaining])

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
  onWeight, onReps, onSubmit, onSwipe, repsInputRef, reason, stackUp, stackDown,
}: {
  accent: string
  exerciseName: string
  setNumber: number
  totalSets: number
  weight: number | undefined
  reps: number | undefined
  isDone: boolean
  reason?: string
  stackUp?: number
  stackDown?: number
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

      {/* Weight pill — tap to expand +/- controls. Calm chips, no glass blur. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
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
      </div>

      {reason && !isDone && (
        <div style={{ fontSize: 13, color: 'var(--label2)', textAlign: 'center', lineHeight: 1.45, margin: '-4px 0 16px', padding: '0 6px' }}>
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
        <div style={{
          background: 'rgba(52,199,89,0.12)', color: 'var(--green)',
          borderRadius: 16, padding: '14px', textAlign: 'center', fontSize: 15, fontWeight: 700,
        }}>Logged · rest now</div>
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

// Program day card for the idle screen
function DayCard({ day, isNext, onStart, targets }: { day: ProgramDay; isNext: boolean; onStart: () => void; targets?: DecisionResult[] }) {
  return (
    <div style={{
      background: isNext ? 'var(--blue)' : 'var(--card)',
      borderRadius: 16, padding: '16px 16px 12px',
      border: isNext ? 'none' : '1px solid var(--separator)',
    }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: isNext ? '#fff' : 'var(--label)' }}>{day.name}</div>
        <div style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.75)' : 'var(--label2)', marginTop: 2 }}>{day.focus}</div>
        {isNext && targets && targets.some(t => t.weight_kg != null) && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>↻ Weights &amp; reps tuned to your eating + recent sessions</div>
        )}
      </div>
      {day.skill.length > 0 && (
        <div style={{ fontSize: 12, color: isNext ? 'rgba(255,255,255,0.7)' : 'var(--label3)', marginBottom: 6, fontStyle: 'italic' }}>
          Skill block first · {day.skill.map(s => s.name).join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: isNext ? 12 : 0 }}>
        {day.exercises.slice(0, 4).map((ex, i) => {
          const t = targets?.[i]
          return (
            <div key={i} style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.8)' : 'var(--label2)' }}>
              {ex.sets}×{ex.repRange} {ex.name}
              {t?.weight_kg != null ? (
                <span style={{ color: isNext ? 'rgba(255,255,255,0.55)' : 'var(--label3)', fontSize: 12 }}> · {t.weight_kg}kg{t.repsTarget != null ? ` × ${t.repsTarget}` : ''}</span>
              ) : seedLabel(ex) ? (
                <span style={{ color: isNext ? 'rgba(255,255,255,0.55)' : 'var(--label3)', fontSize: 12 }}> · {seedLabel(ex)}</span>
              ) : null}
            </div>
          )
        })}
        {day.exercises.length > 4 && (
          <div style={{ fontSize: 12, color: isNext ? 'rgba(255,255,255,0.55)' : 'var(--label3)', marginTop: 2 }}>
            +{day.exercises.length - 4} more exercises
          </div>
        )}
      </div>
      {/* Begin button at thumb-bottom (audit P1-10). Was at top-right of the
          card, far from the exercise list — eye flow on a phone read awkward. */}
      {isNext && (
        <button
          onClick={onStart}
          style={{
            width: '100%', marginTop: 4,
            background: 'rgba(255,255,255,0.95)',
            color: 'var(--blue)', border: 'none', borderRadius: 12,
            padding: '11px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}
        >Begin</button>
      )}
      {!isNext && (
        <button
          onClick={onStart}
          style={{
            background: 'none', color: 'var(--blue)', border: 'none',
            padding: '6px 0 0 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >Start →</button>
      )}
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
  const [showSwap, setShowSwap] = useState(false)
  const [swapExIdx, setSwapExIdx] = useState<number | null>(null)
  const [swapSearch, setSwapSearch] = useState('')
  const [swapResults, setSwapResults] = useState<string[]>([])
  const [templates, setTemplates] = useState<WorkoutTemplate[]>(loadTemplates)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showCoach, setShowCoach] = useState(false)
  // Paste-a-routine importer state.
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<ParsedRoutine | null>(null)
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
      .catch(() => { setProperlyEating(false) })
  }, [])

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
  function targetFor(exerciseName: string, repRange: string | null | undefined, restSeconds: number | undefined, positionInSession: number, totalExercises: number, startingWeight?: string, recalibrating?: boolean): DecisionResult {
    const pr = prs[exerciseName]
    const hist = historyByExercise[exerciseName] ?? []
    const prevSets = hist[0]?.sets
    const priorSets = hist[1]?.sets
    const daysSinceLast = hist[0]
      ? Math.floor((Date.now() - new Date(hist[0].date).getTime()) / 86400000)
      : null
    const lastSessionRIR = lastRirOf(hist[0]?.sets)
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
        const sets: LiveSet[] = Array.from({ length: ex.sets }, () => ({
          weight_kg: t.weight_kg,
          reps: t.repsTarget,
          done: false,
        }))
        return { name: ex.name, sets, prevBest: pr, repRange: ex.repRange, rir: rirFor(ex.lift), restSeconds: ex.restSeconds, notes: ex.notes, swaps: ex.swaps, reason: t.notes[0], stackUp: t.weightUp, stackDown: t.weightDown }
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

  // Record how a set felt, then SELF-CORRECT the remaining sets of this
  // exercise: too easy → nudge weight up; couldn't finish → ease it down. The
  // reps you log also feed next session's progression. No expertise needed —
  // you just say how it felt.
  function applySetFeedback(exIdx: number, setIdx: number, tier: 'easy' | 'good' | 'hard' | 'fail') {
    setLive(w => {
      if (!w) return w
      const exercises = w.exercises.map((ex, ei) => {
        if (ei !== exIdx) return ex
        const sets = ex.sets.map((s, si) => si === setIdx ? { ...s, rir: TIER_RIR[tier] } : s)
        const doneWeight = sets[setIdx].weight_kg
        if (doneWeight != null && doneWeight > 0 && (tier === 'easy' || tier === 'fail')) {
          const inc = genericIncrement(doneWeight)
          const adj = tier === 'easy'
            ? Math.round((doneWeight + inc) * 100) / 100
            : Math.max(0, Math.round((doneWeight - inc) * 100) / 100)
          for (let si = setIdx + 1; si < sets.length; si++) {
            if (!sets[si].done) sets[si] = { ...sets[si], weight_kg: adj }
          }
        }
        return { ...ex, sets }
      })
      return { ...w, exercises }
    })
    if (navigator.vibrate) navigator.vibrate(12)
    if (tier === 'easy') showToast('Nudged the next sets up a touch 💪')
    else if (tier === 'fail') showToast('Eased the next sets down — keep good form')
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
        setPhase('rest')
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
                  onClick={() => { setSwapExIdx(focusExIdx); setShowSwap(true); setSwapSearch(''); setSwapResults([]) }}
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
                  reason={focusEx.reason}
                  stackUp={focusEx.stackUp}
                  stackDown={focusEx.stackDown}
                  onWeight={(v) => updateSet(focusExIdx, focusSetIdx, 'weight_kg', v)}
                  onReps={(v) => updateSet(focusExIdx, focusSetIdx, 'reps', v)}
                  onSubmit={submitCurrentSet}
                  onSwipe={handleSwipe}
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
                    return (
                      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--separator)', textAlign: 'left' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label)' }}>How did that set feel?</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 12 }}>{doneEx.name} · Set {fromSetIdx + 1}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 14 }}>
                          <button onClick={() => adjustDoneReps(fromExIdx, fromSetIdx, -1)} style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--separator)', background: 'var(--card)', color: 'var(--label)', fontSize: 22, cursor: 'pointer' }}>−</button>
                          <div style={{ textAlign: 'center', minWidth: 72 }}>
                            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--label)' }}>{doneSet.reps ?? 0}</div>
                            <div style={{ fontSize: 11, color: 'var(--label2)' }}>reps done</div>
                          </div>
                          <button onClick={() => adjustDoneReps(fromExIdx, fromSetIdx, 1)} style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--separator)', background: 'var(--card)', color: 'var(--label)', fontSize: 22, cursor: 'pointer' }}>+</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {TIER_LABEL.map(([k, label]) => (
                            <button key={k} onClick={() => applySetFeedback(fromExIdx, fromSetIdx, k)}
                              style={{ flex: 1, padding: '10px 2px', borderRadius: 10, border: '1px solid ' + (doneSet.rir === TIER_RIR[k] ? 'var(--blue)' : 'var(--separator)'), background: doneSet.rir === TIER_RIR[k] ? 'var(--blue)' : 'var(--card)', color: doneSet.rir === TIER_RIR[k] ? '#fff' : 'var(--label)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
                          ))}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--label3)', marginTop: 8, textAlign: 'center', fontStyle: 'italic' }}>Aim to stop with ~2 good reps left in the tank.</div>
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
                        onClick={() => { setSwapExIdx(exIdx); setShowSwap(true); setSwapSearch(''); setSwapResults([]) }}
                        aria-label="Swap exercise"
                        title="Swap this exercise for another"
                        style={{ background: 'var(--gray6)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: 'pointer', color: 'var(--label)' }}
                      >⇄</button>
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
                  <button onClick={() => { setShowSwap(false); setSwapSearch(''); setSwapResults([]) }} className="sheet-close">×</button>
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
                {!swapSearch && (() => {
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

        {/* Templates — saved workout templates */}
        {templates.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>Templates</div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
              {templates.map(tmpl => (
                <div
                  key={tmpl.id}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--separator)',
                    borderRadius: 14, padding: '12px 14px', minWidth: 140, flexShrink: 0,
                    position: 'relative',
                  }}
                >
                  <button
                    onClick={() => startFromTemplate(tmpl)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', color: 'inherit', width: '100%' }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, paddingRight: 20 }}>{tmpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--label2)' }}>
                      {tmpl.exercises.length} exercises
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--label3)', marginTop: 2 }}>
                      {tmpl.exercises.slice(0, 2).map(e => e.name).join(', ')}{tmpl.exercises.length > 2 ? '...' : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteTemplate(tmpl.id)}
                    aria-label="Remove template"
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      background: 'none', border: 'none', color: 'var(--label3)',
                      cursor: 'pointer', fontSize: 16, padding: '2px 4px',
                    }}
                  >x</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Next up — big card */}
        <div className="section-label" style={{ marginTop: 0 }}>Next up</div>
        <DayCard
          day={PROGRAM[displayDay]}
          isNext={true}
          onStart={() => startWorkout(PROGRAM[displayDay])}
          targets={PROGRAM[displayDay].exercises.map((ex, i) => targetFor(ex.name, ex.repRange, ex.restSeconds, i, PROGRAM[displayDay].exercises.length, seedLabel(ex), ex.recalibrating))}
        />

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

        <button
          onClick={() => { setShowImport(true); setImportPreview(null) }}
          style={{ width: '100%', background: 'none', border: '1.5px dashed var(--gray4)', borderRadius: 14, padding: '13px', color: 'var(--label2)', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >📋 Paste a routine</button>

        {/* Consistency calendar — last 8 weeks at a glance. Each cell is a day,
            filled if a workout was logged. Reads from the loaded workouts list,
            no extra fetch. Brody asked for "see your consistency". */}
        <ConsistencyCalendar workouts={workouts} />

        {/* In-gym AI coach: ask about a machine, get it slotted into the program. */}
        <button
          onClick={() => setShowCoach(true)}
          style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 14, padding: '13px', color: 'var(--label)', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 12, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >🏋️ Ask the gym coach</button>

        {/* PRs — strength PRs only (audit P2-5). Bodybuilding strength PRs
            sit in the 1–12 rep range; over 15 reps is endurance not strength
            and was previously shown as e.g. "20kg × 50" PR which read as a
            mistake. We filter here rather than in the backend so the data
            stays intact for future endurance/volume views. */}
        {(() => {
          const strengthPRs = Object.entries(prs).filter(([, pr]) => pr.reps > 0 && pr.reps <= 12)
          if (strengthPRs.length === 0) return null
          return (
            <>
              <div className="section-label">Personal Records</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {strengthPRs.slice(0, 6).map(([ex, pr]) => (
                  <div key={ex} style={{ background: 'var(--card)', borderRadius: 12, padding: '10px 14px', minWidth: 140, flex: '1 1 140px' }}>
                    <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{ex}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{pr.weight_kg}kg <span style={{ fontSize: 14, fontWeight: 400 }}>× {pr.reps}</span></div>
                    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: '#B8860B', background: '#FFD70033', borderRadius: 8, padding: '2px 7px', display: 'inline-block' }}>PR</div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}

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
