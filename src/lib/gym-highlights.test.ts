import { describe, it, expect } from 'vitest'
import { buildHighlights } from './gym-highlights'
import type { WorkoutAnalysis } from './gym-analysis'

// Minimal analysis factory — only the fields buildHighlights reads matter.
function mk(over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  return {
    workoutId: 'w1', title: 'Pull', startTime: '', endTime: '',
    durationMins: 50, workingTimeMins: 20, workToRestRatio: 0.6,
    totalSets: 12, completedSets: 12, totalVolume: 8000,
    volumeDelta: null, volumeDeltaPct: null,
    setsAtTopOfRange: 0, setsBelowRange: 0,
    prHits: [], perMuscle: [], score: 70,
    subscores: { completion: 90, progress: 60, intensity: 70, consistency: 80 },
    headline: '', ...over,
  }
}

describe('buildHighlights (coach insights #18)', () => {
  it('surfaces PRs with correct pluralisation', () => {
    const one = buildHighlights(mk({ prHits: [{} as never] }))
    expect(one.some(h => h.tone === 'good' && /1 personal record hit/.test(h.text))).toBe(true)
    const two = buildHighlights(mk({ prHits: [{}, {}] as never }))
    expect(two.some(h => /2 personal records hit/.test(h.text))).toBe(true)
  })

  it('reads volume trend up / down / flat', () => {
    expect(buildHighlights(mk({ volumeDeltaPct: 0.08 })).some(h => h.tone === 'good' && /up 8%/.test(h.text))).toBe(true)
    expect(buildHighlights(mk({ volumeDeltaPct: -0.12 })).some(h => h.tone === 'warn' && /down 12%/.test(h.text))).toBe(true)
    expect(buildHighlights(mk({ volumeDeltaPct: 0.0 })).some(h => /held steady/.test(h.text))).toBe(true)
  })

  it('flags top-of-range as ready-to-progress and below-range as ease-off', () => {
    const top = buildHighlights(mk({ setsAtTopOfRange: 3 }))
    expect(top.some(h => h.tone === 'good' && /ready to add weight/.test(h.text))).toBe(true)
    const low = buildHighlights(mk({ setsBelowRange: 2 }))
    expect(low.some(h => h.tone === 'warn' && /ease the load/.test(h.text))).toBe(true)
  })

  it('reports full vs partial completion', () => {
    expect(buildHighlights(mk({ totalSets: 10, completedSets: 10 })).some(h => /Finished every set/.test(h.text))).toBe(true)
    expect(buildHighlights(mk({ totalSets: 10, completedSets: 5 })).some(h => /Logged 5\/10 sets/.test(h.text))).toBe(true)
  })

  it('never returns empty — falls back to a neutral note', () => {
    // A bare session with no deltas, no PRs, full completion still yields at least the completion line.
    const h = buildHighlights(mk({ totalSets: 0, completedSets: 0 }))
    expect(h.length).toBeGreaterThan(0)
    expect(h.every(x => x.icon && x.text && x.tone)).toBe(true)
  })
})
