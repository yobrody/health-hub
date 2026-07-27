// Post-workout analysis — pure local computation. No AI needed for any of
// this; the "Generate insights" button is just a narrative wrapper on top.
//
// Score 0-100 from four sub-scores:
//   • completion (40%)   — how much of the planned work got done
//   • progress (25%)     — volume vs last comparable session
//   • intensity (20%)    — sets at the top of the rep range
//   • consistency (15%)  — gap from previous session, weekly cadence

import type { WorkoutData, ExerciseData, ExerciseSet, PR } from '../api/client'
import { tagExercise, type MuscleGroup } from './gym-muscles'
import { parseRepRange } from './workout-progression'
import { PROGRAM, ROTATION, type DayName } from '../program'

export interface PRHit {
  exerciseName: string
  newWeight_kg: number
  newReps: number
  prevWeight_kg?: number
  prevReps?: number
  /** True iff weight beat the previous best regardless of reps. */
  isWeightPR: boolean
  /** True iff reps beat the previous best at the same or higher weight. */
  isRepsPR: boolean
}

export interface MuscleVolumeContribution {
  muscle: MuscleGroup
  sets: number
}

export interface WorkoutAnalysis {
  workoutId: string
  title: string
  startTime: string
  endTime: string
  durationMins: number
  /** "working time" — total seconds of in-set work (estimated 35s/set). */
  workingTimeMins: number
  /** Rest-to-work ratio. <1 means more work than rest. */
  workToRestRatio: number
  totalSets: number
  completedSets: number
  totalVolume: number
  /** Volume vs the last session of the same title (kg·reps). null when no prior. */
  volumeDelta: number | null
  volumeDeltaPct: number | null
  setsAtTopOfRange: number
  setsBelowRange: number
  prHits: PRHit[]
  perMuscle: MuscleVolumeContribution[]
  /** 0-100. */
  score: number
  /** Sub-scores for transparency. */
  subscores: { completion: number; progress: number; intensity: number; consistency: number }
  /** Short headline string for UI ("Solid push: 3 PRs · +8% volume"). */
  headline: string
}

const SECONDS_PER_SET = 35
const NUMBER_FORMAT = new Intl.NumberFormat('en-GB')

/**
 * Find the most recent prior workout with the same title (program day).
 * Used to compute volume delta. Returns null if no comparable prior exists.
 */
function findComparablePrior(workout: WorkoutData, history: WorkoutData[]): WorkoutData | null {
  const start = new Date(workout.start_time).getTime()
  const candidates = history
    .filter(w => w.id !== workout.id && w.title === workout.title && new Date(w.start_time).getTime() < start)
    .sort((a, b) => b.start_time.localeCompare(a.start_time))
  return candidates[0] ?? null
}

function totalVolume(exercises: ExerciseData[]): number {
  let v = 0
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if ((s.reps ?? 0) > 0 && (s.weight_kg ?? 0) > 0) {
        if (s.ramp) continue // warm-up ramp - never counts toward volume
        v += (s.weight_kg ?? 0) * (s.reps ?? 0)
      }
    }
  }
  return v
}

function totalSetCount(exercises: ExerciseData[]): { total: number; completed: number } {
  let total = 0, completed = 0
  for (const ex of exercises) {
    for (const s of ex.sets) {
      total++
      if ((s.reps ?? 0) > 0) completed++
    }
  }
  return { total, completed }
}

function expectedSetsForTitle(title: string): number {
  if (ROTATION.includes(title as DayName)) {
    return PROGRAM[title as DayName].exercises.reduce((a, ex) => a + ex.sets, 0)
  }
  return 0
}

function detectPRs(workout: WorkoutData, prevPRs: Record<string, PR>): PRHit[] {
  const hits: PRHit[] = []
  for (const ex of workout.exercises) {
    const prev = prevPRs[ex.name]
    let bestThis: ExerciseSet | null = null
    for (const s of ex.sets) {
      if ((s.reps ?? 0) <= 0 || (s.weight_kg ?? 0) <= 0) continue
      if (!bestThis ||
          (s.weight_kg ?? 0) > (bestThis.weight_kg ?? 0) ||
          ((s.weight_kg ?? 0) === (bestThis.weight_kg ?? 0) && (s.reps ?? 0) > (bestThis.reps ?? 0))) {
        bestThis = s
      }
    }
    if (!bestThis) continue
    const w = bestThis.weight_kg ?? 0
    const r = bestThis.reps ?? 0
    const isWeightPR = !prev || w > prev.weight_kg
    const isRepsPR = !!prev && w >= prev.weight_kg && r > prev.reps
    if (isWeightPR || isRepsPR) {
      hits.push({
        exerciseName: ex.name,
        newWeight_kg: w, newReps: r,
        prevWeight_kg: prev?.weight_kg, prevReps: prev?.reps,
        isWeightPR, isRepsPR,
      })
    }
  }
  return hits
}

function setsAtTop(workout: WorkoutData): { atTop: number; below: number } {
  let atTop = 0, below = 0
  for (const ex of workout.exercises) {
    const programEx = ROTATION.includes(workout.title as DayName)
      ? PROGRAM[workout.title as DayName].exercises.find(p => p.name === ex.name)
      : undefined
    const range = parseRepRange(programEx?.repRange)
    if (!range) continue
    for (const s of ex.sets) {
      if ((s.reps ?? 0) <= 0) continue
      if ((s.reps ?? 0) >= range.max) atTop++
      else if ((s.reps ?? 0) < range.min) below++
    }
  }
  return { atTop, below }
}

