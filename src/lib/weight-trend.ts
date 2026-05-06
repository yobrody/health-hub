// Pure helpers for the body-weight log. Lives outside of Today.tsx so it
// can be unit-tested without React + JSDOM, AND so the impure Date.now()
// call in WeightTile happens in the data-fetch path rather than render
// (React 19 react-hooks/purity).

export interface WeightEntry {
  date: string  // ISO YYYY-MM-DD
  kg: number
}

export interface WeightTrend {
  entries: WeightEntry[]
  latest: WeightEntry | undefined
  delta: number | null  // kg vs ~7 days ago, null if no comparable point
}

/** Compute latest weight + 7-day delta from a list of entries.
 *
 *  - Sorts entries by date (input may be unsorted; we never assume order).
 *  - Picks the most recent reading as `latest`.
 *  - For `delta`, finds the entry closest to 7 days ago, allowing a window
 *    of +1d to -3d so a missed weigh-in doesn't wipe the trend.
 *  - Returns null delta if there's no entry in that window or only one
 *    reading total — the UI surfaces "log a few more days for trend".
 *
 *  `nowMs` is injectable so tests don't need to mock Date.now(). Defaults
 *  to live time when called from the app.
 */
export function computeWeightTrend(
  entries: WeightEntry[],
  nowMs: number = Date.now(),
): WeightTrend {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]
  const ref = nowMs - 7 * 86400000
  const week = sorted.find(w => {
    const d = new Date(w.date + 'T12:00:00Z').getTime()
    // Accept ±3 days from the reference point — finds the closest reading
    // around the 7-day mark even if the user missed a weigh-in or two.
    return d <= ref + 86400000 && d >= ref - 3 * 86400000
  })
  return {
    entries: sorted,
    latest,
    delta: latest && week ? latest.kg - week.kg : null,
  }
}
