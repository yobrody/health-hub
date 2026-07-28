// ── Rolling Push / Pull / Legs ──────────────────────────────────────────
// The Gym Group Paddington · machine-first.
//
// Rule: whenever you go, do the next session in the rotation.
// Push → Pull → Legs → repeat. Works at 2 days a week or 6.
// The rotation is NEVER redesigned around the calendar — which is why there is
// no weekday schedule in this file any more (the old DEFAULT_SCHEDULE is gone).

export type DayName = 'Push' | 'Pull' | 'Legs'

export const ROTATION: DayName[] = ['Push', 'Pull', 'Legs']

/** Compounds stop 1–2 reps short of failure, always. Isolations take the LAST
 * set to failure. That's structural rather than per-exercise taste, so it's a
 * type instead of the old free-form `rir` string. */
export type LiftKind = 'compound' | 'isolation'

/** Skill work is an isometric hold (tracked in seconds), a rep set (tracked in
 * reps), or unmeasured prep that exists only as a checkbox. */
export type SkillKind = 'hold' | 'reps' | 'prep'

/** Prescribed reps-in-reserve, derived from lift kind rather than typed per
 * exercise. Rendered as the "2 RIR" chip on the workout page. */
export function rirFor(lift: LiftKind): string {
  return lift === 'compound' ? '1–2' : '0–1 last set'
}

/** Same-muscle substitute for when a machine is occupied. Surfaced by the
 * ⏭ Skip button instead of silently parking the exercise. */
export interface ExerciseSwap {
  name: string
  /** Load for the SWAP, which is rarely the same as the main lift. */
  startingWeightKg?: number
  note?: string
}

export interface ProgramExercise {
  name: string
  sets: number
  repRange: string
  restSeconds: number
  lift: LiftKind
  /** Machine-readable seed load. Undefined = bodyweight. */
  startingWeightKg?: number
  /** Human-facing label. Derived from startingWeightKg when absent. */
  startingWeight?: string
  swaps?: ExerciseSwap[]
  /** True on the first compound of the day — earns the 50%×8 / 75%×4 ramp.
   * Ramp sets are excluded from volume, PRs AND progression evaluation: a 50%
   * set counted as a working set fails the "every set hit the top of the range"
   * check and would silently freeze progression forever. */
  rampUp?: boolean
  /** Seed carried over from an older routine rather than measured on this
   * machine. Permits double jumps until it lands inside the rep range at
   * 1–2 RIR, then normal rules resume. */
  recalibrating?: boolean
  notes?: string
}

export interface SkillExercise {
  name: string
  kind: SkillKind
  sets: number
  /** "20–40 sec" for holds, "5–8" for reps, "60 sec" for prep. */
  target: string
  restSeconds: number
  /** Paddington has no wall space for handstand work, so the block can't be
   * assumed to happen at the gym. 'home' items are surfaced as a separate
   * checklist and NEVER block starting or finishing a gym session. */
  location: 'gym' | 'home' | 'either'
  notes?: string
}

export interface ProgramDay {
  name: DayName
  focus: string
  /** 10 minutes in the studio BEFORE touching a machine. Logged as part of the
   * workout but tagged so it's excluded from volume — machines cannot train
   * this, and it won't progress unless the best number is recorded each time. */
  skill: SkillExercise[]
  exercises: ProgramExercise[]
}

// ── Progression rules ────────────────────────────────────────────────────
// Read once, then never think about it again. Single source of truth —
// workout-progression.ts consumes these so the rules can't drift between the
// written routine and the engine.
export const PROGRESSION = {
  /** Top of range on every set with 0–1 left in the tank → smallest jump. */
  bumpAtOrBelowRIR: 1,
  /** Top of range but 2+ left in the tank → same weight, push harder. */
  holdAboveRIR: 2,
  /** At or above this, "push harder" is not available: you are capped by the
   * rep range rather than by strength, so the weight itself is too light.
   * Without this threshold "Too easy" and "Just right" collapse to the same
   * outcome, which makes one of the two buttons pointless. */
  tooLightRIR: 3,
  /** Missed the bottom of the range twice running → drop this fraction. */
  stallDeloadPct: 0.15,
  /** Consecutive missed sessions before the deload fires. */
  stallSessions: 2,
  /** Smallest available jump exceeding this fraction of current load → don't
   * jump. Keep adding reps past the top of the range until it doesn't. */
  maxJumpPct: 0.10,
  /** Escape hatch for the rule above. The jump percentage only shrinks as the
   * WEIGHT grows, so on any stack whose next notch exceeds 10% the lifter can
   * never earn it - 27kg to 32kg on a 5kg machine is +18.5%, and 3.4kg to
   * 5.7kg on an imperial cable is +68%. Left alone the rule deadlocks and
   * prescribes an identical session forever. Reaching this multiple of the
   * rep-range top earns the notch regardless, dropping back to range.min. */
  repsOverrunMultiplier: 1.5,
  /** More than this many days off → one lighter session, then resume. */
  layoffDays: 10,
  /** How much to shave for that single return session. */
  layoffBackoffPct: 0.10,
} as const

