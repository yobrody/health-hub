import { describe, it, expect } from 'vitest'
import { installLocalStorageShim } from './test-helpers'
installLocalStorageShim()
import { predictNextWeight, parseRepRange, type SetSummary } from './workout-progression'
import { decideNextSet } from './gym-decision'
import { resolveEquipment, snapToStack, nextUpWeight, nextDownWeight } from './gym-equipment'
import { weeklyChangeKg, diagnoseProgress, countStalledLifts } from './progress-diagnosis'
import { ladderRung, skillBests } from './skill-progress'
import { SKILL_LADDER } from '../program'

// Adversarial suite. These are not feature tests - they assert invariants that
// must hold for EVERY input, including nonsense the UI should never produce but
// a corrupted row, a clock skew or a half-synced offline write easily could.

const RANGES = [undefined, null, '', 'AMRAP', '8-12', '6-10', '12-20', '1-1', '5-5']
const WEIGHTS = [undefined, 0, 0.5, 1.25, 3.4, 27, 60, 100, 500]
const REPS = [undefined, 0, 1, 5, 12, 20, 100]
const RIRS = [undefined, null, 0, 1, 2, 3, 4, 10, -1]
const DAYS = [undefined, null, 0, 1, 10, 11, 365, -5]

function everyCombination(fn: (i: {
  prevBest: { weight_kg: number; reps: number } | null
  prevSets: SetSummary[]
  repRange: string | null | undefined
  lastSessionRIR: number | null | undefined
  daysSinceLast: number | null | undefined
  nextStackUp: number | undefined
}) => void) {
  for (const w of WEIGHTS) {
    for (const r of REPS) {
      for (const range of RANGES) {
        for (const rir of RIRS) {
          for (const days of DAYS) {
            fn({
              prevBest: w === undefined ? null : { weight_kg: w, reps: r ?? 0 },
              prevSets: w === undefined ? [] : [{ weight_kg: w, reps: r }, { weight_kg: w, reps: r }],
              repRange: range,
              lastSessionRIR: rir,
              daysSinceLast: days,
              nextStackUp: w === undefined ? undefined : w + 2.5,
            })
          }
        }
      }
    }
  }
}

