import type { WorkoutAnalysis } from './gym-analysis'

export type Tone = 'good' | 'warn' | 'info'
export interface Highlight { icon: string; text: string; tone: Tone }

/**
 * Turn the local scorecard into a few plain-language coach takeaways. Purely
 * derived from `analysis` — renders instantly, works offline, and gives the
 * "Coach insights" section real substance before (or without) the AI call.
 */
export function buildHighlights(a: WorkoutAnalysis): Highlight[] {
  const h: Highlight[] = []
  const plural = (n: number) => (n === 1 ? '' : 's')

  if (a.prHits.length > 0) {
    h.push({ icon: '🏆', tone: 'good', text: `${a.prHits.length} personal record${plural(a.prHits.length)} hit — new bests locked in.` })
  }

  if (a.volumeDeltaPct !== null) {
    const pct = Math.round(a.volumeDeltaPct * 100)
    if (pct >= 3) h.push({ icon: '📈', tone: 'good', text: `Volume up ${pct}% vs your last ${a.title}. You're building.` })
    else if (pct <= -3) h.push({ icon: '📉', tone: 'warn', text: `Volume down ${Math.abs(pct)}% vs last time — fine on a deload, worth a look otherwise.` })
    else h.push({ icon: '➖', tone: 'info', text: `Volume held steady vs last time.` })
  }

  if (a.setsAtTopOfRange > 0) {
    h.push({ icon: '💪', tone: 'good', text: `${a.setsAtTopOfRange} set${plural(a.setsAtTopOfRange)} at the top of your rep range — ready to add weight next time.` })
  }

  if (a.setsBelowRange > 0) {
    h.push({ icon: '⚠️', tone: 'warn', text: `${a.setsBelowRange} set${plural(a.setsBelowRange)} below range — ease the load a notch or add rest.` })
  }

  if (a.totalSets > 0) {
    const completion = a.completedSets / a.totalSets
    if (completion >= 1) h.push({ icon: '✅', tone: 'good', text: `Finished every set — ${a.completedSets}/${a.totalSets} logged.` })
    else if (completion < 0.8) h.push({ icon: '🔸', tone: 'info', text: `Logged ${a.completedSets}/${a.totalSets} sets this session.` })
  }

  if (h.length === 0) {
    h.push({ icon: '📝', tone: 'info', text: `Session logged. Log a few more and trends will start showing here.` })
  }
  return h
}
