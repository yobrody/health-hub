export type DayName = 'Upper A' | 'Lower A' | 'Upper B' | 'Lower B'

export interface ProgramExercise {
  name: string
  sets: number
  repRange: string
  rir: string
  restSeconds: number
  notes?: string
}

export interface ProgramDay {
  name: DayName
  focus: string
  exercises: ProgramExercise[]
}

export const ROTATION: DayName[] = ['Upper A', 'Lower A', 'Upper B', 'Lower B']

export const PROGRAM: Record<DayName, ProgramDay> = {
  'Upper A': {
    name: 'Upper A',
    focus: 'Chest · Back · Arms',
    exercises: [
      { name: 'Incline Dumbbell Bench Press', sets: 3, repRange: '8–12', rir: '2–3', restSeconds: 120 },
      { name: 'Flat Machine Chest Press',     sets: 3, repRange: '8–12', rir: '1–3', restSeconds: 120 },
      { name: 'Lat Pulldown',                 sets: 3, repRange: '8–12', rir: '1–3', restSeconds: 90 },
      { name: 'Seated Cable Row',             sets: 3, repRange: '10–12', rir: '1–3', restSeconds: 90 },
      { name: 'Dumbbell Lateral Raise',       sets: 3, repRange: '12–15', rir: '1–2', restSeconds: 60 },
      { name: 'Cable Triceps Pushdown',       sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60 },
      { name: 'Dumbbell Curl',                sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60 },
      { name: 'Hanging Knee Raises',          sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45 },
    ],
  },
  'Lower A': {
    name: 'Lower A',
    focus: 'Legs · Core',
    exercises: [
      { name: 'Leg Press',    sets: 4, repRange: '8–12',  rir: '1–3', restSeconds: 120 },
      { name: 'Goblet Squat', sets: 3, repRange: '8–12',  rir: '1–3', restSeconds: 90 },
      { name: 'Leg Curl',     sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 90 },
      { name: 'Calf Raises',  sets: 3, repRange: '12–20', rir: '1–2', restSeconds: 60, notes: 'Slow stretch at bottom' },
      { name: 'Ab Wheel',     sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45 },
    ],
  },
  'Upper B': {
    name: 'Upper B',
    focus: 'Shoulders · Back · Chest',
    exercises: [
      { name: 'Flat Dumbbell Bench Press',      sets: 3, repRange: '6–10',  rir: '1–2', restSeconds: 120 },
      { name: 'Pull-Up',                        sets: 4, repRange: '5–8',   rir: '1–3', restSeconds: 90, notes: 'Use assisted if needed' },
      { name: 'Single-Arm Dumbbell Row',        sets: 3, repRange: '8–12',  rir: '1–3', restSeconds: 90 },
      { name: 'Dumbbell Shoulder Press',        sets: 3, repRange: '8–12',  rir: '1–3', restSeconds: 120 },
      { name: 'Lateral Raises',                 sets: 4, repRange: '12–20', rir: '1–2', restSeconds: 60 },
      { name: 'Rear Delt Fly',                  sets: 3, repRange: '12–20', rir: '1–2', restSeconds: 60 },
      { name: 'Cable Triceps Extension',        sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60 },
      { name: 'Hammer Curls',                   sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60 },
    ],
  },
  'Lower B': {
    name: 'Lower B',
    focus: 'Legs · Recovery',
    exercises: [
      { name: 'Leg Press',       sets: 3, repRange: '12–15',    rir: '1–3', restSeconds: 120, notes: 'Lighter than Lower A' },
      { name: 'Leg Curl',        sets: 3, repRange: '12–15',    rir: '1–3', restSeconds: 90 },
      { name: 'Walking Lunges',  sets: 3, repRange: '10–12/leg', rir: '1–3', restSeconds: 90 },
      { name: 'Calf Raises',     sets: 3, repRange: '12–20',    rir: '1–2', restSeconds: 60 },
      { name: 'Cable Crunch',    sets: 3, repRange: '10–15',    rir: '0–1', restSeconds: 45 },
    ],
  },
}

/** Given a list of recent workout titles (newest first), return the next program day */
export function getNextDay(recentTitles: string[]): DayName {
  for (const title of recentTitles) {
    const idx = ROTATION.indexOf(title as DayName)
    if (idx !== -1) return ROTATION[(idx + 1) % ROTATION.length]
  }
  return 'Upper A'
}

export const MEAL_PLAN = [
  { emoji: '🌅', label: 'Breakfast', items: '80g oats · 25g PB · 1 banana', kcal: 750, protein: 35 },
  { emoji: '🍗', label: 'Lunch',     items: '~180g chicken thighs · 200g rice · veg', kcal: 800, protein: 50 },
  { emoji: '🥩', label: 'Dinner',    items: 'Chicken or beef mince · rice/pasta · veg', kcal: 800, protein: 50 },
  { emoji: '🥛', label: 'Snack',     items: '250g Greek yogurt · 15–20g PB', kcal: 400, protein: 28 },
]

export const DEFAULT_SCHEDULE: Record<string, DayName> = {
  Tuesday:  'Upper A',
  Wednesday: 'Lower A',
  Friday:   'Upper B',
  Sunday:   'Lower B',
}