describe('INVARIANT: predictNextWeight never produces a nonsense weight', () => {
  it('never returns NaN, Infinity or a negative weight', () => {
    const bad: string[] = []
    everyCombination(input => {
      const r = predictNextWeight(input)
      const w = r.weight_kg
      if (w === undefined) return
      if (!Number.isFinite(w)) bad.push(`non-finite ${w} from ${JSON.stringify(input)}`)
      if (w < 0) bad.push(`negative ${w} from ${JSON.stringify(input)}`)
    })
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('never returns NaN or negative reps', () => {
    const bad: string[] = []
    everyCombination(input => {
      const r = predictNextWeight(input)
      if (r.reps === undefined) return
      if (!Number.isFinite(r.reps)) bad.push(`non-finite reps ${r.reps}`)
      if (r.reps < 0) bad.push(`negative reps ${r.reps}`)
    })
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('a deload is never HEAVIER than what you lifted', () => {
    const bad: string[] = []
    everyCombination(input => {
      const r = predictNextWeight(input)
      if (!r.rationale.startsWith('deload')) return
      const base = input.prevBest?.weight_kg ?? 0
      if ((r.weight_kg ?? 0) > base) {
        bad.push(`${r.rationale} produced ${r.weight_kg} from ${base}`)
      }
    })
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('a bump is never LIGHTER than what you lifted', () => {
    const bad: string[] = []
    everyCombination(input => {
      const r = predictNextWeight(input)
      if (!r.rationale.startsWith('bump')) return
      const settled = input.prevSets.filter(s => (s.reps ?? 0) > 0)
      const base = settled.length ? (settled[settled.length - 1].weight_kg ?? 0) : (input.prevBest?.weight_kg ?? 0)
      if ((r.weight_kg ?? 0) < base) {
        bad.push(`${r.rationale} produced ${r.weight_kg} from ${base}`)
      }
    })
    expect(bad.slice(0, 5)).toEqual([])
  })
})

describe('INVARIANT: decideNextSet output is always usable', () => {
  it('rest is always >= 20s and a multiple of 5', () => {
    const bad: string[] = []
    for (const name of ['Lat Pulldown', 'Cable Lateral Raise', 'Mystery Machine', '']) {
      for (const w of WEIGHTS) {
        for (const range of RANGES) {
          for (const rir of RIRS) {
            const r = decideNextSet({
              exerciseName: name,
              prevBest: w === undefined ? null : { weight_kg: w, reps: 10 },
              prevSets: w === undefined ? [] : [{ weight_kg: w, reps: 12 }],
              repRange: range,
              lastSetRIR: rir,
              session: { positionInSession: 0, totalExercises: 7, sessionVolumeSoFar: 0 },
            })
            if (r.restSeconds < 20 || r.restSeconds % 5 !== 0 || !Number.isFinite(r.restSeconds)) {
              bad.push(`rest ${r.restSeconds} for ${name}/${w}/${range}`)
            }
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('weightDown <= weight <= weightUp, always', () => {
    const bad: string[] = []
    for (const name of ['Lat Pulldown', 'Cable Lateral Raise', 'Leg Press', 'Mystery Machine']) {
      for (const w of [1.25, 3.4, 17, 27, 60, 200]) {
        const r = decideNextSet({
          exerciseName: name,
          prevBest: { weight_kg: w, reps: 10 },
          prevSets: [{ weight_kg: w, reps: 12 }, { weight_kg: w, reps: 12 }],
          repRange: '8-12',
          session: { positionInSession: 0, totalExercises: 7, sessionVolumeSoFar: 0 },
        })
        if (r.weight_kg === undefined) continue
        if (r.weightDown !== undefined && r.weightDown > r.weight_kg) bad.push(`down ${r.weightDown} > ${r.weight_kg} (${name})`)
        if (r.weightUp !== undefined && r.weightUp < r.weight_kg) bad.push(`up ${r.weightUp} < ${r.weight_kg} (${name})`)
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
})

describe('INVARIANT: stack snapping stays on the machine', () => {
  it('snapped weights are always inside the stack bounds', () => {
    const bad: string[] = []
    for (const name of ['Cable Lateral Raise', 'Lat Pulldown', 'Shoulder Press (machine)', 'Abdominal Crunch (machine)']) {
      const eq = resolveEquipment(name)
      if (!eq.effectiveStack) continue
      const st = eq.effectiveStack
      for (const w of [-100, 0, 0.1, 3.4, 27, 500, 99999]) {
        const s = snapToStack(st, w)
        if (!Number.isFinite(s)) bad.push(`non-finite snap ${s} for ${name}@${w}`)
        if (s < st.min || s > st.max) bad.push(`${name}: snap(${w}) = ${s}, outside [${st.min}, ${st.max}]`)
        const up = nextUpWeight(st, s)
        const down = nextDownWeight(st, s)
        if (up < s) bad.push(`${name}: nextUp(${s}) = ${up} went down`)
        if (down > s) bad.push(`${name}: nextDown(${s}) = ${down} went up`)
      }
    }
    expect(bad.slice(0, 6)).toEqual([])
  })
})

describe('INVARIANT: bodyweight lifts are not handed a barbell', () => {
  it('a bodyweight exercise with no load never gets a weight prescribed', () => {
    const r = predictNextWeight({
      prevBest: null,
      prevSets: [{ reps: 12 }, { reps: 12 }, { reps: 12 }],
      repRange: '8-12',
    })
    expect(r.weight_kg).toBeUndefined()
  })
})

describe('INVARIANT: bodyweight trend maths survives bad rows', () => {
  it('handles same-day entries without dividing by zero', () => {
    const w = weeklyChangeKg([
      { date: '2026-07-01', kg: 63 }, { date: '2026-07-01', kg: 64 },
    ])
    expect(w === null || Number.isFinite(w)).toBe(true)
  })

  it('never returns NaN or Infinity for any date pair', () => {
    const bad: string[] = []
    const dates = ['2026-07-01', '2026-06-01', '2026-07-01', 'not-a-date', '', '2026-13-45']
    for (const a of dates) for (const b of dates) {
      const w = weeklyChangeKg([{ date: a, kg: 61 }, { date: b, kg: 63 }])
      if (w !== null && !Number.isFinite(w)) bad.push(`${a} -> ${b} gave ${w}`)
    }
    expect(bad).toEqual([])
  })

  it('diagnosis never throws and always returns a headline', () => {
    const bad: string[] = []
    const sets = [
      [], [{ date: 'x', kg: NaN }], [{ date: '2026-07-01', kg: 0 }],
      [{ date: '2026-06-01', kg: 61 }, { date: '2026-07-01', kg: 63 }],
    ]
    for (const s of sets) {
      try {
        const d = diagnoseProgress(s, [{ name: 'A', topWeights: [10, 10, 10] }])
        if (!d.headline || d.headline.includes('NaN') || d.headline.includes('undefined')) {
          bad.push(`headline "${d.headline}" from ${JSON.stringify(s)}`)
        }
      } catch (e) { bad.push(`threw on ${JSON.stringify(s)}: ${String(e)}`) }
    }
    expect(bad).toEqual([])
  })
})

describe('INVARIANT: skill ladder never misreports progress', () => {
  it('pct is always 0..1 and cleared never exceeds the ladder', () => {
    const bad: string[] = []
    for (const ladder of [SKILL_LADDER.hold, SKILL_LADDER.reps]) {
      for (const v of [-50, -1, 0, 0.5, 19, 20, 21, 44, 45, 59, 60, 1000, NaN]) {
        const r = ladderRung(v, ladder)
        if (!Number.isFinite(r.pct) && !Number.isNaN(v)) bad.push(`pct ${r.pct} at ${v}`)
        if (Number.isFinite(r.pct) && (r.pct < 0 || r.pct > 1)) bad.push(`pct ${r.pct} out of range at ${v}`)
        if (r.cleared < 0 || r.cleared > ladder.length) bad.push(`cleared ${r.cleared} at ${v}`)
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('bests ignore zero and negative records', () => {
    const b = skillBests([{
      id: 'x', title: 'Skill', start_time: '2026-07-28T08:00:00Z', end_time: '2026-07-28T08:10:00Z',
      exercises: [{ name: 'Pike pushups', sets: [{ reps: 0 }, { reps: -3 }] }],
    }])
    expect(b['Pike pushups']).toBeUndefined()
  })
})

describe('INVARIANT: rep range parsing', () => {
  it('never returns min > max, never non-finite', () => {
    const bad: string[] = []
    for (const s of ['8-12', '12-8', '0-5', '-3--1', '5', 'a-b', '99999-99999', '8 – 12', '8—12', '']) {
      const r = parseRepRange(s)
      if (!r) continue
      if (r.min > r.max) bad.push(`${s} -> min ${r.min} > max ${r.max}`)
      if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) bad.push(`${s} -> non-finite`)
      if (r.min <= 0) bad.push(`${s} -> min ${r.min} <= 0`)
    }
    expect(bad).toEqual([])
  })
})

describe('INVARIANT: stalled-lift detection', () => {
  it('never counts more stalled lifts than exist', () => {
    const lifts = [
      { name: 'A', topWeights: [] as number[] },
      { name: 'B', topWeights: [10] },
      { name: 'C', topWeights: [10, 10] },
      { name: 'D', topWeights: [12, 10] },
    ]
    const n = countStalledLifts(lifts)
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(lifts.length)
  })
})
