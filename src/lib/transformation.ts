// Transformation roadmap + physique milestones.
//
// HONESTY: physique changes are driven by lean mass and body-fat, not the scale
// number alone. So every milestone here is anchored to a MEASURABLE signal
// (bodyweight, body-fat %, or a tape measurement) and clearly labelled an
// estimate. Abs are body-fat-anchored on purpose — a bulk RAISES body fat, so
// promising "abs at 66kg" would be a lie. When a signal can't be measured yet
// (no body-fat reading), the milestone says 'needs-data' instead of faking it.

import { BODYWEIGHT_TARGET } from '../program'

// ── Roadmap ────────────────────────────────────────────────────────────────

export type RoadmapDirection = 'gain' | 'lose' | 'maintain'
export type RateSource = 'observed' | 'default'

export interface RoadmapInput {
  currentKg: number
  goalKg: number
  /** Observed weekly change from the weigh-in trend. null if not computed. */
  weeklyChangeKg: number | null
  /** True once the trend is backed by enough data (≥14 days) to trust. */
  reliable: boolean
  /** ISO date (YYYY-MM-DD) used as "today" for ETA math — passed in so the
   * projection is deterministic and testable. */
  todayIso: string
}

export interface Roadmap {
  direction: RoadmapDirection
  remainingKg: number
  rateKgPerWeek: number
  rateSource: RateSource
  /** Observed trend is moving toward the goal. */
  onTrack: boolean
  weeksToGoal: number | null
  etaIso: string | null
  note: string
}

/** Midpoint of the program's healthy lean-bulk band (~0.17 kg/wk). */
const DEFAULT_GAIN_RATE = (BODYWEIGHT_TARGET.weeklyGainKgMin + BODYWEIGHT_TARGET.weeklyGainKgMax) / 2
/** ~0.5 kg/wk — a sustainable, muscle-sparing cut rate. */
const DEFAULT_LOSS_RATE = 0.5
/** Within this of goal → effectively "there". */
const MAINTAIN_BAND_KG = 0.3

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function projectRoadmap(input: RoadmapInput): Roadmap {
  const { currentKg, goalKg, weeklyChangeKg, reliable, todayIso } = input
  const delta = goalKg - currentKg
  const remainingKg = Math.abs(delta)

  if (remainingKg <= MAINTAIN_BAND_KG) {
    return {
      direction: 'maintain', remainingKg, rateKgPerWeek: 0, rateSource: 'default',
      onTrack: true, weeksToGoal: null, etaIso: null,
      note: "You're at your goal weight — hold it steady.",
    }
  }

  const direction: RoadmapDirection = delta > 0 ? 'gain' : 'lose'
  const defaultRate = direction === 'gain' ? DEFAULT_GAIN_RATE : DEFAULT_LOSS_RATE

  // Observed trend is usable only when reliable AND moving toward the goal.
  const observedTowardGoal =
    weeklyChangeKg != null &&
    ((direction === 'gain' && weeklyChangeKg > 0.02) || (direction === 'lose' && weeklyChangeKg < -0.02))
  const useObserved = reliable && observedTowardGoal

  const rateKgPerWeek = useObserved ? Math.abs(weeklyChangeKg!) : defaultRate
  const rateSource: RateSource = useObserved ? 'observed' : 'default'
  const onTrack = observedTowardGoal === true

  const weeksToGoal = Math.ceil(remainingKg / rateKgPerWeek)
  const etaIso = addDaysIso(todayIso, weeksToGoal * 7)

  let note: string
  if (reliable && weeklyChangeKg != null && !observedTowardGoal) {
    const trendWord = weeklyChangeKg > 0.02 ? 'gaining' : weeklyChangeKg < -0.02 ? 'losing' : 'flat'
    note = direction === 'gain'
      ? `You're currently ${trendWord} — at a healthy bulk rate you'd reach ${goalKg}kg in about ${weeksToGoal} weeks.`
      : `You're currently ${trendWord} — at a steady cut you'd reach ${goalKg}kg in about ${weeksToGoal} weeks.`
  } else if (useObserved) {
    note = `At your real ${rateKgPerWeek.toFixed(2)} kg/wk you'll hit ${goalKg}kg in about ${weeksToGoal} weeks.`
  } else {
    note = `Log your weight for two weeks to project from your real pace — for now this assumes a healthy ${rateKgPerWeek.toFixed(2)} kg/wk.`
  }

  return { direction, remainingKg, rateKgPerWeek, rateSource, onTrack, weeksToGoal, etaIso, note }
}

