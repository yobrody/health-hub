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
import { decideNextSet, type DecisionResult } from '../lib/gym-decision'
import {
  learnFromLogs, resolveEquipment, nextUpWeight, nextDownWeight,
  genericIncrement,
} from '../lib/gym-equipment'
import { weeklyVolumeByMuscle } from '../lib/gym-muscles'
import { analyzeWorkout, type WorkoutAnalysis } from '../lib/gym-analysis'
import { MuscleVolumeCard } from '../components/MuscleVolumeCard'
import { PostWorkoutSheet } from '../components/PostWorkoutSheet'
import { GymChatSheet } from '../components/GymChatSheet'

interface LiveSet extends ExerciseSet { done: boolean }
type ExStatus = 'pending' | 'active' | 'done' | 'skipped'
interface LiveExercise {
  name: string
  sets: LiveSet[]
  prevBest?: { weight_kg: number; reps: number }
  // Program guidance
  repRange?: string
  rir?: string
  restSeconds?: number
  notes?: string
  // Skip & come back state
  status?: ExStatus
  // Per-set RIR captured after submit, used to drive the rest modifier on the
  // *next* set's decision.
  lastSetRIR?: number | null
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
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, color: 'var(--label)' }}>
        {mins}:{secs}
      </div>
      <div style={{ height: 4, background: 'var(--gray5)', borderRadius: 2, overflow: 'hidden', maxWidth: 220, margin: '12px auto 0' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: 'var(--blue)', borderRadius: 2, transition: 'width 1s linear' }} />
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
  weightDown, weightUp, weightSource,
  onWeight, onReps, onSubmit, onSwipe, repsInputRef,
}: {
  accent: string
  exerciseName: string
  setNumber: number
  totalSets: number
  weight: number | undefined
  reps: number | undefined
  isDone: boolean
  weightDown: number | undefined
  weightUp: number | undefined
  weightSource: DecisionResult['weightSource']
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

  // Tiny label for the source of the suggested stack — helps Brody trust the
  // numbers ("seed" = factory default, "learned" = inferred from his own logs).
  const sourceLabel: Record<DecisionResult['weightSource'], string | null> = {
    manual: 'Manual', learned: 'Learned', seed: 'Standard', generic: null, none: null,
  }
  const sourceText = sourceLabel[weightSource]

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

      {/* Weight controls — stack-aware. Tap the down/up chips to jump to the
          next valid plate or pin position for THIS machine. The centre pill
          shows the current value and opens a manual editor for unusual jumps. */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <button
          onClick={() => weightDown !== undefined && onWeight(weightDown)}
          disabled={weightDown === undefined || weightDown === weight}
          aria-label="Next lighter weight"
          style={{
            background: 'var(--gray6)', border: '1px solid var(--separator)', borderRadius: 18,
            padding: '8px 14px', fontSize: 14, fontWeight: 600, color: weightDown === undefined ? 'var(--label3)' : 'var(--label)',
            cursor: weightDown === undefined ? 'default' : 'pointer',
            minWidth: 64,
          }}
        >−{weightDown !== undefined && weight !== undefined ? `${(weight - weightDown).toFixed(2).replace(/\.?0+$/, '')}` : ''}<br/><span style={{ fontSize: 11, color: 'var(--label2)' }}>{weightDown !== undefined ? `${weightDown}kg` : '—'}</span></button>

        {!showWeightEdit ? (
          <button
            onClick={() => setShowWeightEdit(true)}
            style={{
              background: 'var(--blue)', border: 'none', borderRadius: 22,
              color: '#fff', padding: '11px 20px', fontSize: 17, fontWeight: 700,
              cursor: 'pointer', minWidth: 92,
            }}
          >{weight !== undefined ? `${weight}kg` : 'Set'}</button>
        ) : (
          <input
            type="number" inputMode="decimal"
            autoFocus
            value={weight ?? ''}
            onChange={e => { const v = e.target.value; onWeight(v === '' ? undefined : parseFloat(v)) }}
            onBlur={() => setShowWeightEdit(false)}
            onKeyDown={e => { if (e.key === 'Enter') setShowWeightEdit(false) }}
            style={{ width: 92, background: 'var(--card)', border: '1px solid var(--blue)', borderRadius: 22, outline: 'none', fontSize: 17, fontWeight: 700, textAlign: 'center', color: 'var(--label)', height: 42 }}
            placeholder="kg"
          />
        )}

        <button
          onClick={() => weightUp !== undefined && onWeight(weightUp)}
          disabled={weightUp === undefined || weightUp === weight}
          aria-label="Next heavier weight"
          style={{
            background: 'var(--gray6)', border: '1px solid var(--separator)', borderRadius: 18,
            padding: '8px 14px', fontSize: 14, fontWeight: 600, color: weightUp === undefined ? 'var(--label3)' : 'var(--label)',
            cursor: weightUp === undefined ? 'default' : 'pointer',
            minWidth: 64,
          }}
        >+{weightUp !== undefined && weight !== undefined ? `${(weightUp - weight).toFixed(2).replace(/\.?0+$/, '')}` : ''}<br/><span style={{ fontSize: 11, color: 'var(--label2)' }}>{weightUp !== undefined ? `${weightUp}kg` : '—'}</span></button>
      </div>
      {sourceText && (
        <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--label3)', letterSpacing: 0.6, marginBottom: 14, textTransform: 'uppercase' }}>{sourceText} stack</div>
      )}
      {!sourceText && <div style={{ marginBottom: 14 }} />}

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
function DayCard({ day, isNext, onStart }: { day: ProgramDay; isNext: boolean; onStart: () => void }) {
  return (
    <div style={{
      background: isNext ? 'var(--blue)' : 'var(--card)',
      borderRadius: 16, padding: '16px 16px 12px',
      border: isNext ? 'none' : '1px solid var(--separator)',
    }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: isNext ? '#fff' : 'var(--label)' }}>{day.name}</div>
        <div style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.75)' : 'var(--label2)', marginTop: 2 }}>{day.focus}</div>
      </div>
      {day.warmup && (
        <div style={{ fontSize: 12, color: isNext ? 'rgba(255,255,255,0.7)' : 'var(--label3)', marginBottom: 6, fontStyle: 'italic' }}>
          Warm-up: {day.warmup}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: isNext ? 12 : 0 }}>
        {day.exercises.slice(0, 4).map((ex, i) => (
          <div key={i} style={{ fontSize: 13, color: isNext ? 'rgba(255,255,255,0.8)' : 'var(--label2)' }}>
            {ex.sets}×{ex.repRange} {ex.name}
            {ex.startingWeight && (
              <span style={{ color: isNext ? 'rgba(255,255,255,0.55)' : 'var(--label3)', fontSize: 12 }}> · {ex.startingWeight}</span>
            )}
          </div>
        ))}
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
  const [showChat, setShowChat] = useState(false)
  const [postWorkoutAnalysis, setPostWorkoutAnalysis] = useState<WorkoutAnalysis | null>(null)
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
      // Run learning pass over history once at session start so the equipment
      // resolver picks up Brody's actual stack patterns for the session.
      learnFromLogs(workouts)
      const totalEx = day.exercises.length
      const exercises: LiveExercise[] = day.exercises.map((ex, idx) => {
        const pr = prs[ex.name]
        const prevSets = lastSetsByExercise[ex.name]
        const decision = decideNextSet({
          exerciseName: ex.name,
          prevBest: pr ? { weight_kg: pr.weight_kg, reps: pr.reps } : null,
          prevSets,
          repRange: ex.repRange,
          programRestSeconds: ex.restSeconds,
          diet: { properlyEating },
          session: { positionInSession: idx, totalExercises: totalEx, sessionVolumeSoFar: 0 },
          isFirstSet: true,
        })
        const sets: LiveSet[] = Array.from({ length: ex.sets }, () => ({
          weight_kg: decision.weight_kg,
          reps: decision.repsTarget,
          done: false,
        }))
        return {
          name: ex.name, sets,
          prevBest: pr,
          repRange: ex.repRange, rir: ex.rir,
          restSeconds: decision.restSeconds,
          notes: ex.notes, status: 'pending',
        }
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
    if (!live) return
    const ex = live.exercises[exIdx]
    // Run the decision engine *now* with the just-finished set's data so the
    // rest timer reflects the actual fatigue / load / RIR signals.
    const sessionVolumeSoFar = live.exercises.reduce((acc, e, i) => {
      return acc + e.sets.reduce((a, s, j) => {
        // Include the set we just completed
        const include = s.done || (i === exIdx && j === setIdx)
        return include ? a + (s.weight_kg ?? 0) * (s.reps ?? 0) : a
      }, 0)
    }, 0)
    const totalActive = live.exercises.filter(e => e.status !== 'skipped').length
    const decision = decideNextSet({
      exerciseName: ex.name,
      prevBest: ex.prevBest ?? null,
      prevSets: lastSetsByExercise[ex.name],
      repRange: ex.repRange,
      programRestSeconds: ex.restSeconds,
      diet: { properlyEating },
      session: { positionInSession: exIdx, totalExercises: totalActive, sessionVolumeSoFar },
      // RIR derived from "did the user hit the rep range top?" — heuristic for
      // now since we don't ask explicitly. Will refine when we add a quick
      // RIR-tap UI on submit.
      lastSetRIR: heuristicRIR(ex.sets[setIdx], ex.repRange),
    })
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], done: true }
      exercises[exIdx] = { ...exercises[exIdx], sets, lastSetRIR: heuristicRIR(sets[setIdx], exercises[exIdx].repRange) }
      return { ...w, exercises }
    })
    setRestTimer({ seconds: decision.restSeconds })
    if (navigator.vibrate) navigator.vibrate([10, 10, 30])
  }

  // Heuristic RIR from achieved reps vs the program rep range. Reps at or
  // above range.max → ~RIR 0-1 (close to failure if Brody hit the cap clean);
  // mid-range → RIR 2; below min → RIR 3+ (left a lot in the tank, weight
  // probably too light). Imperfect but better than nothing as a rest signal.
  function heuristicRIR(set: LiveSet, repRange?: string): number | null {
    if (!set.reps || set.reps <= 0) return null
    const m = (repRange ?? '').match(/(\d+)\s*[-–—]\s*(\d+)/)
    if (!m) return null
    const min = parseInt(m[1], 10), max = parseInt(m[2], 10)
    if (set.reps >= max) return 1
    if (set.reps < min) return 3
    return 2
  }

  function skipExercise(exIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      exercises[exIdx] = { ...exercises[exIdx], status: 'skipped' }
      return { ...w, exercises }
    })
    // Advance focus to the next non-skipped, non-done set.
    const next = findFirstPending(live, exIdx + 1)
    if (next) {
      setFocusExIdx(next.exerciseIdx)
      setFocusSetIdx(next.setIdx)
      setPhase('active')
    }
    if (navigator.vibrate) navigator.vibrate(20)
  }

  function resumeExercise(exIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      exercises[exIdx] = { ...exercises[exIdx], status: 'pending' }
      return { ...w, exercises }
    })
    setFocusExIdx(exIdx)
    // Land on first not-yet-done set
    const ex = live?.exercises[exIdx]
    const firstNotDone = ex?.sets.findIndex(s => !s.done) ?? 0
    setFocusSetIdx(firstNotDone < 0 ? 0 : firstNotDone)
    setPhase('active')
    if (navigator.vibrate) navigator.vibrate(15)
  }

  // Find the first pending (not-skipped) exercise + set starting from exIdx
  function findFirstPending(w: LiveWorkout | null, fromIdx = 0): { exerciseIdx: number; setIdx: number } | null {
    if (!w) return null
    for (let i = fromIdx; i < w.exercises.length; i++) {
      if (w.exercises[i].status === 'skipped') continue
      const setIdx = w.exercises[i].sets.findIndex(s => !s.done)
      if (setIdx >= 0) return { exerciseIdx: i, setIdx }
    }
    return null
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
    let savedWorkoutId: string | null = null
    if (live.editingId) {
      await api.updateWorkout(live.editingId, payload)
      savedWorkoutId = live.editingId
    } else {
      const saved = await api.saveWorkout(payload) as { id?: string } | undefined
      savedWorkoutId = saved?.id ?? null
    }
    const [updated, updatedPRs] = await Promise.all([api.getWorkouts(20), api.getPRs()])
    setWorkouts(updated)
    setPRs(updatedPRs)
    if (!live.editingId) publishCoachFeed(live)

    // Refresh learned catalog from history so future predictions tighten.
    learnFromLogs(updated)

    // Compute post-workout analysis on the freshly saved record. We look it up
    // by id; fallback to start_time match for older API responses without id.
    const justSaved = updated.find(w => w.id === savedWorkoutId)
      ?? updated.find(w => w.start_time === payload.start_time && w.title === payload.title)
    if (justSaved && !live.editingId) {
      const analysis = analyzeWorkout(
        justSaved,
        updated.filter(w => w.id !== justSaved.id),
        // PR map without the lift's own most recent set so isWeightPR works
        // against the prior best, not today's. The /prs endpoint already does
        // this — it's snapshot-as-of-start.
        prs,
      )
      setPostWorkoutAnalysis(analysis)
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

          {/* ── Coming-back tray — exercises previously skipped, tap to resume ── */}
          {(() => {
            const skipped = liveNonNull.exercises
              .map((ex, i) => ({ ex, i }))
              .filter(({ ex }) => ex.status === 'skipped')
            if (skipped.length === 0) return null
            return (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--label3)', alignSelf: 'center', flexShrink: 0, padding: '0 4px' }}>Come back to</div>
                {skipped.map(({ ex, i }) => (
                  <button
                    key={i}
                    onClick={() => resumeExercise(i)}
                    style={{ flexShrink: 0, background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 14, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
                  >{ex.name} ↻</button>
                ))}
              </div>
            )
          })()}

          {/* ── ACTIVE: hero card with exercise visual + reps focus ── */}
          {phase === 'active' && focusEx && focusSet && (() => {
            const isThisSetDone = focusSet.done
            const accent = getExerciseAccent(focusEx.name)
            // Synced decision for the *current* set — gives us next-up/next-down
            // weights, suggested reps target, and rest seconds. Modifiers fluctuate
            // based on session position, fatigue, last-set RIR, and diet.
            const sessionVolumeSoFar = liveNonNull.exercises.reduce((acc, ex) => {
              return acc + ex.sets.reduce((a, s) => s.done ? a + (s.weight_kg ?? 0) * (s.reps ?? 0) : a, 0)
            }, 0)
            const totalActive = liveNonNull.exercises.filter(e => e.status !== 'skipped').length
            const decision = decideNextSet({
              exerciseName: focusEx.name,
              prevBest: focusEx.prevBest ?? null,
              prevSets: lastSetsByExercise[focusEx.name],
              repRange: focusEx.repRange,
              programRestSeconds: focusEx.restSeconds,
              diet: { properlyEating },
              session: { positionInSession: focusExIdx, totalExercises: totalActive, sessionVolumeSoFar },
              lastSetRIR: focusSetIdx > 0 ? focusEx.lastSetRIR ?? null : null,
              isFirstSet: focusSetIdx === 0,
            })
            const handleSwipe = (dx: number) => {
              if (dx < -80 && !isThisSetDone && (focusSet.reps ?? 0) > 0) {
                submitCurrentSet()
              }
            }
            return (
              <>
                {/* Bracket the next-up / next-down RELATIVE to whatever the
                    user is currently looking at, not the engine's prediction.
                    Otherwise, after one manual bump the +/- chips go stale and
                    you see "+0 → same weight" because the bracket was anchored
                    to the original prediction. */}
                {(() => {
                  const eff = resolveEquipment(focusEx.name)
                  const liveWeight = focusSet.weight_kg ?? decision.weight_kg
                  let liveDown: number | undefined = decision.weightDown
                  let liveUp: number | undefined = decision.weightUp
                  if (liveWeight !== undefined) {
                    if (eff.effectiveStack) {
                      liveDown = nextDownWeight(eff.effectiveStack, liveWeight)
                      liveUp = nextUpWeight(eff.effectiveStack, liveWeight)
                    } else {
                      const inc = genericIncrement(liveWeight)
                      liveDown = Math.max(0, Math.round((liveWeight - inc) * 4) / 4)
                      liveUp = Math.round((liveWeight + inc) * 4) / 4
                    }
                  }
                  return (
                <ActiveSetCard
                  key={`${focusExIdx}-${focusSetIdx}`}
                  accent={accent}
                  exerciseName={focusEx.name}
                  setNumber={focusSetIdx + 1}
                  totalSets={focusEx.sets.length}
                  weight={liveWeight}
                  reps={focusSet.reps ?? decision.repsTarget}
                  isDone={isThisSetDone}
                  weightDown={liveDown}
                  weightUp={liveUp}
                  weightSource={decision.weightSource}
                  onWeight={(v) => updateSet(focusExIdx, focusSetIdx, 'weight_kg', v)}
                  onReps={(v) => updateSet(focusExIdx, focusSetIdx, 'reps', v)}
                  onSubmit={submitCurrentSet}
                  onSwipe={handleSwipe}
                  repsInputRef={repsInputRef}
                />
                  )
                })()}
                {/* Programme guidance + live modifier notes — moved out of the
                    active card so the card stays focused on the inputs. */}
                {(focusEx.repRange || focusEx.rir || focusEx.prevBest || decision.notes.length > 0) && (
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
                    <span style={{ background: 'var(--card)', borderRadius: 8, padding: '5px 10px', fontWeight: 600 }}>
                      Rest {decision.restSeconds}s
                    </span>
                    {decision.notes.slice(0, 2).map((n, i) => (
                      <span key={i} style={{ background: 'rgba(0,122,255,0.10)', color: 'var(--blue)', borderRadius: 8, padding: '5px 10px', fontWeight: 600 }}>{n}</span>
                    ))}
                  </div>
                )}
                {/* Skip — moves this exercise to the "Coming back" tray. */}
                <button
                  onClick={() => skipExercise(focusExIdx)}
                  style={{ width: '100%', background: 'none', border: '1px dashed var(--gray4)', borderRadius: 12, padding: '10px', color: 'var(--label2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 10 }}
                >Machine busy · skip and come back</button>
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
                >{finishing ? 'Saving…' : 'Save workout'}</button>
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

        {/* Floating Coach button — same as idle view but visible during workouts. */}
        <button
          onClick={() => setShowChat(true)}
          style={{
            position: 'fixed', right: 14, bottom: 'calc(110px + var(--safe-bottom))',
            background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 28,
            padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,122,255,0.35)', zIndex: 50,
          }}
          aria-label="Ask coach"
        >Ask coach</button>

        {showChat && <GymChatSheet onClose={() => setShowChat(false)} />}

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

        {/* Consistency calendar — last 8 weeks at a glance. Each cell is a day,
            filled if a workout was logged. Reads from the loaded workouts list,
            no extra fetch. Brody asked for "see your consistency". */}
        <ConsistencyCalendar workouts={workouts} />

        {/* Muscle volume — 7-day per-muscle bar chart vs MEV/MAV/MRV. Shows the
            user where they're undertrained, on target, or pushing toward MRV. */}
        <div className="section-label">Volume this week</div>
        <MuscleVolumeCard workouts={workouts} />

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
          <div style={{ textAlign: 'center', padding: '24px 24px', color: 'var(--label2)' }}>
            <div style={{ fontSize: 14 }}>Tap Begin above to start your first session</div>
          </div>
        )}
      </div>

      {/* Floating Coach button — opens the in-gym chat sheet. */}
      <button
        onClick={() => setShowChat(true)}
        style={{
          position: 'fixed', right: 14, bottom: 'calc(110px + var(--safe-bottom))',
          background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 28,
          padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,122,255,0.35)', zIndex: 50,
        }}
        aria-label="Ask coach"
      >Ask coach</button>

      {showChat && <GymChatSheet onClose={() => setShowChat(false)} />}
      {postWorkoutAnalysis && (
        <PostWorkoutSheet
          analysis={postWorkoutAnalysis}
          weeklyVolume={weeklyVolumeByMuscle(workouts, 7).map(v => ({ muscle: v.muscle, sets: v.sets }))}
          onClose={() => setPostWorkoutAnalysis(null)}
        />
      )}
    </div>
  )
}