function muscleContributions(exercises: ExerciseData[]): MuscleVolumeContribution[] {
  const tally: Partial<Record<MuscleGroup, number>> = {}
  for (const ex of exercises) {
    const tags = tagExercise(ex.name)
    const setsDone = ex.sets.filter(s => (s.reps ?? 0) > 0).length
    if (setsDone === 0) continue
    for (const m of tags.primary) tally[m] = (tally[m] ?? 0) + setsDone
    for (const m of tags.secondary) tally[m] = (tally[m] ?? 0) + setsDone * 0.5
  }
  return Object.entries(tally)
    .map(([muscle, sets]) => ({ muscle: muscle as MuscleGroup, sets: sets! }))
    .sort((a, b) => b.sets - a.sets)
}

export function analyzeWorkout(
  workout: WorkoutData,
  history: WorkoutData[],
  prevPRs: Record<string, PR>,
): WorkoutAnalysis {
  const start = new Date(workout.start_time).getTime()
  const end = new Date(workout.end_time).getTime()
  const durationMins = Math.max(0, Math.round((end - start) / 60000))

  const { total: totalSets, completed: completedSets } = totalSetCount(workout.exercises)
  const expected = expectedSetsForTitle(workout.title) || totalSets
  const completionRatio = expected > 0 ? Math.min(1, completedSets / expected) : 0
  const completion = Math.round(completionRatio * 100)

  const totalVol = totalVolume(workout.exercises)
  const prior = findComparablePrior(workout, history)
  const priorVol = prior ? totalVolume(prior.exercises) : null
  const volumeDelta = priorVol !== null ? totalVol - priorVol : null
  const volumeDeltaPct = priorVol && priorVol > 0 ? (totalVol - priorVol) / priorVol : null

  // Progress sub-score: ramp from -10% (0 pts) to +10% (100 pts), 0% → 50 pts.
  let progress = 50
  if (volumeDeltaPct !== null) {
    progress = Math.max(0, Math.min(100, Math.round(50 + (volumeDeltaPct * 100) * 5)))
  }

  const { atTop, below } = setsAtTop(workout)
  // Intensity sub-score: ratio of at-top to all logged sets.
  const intensity = completedSets > 0
    ? Math.round((atTop / completedSets) * 100)
    : 0

  // Consistency: was last session within the past 5 days?
  const lastBefore = history
    .filter(w => w.id !== workout.id && new Date(w.start_time).getTime() < start)
    .sort((a, b) => b.start_time.localeCompare(a.start_time))[0]
  let consistency = 50
  if (lastBefore) {
    const daysGap = (start - new Date(lastBefore.start_time).getTime()) / 86400000
    if (daysGap <= 2) consistency = 100
    else if (daysGap <= 4) consistency = 80
    else if (daysGap <= 7) consistency = 60
    else if (daysGap <= 10) consistency = 40
    else consistency = 20
  } else {
    // First-ever session — give credit for showing up.
    consistency = 70
  }

  const score = Math.round(
    completion * 0.40 +
    progress * 0.25 +
    intensity * 0.20 +
    consistency * 0.15,
  )

  const prHits = detectPRs(workout, prevPRs)
  const perMuscle = muscleContributions(workout.exercises)

  // Working time estimate
  const workingTimeMins = Math.round((completedSets * SECONDS_PER_SET) / 60)
  const restMins = Math.max(0, durationMins - workingTimeMins)
  const workToRestRatio = restMins > 0 ? workingTimeMins / restMins : Infinity

  // Headline
  const headlineParts: string[] = []
  if (prHits.length > 0) {
    headlineParts.push(`${prHits.length} PR${prHits.length === 1 ? '' : 's'}`)
  }
  if (volumeDeltaPct !== null) {
    const sign = volumeDeltaPct >= 0 ? '+' : ''
    headlineParts.push(`${sign}${Math.round(volumeDeltaPct * 100)}% volume`)
  } else {
    headlineParts.push(`${NUMBER_FORMAT.format(Math.round(totalVol))}kg total`)
  }
  if (atTop > 0) headlineParts.push(`${atTop} top-of-range`)
  const headline = headlineParts.length > 0
    ? headlineParts.join(' · ')
    : `${completedSets} sets · ${durationMins}m`

  return {
    workoutId: workout.id,
    title: workout.title,
    startTime: workout.start_time,
    endTime: workout.end_time,
    durationMins,
    workingTimeMins,
    workToRestRatio: Math.round(workToRestRatio * 100) / 100,
    totalSets, completedSets,
    totalVolume: Math.round(totalVol),
    volumeDelta: volumeDelta !== null ? Math.round(volumeDelta) : null,
    volumeDeltaPct: volumeDeltaPct !== null ? Math.round(volumeDeltaPct * 1000) / 1000 : null,
    setsAtTopOfRange: atTop,
    setsBelowRange: below,
    prHits,
    perMuscle,
    score,
    subscores: { completion, progress, intensity, consistency },
    headline,
  }
}