// ── Physique milestones ──────────────────────────────────────────────────────

export type MilestoneAnchor = 'weight' | 'bodyfat'
export type MilestoneStatus = 'reached' | 'approaching' | 'needs-data'

export interface PhysiqueMilestone {
  id: string
  title: string
  /** The measurable signal that marks this look. */
  signal: string
  anchor: MilestoneAnchor
  /** Present only for weight-anchored milestones. */
  targetWeightKg?: number
  /** Progress toward the signal, 0..1. null when it can't be measured honestly yet. */
  progressPct: number | null
  status: MilestoneStatus
  note: string
}

/** kg of lean-ish gain (from the journey start) that typically brings each look
 * on a lean bulk. Rough, individual — surfaced as estimates, never promises. */
const WEIGHT_MILESTONES: { id: string; title: string; signal: string; deltaKg: number; note: string }[] = [
  { id: 'shoulders', title: 'Shoulders fill out · t-shirts fit better', signal: 'delts + upper back grow with ~3kg of gain', deltaKg: 3,
    note: 'The first change most people notice — sleeves and shoulders before anything else.' },
  { id: 'arms', title: 'Arms visibly bigger', signal: 'measurable arm growth around ~5kg of gain', deltaKg: 5,
    note: 'Track it: log your arm measurement monthly, aim for +2–3cm.' },
  { id: 'chest-back', title: 'Defined chest & back', signal: 'chest + back thickness around ~7kg of gain', deltaKg: 7,
    note: 'Pressing + rowing volume is what fills these out — keep progressing the loads.' },
]

const ABS_BF_THRESHOLD = 12 // % body fat where abs typically show for men

export interface PhysiqueInput {
  /** Earliest logged weight — the journey's baseline. */
  startKg: number
  currentKg: number
  goalKg: number
  bodyFatPct?: number | null
}

export function physiqueMilestones(input: PhysiqueInput): PhysiqueMilestone[] {
  const { startKg, currentKg, bodyFatPct } = input
  const gained = currentKg - startKg

  const weightOnes: PhysiqueMilestone[] = WEIGHT_MILESTONES.map(m => {
    const targetWeightKg = Math.round((startKg + m.deltaKg) * 2) / 2
    const reached = gained >= m.deltaKg
    const progressPct = Math.max(0, Math.min(1, m.deltaKg > 0 ? gained / m.deltaKg : 1))
    return {
      id: m.id, title: m.title, signal: m.signal, anchor: 'weight' as const,
      targetWeightKg, progressPct, status: reached ? 'reached' as const : 'approaching' as const, note: m.note,
    }
  })

  // Abs — body-fat anchored, weight-independent, and honest about the bulk.
  const abs: PhysiqueMilestone = (() => {
    const base = {
      id: 'abs', title: 'Visible abs', signal: `body fat below ~${ABS_BF_THRESHOLD}%`, anchor: 'bodyfat' as const,
    }
    if (bodyFatPct == null) {
      return {
        ...base, progressPct: null, status: 'needs-data' as const,
        note: 'Abs are about body-fat %, not scale weight. Log a body-fat reading to track this — and note a bulk raises body fat, so expect this later, in a cut.',
      }
    }
    const reached = bodyFatPct <= ABS_BF_THRESHOLD
    // Progress from a 25% "soft" ceiling down to the threshold.
    const softCeiling = 25
    const progressPct = Math.max(0, Math.min(1, (softCeiling - bodyFatPct) / (softCeiling - ABS_BF_THRESHOLD)))
    return {
      ...base, progressPct, status: reached ? 'reached' as const : 'approaching' as const,
      note: reached
        ? `At ${bodyFatPct}% body fat your abs should be visible.`
        : `At ${bodyFatPct}% body fat, abs aren't sharp yet — and a bulk raises body fat, so plan a cut once you've built the size.`,
    }
  })()

  return [...weightOnes, abs]
}