// Food is a DIAGNOSTIC, not a gate. Earned progression is never withheld
// because of a bad food day — if two lifts stall AND bodyweight is flat for
// three weeks, THAT is when the app says "this is food, not training".
export const STALL_DIAGNOSIS = {
  liftsStalled: 2,
  bodyweightFlatWeeks: 3,
} as const

// ── Skill block ──────────────────────────────────────────────────────────
// Nothing here has a baseline yet — the first logged session IS the baseline.
// Pike pushups and dips are pressing, so they stay off Push day; pull-ups are
// pulling, so they stay off Pull day. Holds are isometric and cheap, so they
// run every session. That still lands every movement twice per three-day cycle.
export const SKILL_LADDER = {
  hold: [20, 45, 60],
  reps: [5, 10, 12],
} as const

const WRIST_PREP: SkillExercise = {
  name: 'Wrist prep', kind: 'prep', sets: 1, target: '60 sec', restSeconds: 0,
  location: 'either',
}
const HANDSTAND_HOLD: SkillExercise = {
  name: 'Chest-to-wall handstand hold', kind: 'hold', sets: 3, target: '20–40 sec', restSeconds: 60,
  location: 'home',
  notes: 'No wall space at Paddington — do this at home. Ladder: 20s → 45s → 60s.',
}
const PIKE_PUSHUPS: SkillExercise = {
  name: 'Pike pushups', kind: 'reps', sets: 2, target: '5–8', restSeconds: 60,
  location: 'either',
  notes: 'Raise the feet to progress. Ladder: 5 → 10 → 12.',
}
const PULL_UPS: SkillExercise = {
  name: 'Pull-ups (skill)', kind: 'reps', sets: 2, target: 'easy reps', restSeconds: 60,
  location: 'gym',
  notes: 'Assisted counts. Leave plenty in the tank — this is skill, not a finisher.',
}
const DIPS: SkillExercise = {
  name: 'Dips (skill)', kind: 'reps', sets: 2, target: 'easy reps', restSeconds: 60,
  location: 'gym',
  notes: 'Assisted counts. Leave plenty in the tank.',
}

