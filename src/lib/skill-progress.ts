// Skill-block progress: personal bests and the three-rung ladder.
//
// Skill sessions are stored as ordinary workouts titled "Skill". That reuses
// the whole existing pipeline - saving, history, offline outbox - for free,
// and getNextDay() only matches Push/Pull/Legs, so a skill entry slots into
// the log without ever disturbing the training rotation.
//
// Holds are recorded in duration_seconds, rep work in reps. ExerciseSet
// already carries both.

import { SKILL_LADDER, type SkillExercise } from '../program'
import type { WorkoutData } from '../api/client'

export const SKILL_WORKOUT_TITLE = 'Skill'

export type SkillBest = {
  /** Best ever recorded: seconds for holds, reps for everything else. */
  value: number
  unit: 'sec' | 'reps'
  /** ISO date of that best. */
  date?: string
}

/** Walk skill workouts and pull the best number ever hit for each movement. */
export function skillBests(workouts: WorkoutData[]): Record<string, SkillBest> {
  const out: Record<string, SkillBest> = {}
  for (const w of workouts) {
    if (w.title !== SKILL_WORKOUT_TITLE) continue
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const secs = s.duration_seconds ?? 0
        const reps = s.reps ?? 0
        const isHold = secs > 0
        const value = isHold ? secs : reps
        if (value <= 0) continue
        const prev = out[ex.name]
        if (!prev || value > prev.value) {
          out[ex.name] = { value, unit: isHold ? 'sec' : 'reps', date: w.start_time?.slice(0, 10) }
        }
      }
    }
  }
  return out
}

export type Rung = {
  /** 0 = not started, 1..3 = rungs cleared. */
  cleared: number
  /** The number being chased next, or null once the ladder is topped out. */
  next: number | null
  /** 0..1 progress toward `next` from the rung below it. */
  pct: number
  ladder: readonly number[]
}

/**
 * Where a value sits on its ladder. Holds climb 20s -> 45s -> 60s, rep work
 * 5 -> 10 -> 12. Progress is measured from the previous rung rather than from
 * zero, so the bar reflects the gap actually being closed.
 */
export function ladderRung(value: number, ladder: readonly number[]): Rung {
  const cleared = ladder.filter(r => value >= r).length
  const next = cleared >= ladder.length ? null : ladder[cleared]
  if (next === null) return { cleared, next: null, pct: 1, ladder }
  const floor = cleared === 0 ? 0 : ladder[cleared - 1]
  const span = next - floor
  const pct = span <= 0 ? 0 : Math.max(0, Math.min(1, (value - floor) / span))
  return { cleared, next, pct, ladder }
}

/** The ladder that applies to a given skill movement. */
export function ladderFor(skill: SkillExercise): readonly number[] {
  return skill.kind === 'hold' ? SKILL_LADDER.hold : SKILL_LADDER.reps
}

/** Human label for a best, or the invitation when there isn't one yet. */
export function formatBest(best: SkillBest | undefined, kind: SkillExercise['kind']): string {
  if (kind === 'prep') return ''
  if (!best) return 'No best yet'
  return best.unit === 'sec' ? `${best.value}s best` : `${best.value} reps best`
}