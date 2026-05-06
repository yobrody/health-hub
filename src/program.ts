export type DayName = 'Upper A' | 'Lower A' | 'Upper B' | 'Lower B'

export interface ProgramExercise {
  name: string
  sets: number
  repRange: string
  rir: string
  restSeconds: number
  /** Brody's current working weight for this lift. Free-form string so we can
   * encode "16kg", "8kg×2 sets, 6kg×1", or "20kg → 22kg when 3×10 lands". */
  startingWeight?: string
  notes?: string
}

export interface ProgramDay {
  name: DayName
  focus: string
  exercises: ProgramExercise[]
  /** Optional warm-up done before the lifting (e.g. 10-min incline walk on
   * Lower B). Rendered above the first exercise on the workout page. */
  warmup?: string
}

export const ROTATION: DayName[] = ['Upper A', 'Lower A', 'Upper B', 'Lower B']

// Custom 4-day Upper/Lower Brody is running at The Gym Group. Weights below
// are his current working weights (Nov 2026 baseline). Progression rules:
//   • If you hit the top of the rep range with good form on all sets, add the
//     smallest weight jump next session.
//   • If you're below the bottom of the rep range, keep weight, push for 1
//     more rep next session.
//   • If form breaks down, drop weight slightly.
//   • Deload every 6–8 weeks: same lifts, -30–40% weight or -2 sets each.
export const PROGRAM: Record<DayName, ProgramDay> = {
  'Upper A': {
    name: 'Upper A',
    focus: 'Chest · Back · Arms',
    exercises: [
      { name: 'Incline Dumbbell Bench Press', sets: 3, repRange: '8–12', rir: '2–3', restSeconds: 120, startingWeight: '16kg' },
      { name: 'Flat Machine Chest Press',     sets: 3, repRange: '8–12', rir: '1–3', restSeconds: 120, startingWeight: '18kg', notes: 'Or Dumbbell Bench Press' },
      { name: 'Lat Pulldown',                 sets: 3, repRange: '8–12', rir: '1–3', restSeconds: 90,  startingWeight: '32kg', notes: 'Medium grip, neutral palms' },
      { name: 'Seated Cable Row',             sets: 3, repRange: '10–12', rir: '1–3', restSeconds: 90, startingWeight: '32kg', notes: 'Or chest-supported machine row' },
      { name: 'Dumbbell Lateral Raise',       sets: 3, repRange: '12–15', rir: '1–2', restSeconds: 60, startingWeight: '8kg, drop to 6kg last set' },
      { name: 'Cable Triceps Pushdown',       sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60, startingWeight: '17kg' },
      { name: 'Dumbbell Curl',                sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60, startingWeight: '8kg×2, 6kg×1', notes: 'Standing or incline' },
      { name: 'Hanging Knee Raises',          sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45, notes: 'Or Captain\'s Chair' },
      { name: 'Abdominal Crunch (machine)',   sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45, startingWeight: '36kg' },
    ],
  },
  'Lower A': {
    name: 'Lower A',
    focus: 'Legs · Core',
    exercises: [
      { name: 'Leg Press',                  sets: 4, repRange: '8–12',  rir: '1–3', restSeconds: 120, startingWeight: '30kg', notes: 'Main quad lift — push the weight up over time' },
      { name: 'Leg Extension',              sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 90,  startingWeight: '39kg', notes: 'Extra quad focus' },
      { name: 'Leg Curl',                   sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 90,  startingWeight: '36kg', notes: 'Hamstrings' },
      { name: 'Calf Raises (Leg Press)',    sets: 3, repRange: '12–20', rir: '1–2', restSeconds: 60,  startingWeight: '66kg', notes: 'Slow stretch at the bottom' },
      { name: 'Cable Crunch',               sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45,  startingWeight: '36kg', notes: 'Or ab wheel / plank 30–45s' },
      { name: 'Captain\'s Chair Knee Raise', sets: 3, repRange: '15',   rir: '0–1', restSeconds: 45 },
    ],
  },
  'Upper B': {
    name: 'Upper B',
    focus: 'Shoulders · Back · Chest',
    exercises: [
      { name: 'Flat Dumbbell Bench Press',      sets: 3, repRange: '6–10',  rir: '1–2', restSeconds: 120, startingWeight: '20kg → 22kg when 3×10 lands' },
      { name: 'Pull-Ups (or assisted)',         sets: 5, repRange: 'AMRAP × 2, then 8–12 × 3', rir: '1–3', restSeconds: 90, notes: '2 BW AMRAP sets first, then 3 assisted/pulldown sets' },
      { name: 'Pec Deck',                       sets: 3, repRange: '15–20', rir: '1–2', restSeconds: 60,  startingWeight: '39kg', notes: 'Only increase when 3×20 is easy' },
      { name: 'Single-Arm Dumbbell Row',        sets: 3, repRange: '8–12',  rir: '1–3', restSeconds: 90,  startingWeight: '16kg → 18kg when 3×12 lands' },
      { name: 'Dumbbell Shoulder Press (seated)', sets: 3, repRange: '8–12', rir: '1–3', restSeconds: 120, startingWeight: '12kg → 14kg when 3×12 solid' },
      { name: 'Lateral Raises',                 sets: 4, repRange: '12–20', rir: '1–2', restSeconds: 60,  startingWeight: '6kg', notes: 'Push reps before adding weight' },
      { name: 'Rear Delt Fly (machine)',        sets: 3, repRange: '15–20', rir: '1–2', restSeconds: 60,  startingWeight: '25kg', notes: 'Only increase when 3×20 is easy' },
      { name: 'Cable Triceps Extension',        sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60,  startingWeight: '14.7kg', notes: 'Strict form on all sets' },
      { name: 'Hammer Curls',                   sets: 3, repRange: '10–15', rir: '1–3', restSeconds: 60,  startingWeight: '9kg → 10kg when 2–3 × 15 controlled' },
    ],
  },
  'Lower B': {
    name: 'Lower B',
    focus: 'Legs · Recovery',
    warmup: '10 min fast incline walk',
    exercises: [
      { name: 'Leg Press',              sets: 3, repRange: '12–15', rir: '1–3', restSeconds: 90,  startingWeight: '45kg', notes: 'Lighter than Lower A' },
      { name: 'Leg Extension',          sets: 3, repRange: '15–20', rir: '1–2', restSeconds: 60,  startingWeight: '25kg' },
      { name: 'Leg Curl',               sets: 3, repRange: '12–15', rir: '1–3', restSeconds: 60,  startingWeight: '27kg' },
      { name: 'Glute Trainer',          sets: 3, repRange: '12–15', rir: '1–2', restSeconds: 60,  startingWeight: '32kg, last set 20kg' },
      { name: 'Standing Calf Raise (machine)', sets: 3, repRange: '15–20', rir: '1–2', restSeconds: 60, startingWeight: '52kg' },
      { name: 'Cable Glute-Ham Kickbacks', sets: 3, repRange: '12–15/leg', rir: '1–3', restSeconds: 45, startingWeight: '14kg', notes: 'Optional if you feel good' },
      { name: 'Hanging Knee Raises',    sets: 3, repRange: '10–15', rir: '0–1', restSeconds: 45,  notes: 'Near failure' },
      { name: 'Cable Crunch',           sets: 3, repRange: '10–15', rir: '1–2', restSeconds: 45,  startingWeight: '23kg' },
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

// Brody's macro targets — 6'0" / ~140lb / lean-bulking. Goal is +0.25-0.5kg/week.
// Adjust by ±150-200 kcal/day after a 2-week scale-weight average if drifting.
export const MEAL_PLAN = [
  { emoji: '🌅', label: 'Breakfast', items: '80g oats · 25–30g whey · 25g PB · 1 banana', kcal: 750, protein: 35 },
  { emoji: '🍗', label: 'Lunch',     items: '~180g chicken thighs · 200g rice · 1 tbsp olive oil · veg', kcal: 800, protein: 50 },
  { emoji: '🥩', label: 'Dinner',    items: 'Same as lunch, or 150g 5–10% beef mince · rice/pasta · veg', kcal: 800, protein: 50 },
  { emoji: '🥛', label: 'Snack',     items: '250g Greek yogurt · 15–20g PB · honey or fruit', kcal: 400, protein: 28 },
]

// Rule of thumb when a session must be skipped: do NOT double up the next day.
// Keep the rotation as-is (next session = next item in ROTATION). When a week
// only has 3 sessions available, drop Lower B — Upper A / Lower A / Upper B
// keep your upper-body progress moving.
export const DEFAULT_SCHEDULE: Record<string, DayName> = {
  Tuesday:   'Upper A',
  Wednesday: 'Lower A',
  Friday:    'Upper B',
  Sunday:    'Lower B',
}