export const PROGRAM: Record<DayName, ProgramDay> = {
  Push: {
    name: 'Push',
    focus: 'Shoulders · Chest · Triceps',
    skill: [WRIST_PREP, HANDSTAND_HOLD, PULL_UPS],
    exercises: [
      // Seeds below are MEASURED from the first Push session (27 Jul 2026),
      // not carried over from the old routine. Where a lift was overseeded the
      // real number replaced the guess outright.
      {
        name: 'Seated Shoulder Press (machine)', sets: 3, repRange: '6–10', restSeconds: 120,
        lift: 'compound', startingWeightKg: 27, rampUp: true,
        notes: 'Stack is 22/27/32 — there is no 30. 32kg gave 4,4 reps; 27kg is the working weight. Build to 6+ on all sets before touching 32 again.',
        swaps: [
          { name: 'Smith Overhead Press' },
          { name: 'Seated Dumbbell Shoulder Press', startingWeightKg: 12 },
        ],
      },
      {
        name: 'Incline Chest Press (machine)', sets: 3, repRange: '8–12', restSeconds: 120,
        lift: 'compound', startingWeightKg: 35, recalibrating: true,
        notes: 'Untested - only one machine and it was taken on session 1. 35kg is still a guess.',
        swaps: [
          { name: 'Incline Dumbbell Press', startingWeightKg: 14, note: '16kg gave 10 then 5 - set 1 hit failure and burned set 2. Use 14kg with 1-2 in reserve.' },
          { name: 'Smith Incline Press' },
        ],
      },
      {
        name: 'Pec Deck', sets: 3, repRange: '12–20', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 45,
        notes: 'Confirmed: 19/16/10 at 45kg. Weight is right — the set-3 drop is fatigue, not load.',
        swaps: [{ name: 'Cable Fly' }, { name: 'Dumbbell Fly', startingWeightKg: 8 }],
      },
      {
        name: 'Cable Lateral Raise', sets: 3, repRange: '12–20', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 3.4,
        notes: 'Per arm - logged as one set, not two. 7.9 and 5.7kg both failed. Session 1 set 1 (10/9) was familiarisation, not a real effort - true capacity is ~19. Next notch is 5.7kg (+68%), far outside the 10% rule, so push reps past 20 before ever adding weight.',
        swaps: [
          { name: 'Dumbbell Lateral Raise', startingWeightKg: 4 },
          { name: 'Machine Lateral Raise' },
        ],
      },
      {
        name: 'Triceps Pushdown', sets: 3, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 17,
        notes: 'Confirmed: 15/15/9 at 17kg. Two sets at the top — next stop is 18.1kg (+6.6%, inside the 10% rule) once set 3 also reaches 15.',
        swaps: [{ name: 'Overhead Cable Extension' }, { name: 'Assisted Dip Machine' }],
      },
      {
        name: 'Overhead Cable Triceps Extension', sets: 2, repRange: '12–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 3.4,
        notes: 'Was seeded 15kg — failed rep 1. Walked down 14.7 → 7.9 → 5.7 → 3.4kg for 10 reps. 3.4kg is the truth.',
        swaps: [{ name: 'Dumbbell Skull Crusher', startingWeightKg: 4 }, { name: 'Bench Dip' }],
      },
      {
        name: 'Abdominal Crunch (machine)', sets: 3, repRange: '12–20', restSeconds: 45,
        lift: 'isolation', startingWeightKg: 41,
        notes: 'Added by choice on session 1: 20 @ 36kg, then 15/15 @ 41kg. Optional finisher.',
        swaps: [{ name: 'Cable Crunch' }, { name: 'Weighted Decline Sit-Up' }],
      },
    ],
  },

  Pull: {
    name: 'Pull',
    focus: 'Back · Rear Delts · Biceps',
    skill: [WRIST_PREP, HANDSTAND_HOLD, PIKE_PUSHUPS, DIPS],
    exercises: [
      {
        name: 'Lat Pulldown', sets: 4, repRange: '6–10', restSeconds: 120,
        lift: 'compound', startingWeightKg: 38, rampUp: true, recalibrating: true,
        swaps: [{ name: 'Assisted Pull-Up Machine' }, { name: 'Pull-Ups (rig)' }],
      },
      {
        name: 'Seated Cable Row', sets: 3, repRange: '8–12', restSeconds: 90,
        lift: 'compound', startingWeightKg: 36, recalibrating: true,
        swaps: [
          { name: 'Plate-Loaded Row' },
          { name: 'Single-Arm Dumbbell Row', startingWeightKg: 18 },
        ],
      },
      {
        name: 'Chest-Supported Row (plate-loaded)', sets: 3, repRange: '8–12', restSeconds: 90,
        lift: 'compound', startingWeightKg: 15, recalibrating: true,
        swaps: [{ name: 'T-Bar Row' }, { name: 'Single-Arm Dumbbell Row', startingWeightKg: 18 }],
      },
      {
        name: 'Rear Delt Fly (machine)', sets: 4, repRange: '15–20', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 32,
        swaps: [{ name: 'Cable Rear Delt Fly' }, { name: 'Bent-Over Dumbbell Fly', startingWeightKg: 6 }],
      },
      {
        name: 'Cable Face Pull', sets: 3, repRange: '15–20', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 12,
        swaps: [{ name: 'Rear Delt Machine' }, { name: 'Band Pull-Apart' }],
      },
      {
        name: 'Cable Curl', sets: 3, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 15,
        swaps: [{ name: 'Dumbbell Curl', startingWeightKg: 8 }, { name: 'Preacher Curl Machine' }],
      },
      {
        name: 'Hammer Curl', sets: 3, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 9,
        swaps: [{ name: 'Rope Cable Curl' }, { name: 'Machine Curl' }],
      },
    ],
  },

  Legs: {
    name: 'Legs',
    focus: 'Legs · Glutes · Core',
    skill: [WRIST_PREP, HANDSTAND_HOLD, PIKE_PUSHUPS, PULL_UPS, DIPS],
    exercises: [
      {
        name: 'Leg Press', sets: 4, repRange: '8–12', restSeconds: 150,
        lift: 'compound', startingWeightKg: 60, rampUp: true, recalibrating: true,
        notes: 'Seed is deliberately low — expect double jumps for a session or two.',
        swaps: [{ name: 'Hack Squat' }, { name: 'Smith Squat' }],
      },
      {
        name: 'Leg Extension', sets: 3, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 52,
        swaps: [{ name: 'Single-Leg Extension' }, { name: 'Sissy Squat' }],
      },
      {
        name: 'Seated Leg Curl', sets: 3, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 36,
        swaps: [{ name: 'Lying Leg Curl' }, { name: 'Cable Leg Curl' }],
      },
      {
        name: 'Hip Thrust (Glute Drive)', sets: 3, repRange: '10–15', restSeconds: 90,
        lift: 'compound', startingWeightKg: 40, recalibrating: true,
        swaps: [{ name: 'Glute Trainer', startingWeightKg: 32 }, { name: 'Cable Kickback', startingWeightKg: 14 }],
      },
      {
        name: 'Standing Calf Raise', sets: 4, repRange: '10–15', restSeconds: 60,
        lift: 'isolation', startingWeightKg: 70, notes: 'Pause the stretch at the bottom.',
        swaps: [{ name: 'Calf Press on Leg Press', startingWeightKg: 66 }, { name: 'Seated Calf Raise' }],
      },
      {
        name: 'Cable Crunch', sets: 3, repRange: '10–15', restSeconds: 45,
        lift: 'isolation', startingWeightKg: 45,
        swaps: [{ name: 'Ab Crunch Machine' }, { name: 'Weighted Decline Sit-Up' }],
      },
      {
        name: 'Hanging Knee Raise', sets: 3, repRange: '8–12', restSeconds: 45,
        lift: 'isolation', startingWeight: 'Bodyweight',
        notes: 'Hold a dumbbell between your feet once you hit 12.',
        swaps: [{ name: "Captain's Chair" }, { name: 'Lying Leg Raise' }],
      },
    ],
  },
}

