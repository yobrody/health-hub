// State-machine helpers for the focus-mode workout flow. Extracted so the
// "what's next?" logic is testable without rendering the page.

export type SetState = { weight_kg?: number; reps?: number; done: boolean }
/** Exercise status. Skipped exercises are excluded from "next" walks until
 * the user explicitly resumes them (returning the focus pointer to that
 * exercise). Defaults to undefined → treated as pending/active. */
export type ExerciseState = {
  name: string
  sets: SetState[]
  status?: 'pending' | 'active' | 'done' | 'skipped'
}

export type FocusPointer = { exerciseIdx: number; setIdx: number }

/**
 * Finds the next not-yet-done set, walking forward from (fromExIdx, fromSetIdx+1).
 * Returns null when every set in the workout is already done.
 *
 * "Next" in this context means: the next set the user hasn't logged. Editing a
 * finished workout therefore returns null on first call (everything done) — the
 * UI uses pointer-as-cursor for free navigation in that case rather than this
 * helper.
 */
export function findNextIncompleteSet(
  exercises: ExerciseState[],
  fromExIdx: number,
  fromSetIdx: number,
): FocusPointer | null {
  for (let e = fromExIdx; e < exercises.length; e++) {
    const ex = exercises[e]
    if (ex.status === 'skipped') continue
    const startSet = e === fromExIdx ? fromSetIdx + 1 : 0
    for (let s = startSet; s < ex.sets.length; s++) {
      if (!ex.sets[s].done) return { exerciseIdx: e, setIdx: s }
    }
  }
  return null
}

/**
 * Returns the first not-yet-done set, used to position the cursor when a
 * workout starts (or when the user opens a saved workout for editing — and
 * has un-toggled some set).
 */
export function findFirstIncompleteSet(exercises: ExerciseState[]): FocusPointer | null {
  return findNextIncompleteSet(exercises, 0, -1)
}

export type NextPreview =
  | { kind: 'next-set'; exerciseName: string; setNumber: number; totalSets: number }
  | { kind: 'next-exercise'; exerciseName: string; totalSets: number }
  | { kind: 'workout-complete' }

/**
 * What to show under the rest timer. Either "next set in same exercise" or
 * "next exercise" (Set 1 of N). When nothing's next, signals workout complete.
 */
export function describeNext(
  exercises: ExerciseState[],
  justFinished: FocusPointer,
): NextPreview {
  const sameExercise = exercises[justFinished.exerciseIdx]
  if (sameExercise && justFinished.setIdx + 1 < sameExercise.sets.length) {
    return {
      kind: 'next-set',
      exerciseName: sameExercise.name,
      setNumber: justFinished.setIdx + 2, // 1-indexed for display
      totalSets: sameExercise.sets.length,
    }
  }
  // Walk to the next non-skipped exercise that has any sets at all.
  for (let e = justFinished.exerciseIdx + 1; e < exercises.length; e++) {
    if (exercises[e].status === 'skipped') continue
    if (exercises[e].sets.length > 0) {
      return {
        kind: 'next-exercise',
        exerciseName: exercises[e].name,
        totalSets: exercises[e].sets.length,
      }
    }
  }
  return { kind: 'workout-complete' }
}

/** Total completed sets across the whole workout. Used for the header progress label. */
export function countCompletedSets(exercises: ExerciseState[]): number {
  return exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.done).length, 0)
}

/** Total sets across the workout (done + not-done). */
export function countTotalSets(exercises: ExerciseState[]): number {
  return exercises.reduce((acc, ex) => acc + ex.sets.length, 0)
}
