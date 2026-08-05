// Goal-aware target working weight per exercise.
//
// HONESTY: these gym machines are not barbells — an absolute "you should press
// 40kg" from a strength-standards table is a lie when every machine's leverage
// differs. So targets come from one of two honest bases only:
//
//   'bw-ratio'      — for the big COMPOUND movement patterns, a bodyweight-ratio
//                     benchmark scaled to the user's GOAL weight. A direction to
//                     aim at, explicitly "machines vary", not a verdict.
//   'personal-scale'— for isolations (and anything without an external standard),
//                     the current best scaled by bodyweight growth: "keep pace
//                     with your body as you reach the goal". Needs a real current
//                     weight AND a real current best — otherwise we return null
//                     rather than inventing a number.

/** Target working weight as a fraction of bodyweight, at a solid intermediate
 * level, per movement PATTERN. Conservative + realistic for a lean bulker on
 * machines — aspirational but reachable, never elite-barbell figures. */
export const MOVEMENT_RATIOS = {
  shoulderPress: 0.5,
  chestPress: 0.7,
  pulldown: 0.85,
  row: 0.8,
  legPress: 2.0,
  hipThrust: 1.25,
} as const

export type TargetBasis = 'bw-ratio' | 'personal-scale'

export interface StrengthTarget {
  targetKg: number
  basis: TargetBasis
  /** The bodyweight ratio used (bw-ratio basis only). */
  ratio?: number
  /** Honest one-liner for the UI so the number is never mysterious. */
  label: string
  /** currentBest / target, clamped 0..1. Present only when a current best is known. */
  progressPct?: number
}

interface PatternRule {
  test: (n: string) => boolean
  ratio: number
  key: keyof typeof MOVEMENT_RATIOS
}

// Ordered, exclusion-aware pattern matching. Isolations that merely share a word
// with a compound ("Leg Extension", "Overhead Cable Triceps Extension", "Calf
// Press on Leg Press") must fall through to personal-scale, never match a ratio.
const COMPOUND_PATTERNS: PatternRule[] = [
  {
    key: 'pulldown', ratio: MOVEMENT_RATIOS.pulldown,
    test: n => /\b(lat\s*pulldown|pulldown|pull-?up)\b/.test(n),
  },
  {
    key: 'row', ratio: MOVEMENT_RATIOS.row,
    test: n => /\brow\b/.test(n) && !/upright/.test(n),
  },
  {
    key: 'legPress', ratio: MOVEMENT_RATIOS.legPress,
    test: n => /\bleg\s*press\b/.test(n) && !/calf/.test(n),
  },
  {
    key: 'hipThrust', ratio: MOVEMENT_RATIOS.hipThrust,
    test: n => /\b(hip\s*thrust|glute\s*drive)\b/.test(n),
  },
  {
    key: 'chestPress', ratio: MOVEMENT_RATIOS.chestPress,
    // A pressing movement for the chest. Exclude leg press (own rule) and any
    // triceps/extension work that happens to say "press".
    test: n => /\b(chest\s*press|incline\s*(chest\s*)?press|bench\s*press|smith\s*(incline\s*)?press)\b/.test(n),
  },
  {
    key: 'shoulderPress', ratio: MOVEMENT_RATIOS.shoulderPress,
    // Overhead/shoulder PRESS only — never a triceps extension that says "overhead".
    test: n => /\b(shoulder\s*press|overhead\s*press|ohp)\b/.test(n) && !/extension|triceps/.test(n),
  },
]

function snapHalfKg(n: number): number {
  return Math.round(n * 2) / 2
}

function movementRule(name: string): PatternRule | null {
  const n = name.toLowerCase()
  for (const rule of COMPOUND_PATTERNS) {
    if (rule.test(n)) return rule
  }
  return null
}

export function strengthTargetFor(
  exerciseName: string,
  goalWeightKg: number,
  opts?: { currentWeightKg?: number; currentBestKg?: number },
): StrengthTarget | null {
  const currentBestKg = opts?.currentBestKg
  const withProgress = (t: StrengthTarget): StrengthTarget =>
    currentBestKg != null && t.targetKg > 0
      ? { ...t, progressPct: Math.min(1, currentBestKg / t.targetKg) }
      : t

  const rule = movementRule(exerciseName)
  if (rule) {
    const targetKg = snapHalfKg(goalWeightKg * rule.ratio)
    return withProgress({
      targetKg,
      basis: 'bw-ratio',
      ratio: rule.ratio,
      label: `Intermediate benchmark at ${Math.round(goalWeightKg)}kg — machines vary, so aim, don't obsess`,
    })
  }

  // Personal-scale: needs BOTH a real current weight and a real current best,
  // or there's nothing honest to ground a number on.
  const cw = opts?.currentWeightKg
  if (cw != null && cw > 0 && currentBestKg != null && currentBestKg > 0) {
    const targetKg = snapHalfKg(currentBestKg * (goalWeightKg / cw))
    return withProgress({
      targetKg,
      basis: 'personal-scale',
      label: `Keep pace with your bodyweight on the way to ${Math.round(goalWeightKg)}kg`,
    })
  }

  return null
}
