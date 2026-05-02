// Pure helpers for skincare daily streak calculation.
// Extracted from src/pages/Skincare.tsx so they can be unit-tested without
// the component or `new Date()` baked in.

export type DayLog = {
  date: string // ISO date (YYYY-MM-DD)
  morning: string[]
  evening: string[]
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Count consecutive days ending at `today` where at least one period
 * (morning or evening) was fully completed. Stops at the first gap.
 */
export function getStreak(
  days: DayLog[],
  today: Date,
  morningStepCount: number,
  eveningStepCount: number,
): number {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  const cursor = new Date(today.getTime())
  while (true) {
    const key = isoDate(cursor)
    const row = sorted.find(r => r.date === key)
    if (!row) break
    const doneMorning = row.morning.length >= morningStepCount
    const doneEvening = row.evening.length >= eveningStepCount
    if (!doneMorning && !doneEvening) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