/** Ramp-up sets on the first compound. Neither counts toward volume, PRs or
 * progression — they exist purely to get blood into the joint. */
export const RAMP_UP_SETS = [
  { pctOfWorking: 0.5, reps: 8 },
  { pctOfWorking: 0.75, reps: 4 },
] as const

/** Display label for a program exercise's seed load. */
export function seedLabel(ex: ProgramExercise): string | undefined {
  if (ex.startingWeight) return ex.startingWeight
  if (ex.startingWeightKg !== undefined) return `${ex.startingWeightKg}kg`
  return undefined
}

/** Given recent workout titles (newest first), return the next session in the
 * rotation. Titles from the retired Upper/Lower split simply don't match, so
 * an old history falls through to Push — the correct cold start. */
export function getNextDay(recentTitles: string[]): DayName {
  for (const title of recentTitles) {
    const idx = ROTATION.indexOf(title as DayName)
    if (idx !== -1) return ROTATION[(idx + 1) % ROTATION.length]
  }
  return 'Push'
}

// ── Bodyweight ───────────────────────────────────────────────────────────
// Weigh at the gym, same 2–3 days a week, same point in the routine (arriving,
// before training, after the same breakfast). The number reads high versus a
// true fasted weight — ignore the absolute figure, watch the 3-entry average.
export const BODYWEIGHT_TARGET = {
  /** Roughly +0.25–0.5 lb per week. Stored in kg because every weight in this
   * codebase is kg. The old comment said 0.25–0.5 KG, which is ~2.2× too
   * aggressive and would add fat rather than muscle. */
  weeklyGainKgMin: 0.11,
  weeklyGainKgMax: 0.23,
  weeklyGainLbMin: 0.25,
  weeklyGainLbMax: 0.5,
  /** Flat for this long → eat more. */
  flatWeeksBeforeEatMore: 3,
  /** Rolling average window, in entries not days. */
  averageWindow: 3,
} as const

// Macro targets — 6'0" / ~140lb / lean-bulking.
// Adjust by ±150–200 kcal/day after a 2-week scale-weight average if drifting.
export const MEAL_PLAN = [
  { emoji: '🌅', label: 'Breakfast', items: '80g oats · 25–30g whey · 25g PB · 1 banana', kcal: 750, protein: 35 },
  { emoji: '🍗', label: 'Lunch',     items: '~180g chicken thighs · 200g rice · 1 tbsp olive oil · veg', kcal: 800, protein: 50 },
  { emoji: '🥩', label: 'Dinner',    items: 'Same as lunch, or 150g 5–10% beef mince · rice/pasta · veg', kcal: 800, protein: 50 },
  { emoji: '🥛', label: 'Snack',     items: '250g Greek yogurt · 15–20g PB · honey or fruit', kcal: 400, protein: 28 },
]
