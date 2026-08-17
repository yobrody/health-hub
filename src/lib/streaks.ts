// Pure helpers for skincare daily streak calculation.
// Extracted from src/pages/Skincare.tsx so they can be unit-tested without
// the component or `new Date()` baked in.

export type DayLog = {
  date: string // ISO date (YYYY-MM-DD)
  morning: string[]
  evening: string[]
}

// Build the key from LOCAL date components — the cursor walks days in local
// time (`setDate`) and logs are stored by the user's local date, so keying off
// toISOString() (UTC) would drop or double-count a day near midnight for any
// user not on UTC.
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
