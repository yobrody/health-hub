// Honesty helper for progress rings/bars.
//
// A ring must only fill against a REAL, loaded goal. When the goal is absent
// (e.g. the `/today` fetch failed and the page fell back to a placeholder like
// 2200 kcal / 140 g), we must NOT draw a convincing filled ring against a
// number the user never set. Return `null` in that case so the caller can
// render an empty ring + an honest "—".
export function ringProgress(value: number, goal: number | null | undefined): number | null {
  if (goal == null || !Number.isFinite(goal) || goal <= 0) return null
  return Math.min(value / goal, 1)
}
