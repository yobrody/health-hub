import { useEffect, useState } from 'react'
import { api } from '../api/client'

// ── Types ────────────────────────────────────────────────────────────

type ActivityType = 'all' | 'food' | 'workout' | 'weight' | 'routine'

interface DayActivity {
  date: string
  food: boolean
  workout: boolean
  weight: boolean
  routine: boolean
  count: number // total activities that day
}

interface StreakInfo {
  type: string
  current: number
  longest: number
}

interface BadgeInfo {
  type: string
  milestone: number
  earned: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Build a map of date -> activity flags for the last N days. */
function buildActivityMap(
  foodDates: Set<string>,
  workoutDates: Set<string>,
  weightDates: Set<string>,
  routineDates: Set<string>,
  days: number,
): DayActivity[] {
  const result: DayActivity[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = isoDate(d)
    const food = foodDates.has(key)
    const workout = workoutDates.has(key)
    const weight = weightDates.has(key)
    const routine = routineDates.has(key)
    const count = (food ? 1 : 0) + (workout ? 1 : 0) + (weight ? 1 : 0) + (routine ? 1 : 0)
    result.push({ date: key, food, workout, weight, routine, count })
  }
  return result
}

/** Count current consecutive-day streak ending at today for a given flag. */
function currentStreak(days: DayActivity[], flag: ActivityType): number {
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const active = flag === 'all'
      ? days[i].count > 0
      : days[i][flag as keyof Omit<DayActivity, 'date' | 'count'>]
    if (active) streak++
    else break
  }
  return streak
}

/** Find longest consecutive streak in the dataset for a given flag. */
function longestStreak(days: DayActivity[], flag: ActivityType): number {
  let max = 0, cur = 0
  for (const day of days) {
    const active = flag === 'all'
      ? day.count > 0
      : day[flag as keyof Omit<DayActivity, 'date' | 'count'>]
    if (active) { cur++; max = Math.max(max, cur) }
    else cur = 0
  }
  return max
}

/** Best count of a weekly metric (e.g. "most workouts in a week"). */
function bestWeek(days: DayActivity[], flag: ActivityType): number {
  let best = 0
  // Walk through in 7-day windows
  for (let start = 0; start <= days.length - 7; start++) {
    let weekCount = 0
    for (let j = start; j < start + 7; j++) {
      const active = flag === 'all'
        ? days[j].count > 0
        : days[j][flag as keyof Omit<DayActivity, 'date' | 'count'>]
      if (active) weekCount++
    }
    best = Math.max(best, weekCount)
  }
  return best
}

// ── Heatmap cell color ───────────────────────────────────────────────

function cellColor(count: number, filter: ActivityType): string {
  if (count === 0) return 'var(--c-border)'
  // Different accent per type
  const palette = filter === 'workout'
    ? ['#10B981', '#34D399']     // green
    : filter === 'food'
    ? ['#3B82F6', '#60A5FA']     // blue
    : filter === 'weight'
    ? ['#F59E0B', '#FBBF24']     // amber
    : filter === 'routine'
    ? ['#8B5CF6', '#A78BFA']     // purple
    : ['#3B82F6', '#60A5FA']     // all = blue
  return count >= 2 ? palette[1] : palette[0]
}

// ── Milestone badges ─────────────────────────────────────────────────

const MILESTONES = [7, 14, 30, 60, 90]
const BADGE_LABELS: Record<number, string> = {
  7: '1 Week',
  14: '2 Weeks',
  30: '1 Month',
  60: '2 Months',
  90: '3 Months',
}

function computeBadges(days: DayActivity[]): BadgeInfo[] {
  const types: ActivityType[] = ['food', 'workout', 'weight', 'routine']
  const badges: BadgeInfo[] = []
  for (const type of types) {
    const longest = longestStreak(days, type)
    for (const m of MILESTONES) {
      badges.push({ type, milestone: m, earned: longest >= m })
    }
  }
  return badges
}

// ── Pill toggle component ────────────────────────────────────────────

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors border ${
        active
          ? 'bg-[var(--c-accent)] text-white border-[var(--c-accent)]'
          : 'bg-transparent text-[var(--c-label-dim)] border-[var(--c-border)] hover:border-[#3F3F46]'
      }`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {label}
    </button>
  )
}

// ── Main page ────────────────────────────────────────────────────────

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKS = 8

export default function Streaks() {
  const [filter, setFilter] = useState<ActivityType>('all')
  const [days, setDays] = useState<DayActivity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const totalDays = WEEKS * 7
    Promise.all([
      api.getFoodHistory(totalDays).catch(() => []),
      api.getWorkouts(100).catch(() => []),
      api.getWeightLog(totalDays).catch(() => ({ entries: [] })),
      // Fetch all tracked routines
      Promise.allSettled(
        ['meditate', 'vitamins', 'journal', 'read', 'stretch', 'morning-skincare', 'evening-skincare']
          .map(r => api.getRoutine(r))
      ),
    ]).then(([foodHistory, workouts, weightData, routineResults]) => {
      const foodDates = new Set<string>()
      for (const day of foodHistory as Array<{ date: string; logged: boolean }>) {
        if (day.logged) foodDates.add(day.date)
      }

      const workoutDates = new Set<string>()
      for (const w of workouts as Array<{ start_time: string }>) {
        const d = w.start_time?.slice(0, 10)
        if (d) workoutDates.add(d)
      }

      const weightDates = new Set<string>()
      const entries = (weightData as { entries: Array<{ date: string }> }).entries || []
      for (const w of entries) {
        if (w.date) weightDates.add(w.date)
      }

      const routineDates = new Set<string>()
      for (const r of routineResults) {
        if (r.status === 'fulfilled') {
          const data = r.value as { log: Array<{ date: string }> }
          for (const entry of data.log || []) {
            if (entry.date) routineDates.add(entry.date)
          }
        }
      }

      setDays(buildActivityMap(foodDates, workoutDates, weightDates, routineDates, totalDays))
      setLoading(false)
    })
  }, [])

  // Compute streaks
  const streaks: StreakInfo[] = (['food', 'workout', 'weight', 'routine'] as ActivityType[]).map(type => ({
    type,
    current: currentStreak(days, type),
    longest: longestStreak(days, type),
  }))

  const badges = computeBadges(days)
  const earnedBadges = badges.filter(b => b.earned)

  // Build heatmap grid: 7 rows (Mon-Sun) x WEEKS columns
  // We need to align days so column 0 row 0 = Monday of the oldest week
  const heatmapCells: { date: string; count: number; dayOfWeek: number }[] = []
  for (const day of days) {
    const d = new Date(day.date + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7 // 0=Mon, 6=Sun
    const count = filter === 'all'
      ? day.count
      : (day[filter as keyof Omit<DayActivity, 'date' | 'count'>] ? 1 : 0)
    heatmapCells.push({ date: day.date, count, dayOfWeek: dow })
  }

  // Group into weeks (columns)
  type HeatmapCell = { date: string; count: number; dayOfWeek: number }
  const weeks: HeatmapCell[][] = []
  let currentWeek: HeatmapCell[] = []
  for (const cell of heatmapCells) {
    currentWeek.push(cell)
    if (cell.dayOfWeek === 6) { // Sunday = end of week
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  const typeEmoji = (t: string) =>
    t === 'food' ? '\uD83C\uDF7D\uFE0F'
    : t === 'workout' ? '\uD83D\uDCAA'
    : t === 'weight' ? '\u2696\uFE0F'
    : t === 'routine' ? '\u2728'
    : '\uD83D\uDD25'

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: 'max(20px, env(safe-area-inset-top, 0px) + 20px) 16px calc(16px + var(--safe-bottom))',
      background: 'var(--c-bg)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--c-label)', margin: 0 }}>
          {'\uD83D\uDD25'} Streaks
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-label-dim)', marginTop: 4 }}>
          Track your consistency across all health habits.
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['all', 'food', 'workout', 'weight', 'routine'] as ActivityType[]).map(t => (
          <FilterPill
            key={t}
            label={t === 'all' ? 'All Activity' : typeLabel(t)}
            active={filter === t}
            onClick={() => setFilter(t)}
          />
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--c-label-faint)' }}>
          Loading activity data...
        </div>
      ) : (
        <>
          {/* Heatmap */}
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', marginBottom: 12 }}>
              Contribution Heatmap
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {/* Day labels column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 0 }}>
                {DAY_LABELS.map((label, i) => (
                  <div key={i} style={{
                    width: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    fontSize: 10,
                    color: 'var(--c-label-faint)',
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}>
                    {i % 2 === 0 ? label : ''}
                  </div>
                ))}
              </div>
              {/* Weeks columns */}
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {weeks.map((week, wi) => (
                  <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                    {Array.from({ length: 7 }).map((_, dow) => {
                      const cell = week.find(c => c.dayOfWeek === dow)
                      return (
                        <div
                          key={dow}
                          title={cell ? `${cell.date}: ${cell.count} activities` : ''}
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 3,
                            background: cell ? cellColor(cell.count, filter) : 'var(--c-border)',
                            opacity: cell ? (cell.count === 0 ? 0.3 : 1) : 0.1,
                            transition: 'background 0.2s ease, opacity 0.2s ease',
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--c-label-faint)' }}>Less</span>
              {[0, 1, 2].map(n => (
                <div key={n} style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: cellColor(n, filter),
                  opacity: n === 0 ? 0.3 : 1,
                }} />
              ))}
              <span style={{ fontSize: 10, color: 'var(--c-label-faint)' }}>More</span>
            </div>
          </div>

          {/* Current Streaks */}
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', marginBottom: 12 }}>
              Current Streaks
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {streaks.map(s => (
                <div key={s.type} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: 'var(--c-bg)',
                  borderRadius: 10,
                  border: '1px solid var(--c-border)',
                }}>
                  <span style={{ fontSize: 22 }}>{s.current > 0 ? '\uD83D\uDD25' : '\u2B50'}</span>
                  <div>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      color: s.current > 0 ? 'var(--c-orange)' : 'var(--c-label-dim)',
                      lineHeight: 1,
                    }}>
                      {s.current}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 2 }}>
                      {typeLabel(s.type)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Personal Records */}
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', marginBottom: 12 }}>
              Personal Records
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {streaks.map(s => (
                <div key={s.type} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--c-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{typeEmoji(s.type)}</span>
                    <span style={{ fontSize: 13, color: 'var(--c-label)' }}>
                      Longest {typeLabel(s.type).toLowerCase()} streak
                    </span>
                  </div>
                  <span style={{
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    color: 'var(--c-label)',
                  }}>
                    {s.longest} days
                  </span>
                </div>
              ))}
              {/* Best week records */}
              {(['workout', 'food'] as ActivityType[]).map(type => {
                const best = bestWeek(days, type)
                return best > 0 ? (
                  <div key={`best-week-${type}`} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--c-border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{typeEmoji(type)}</span>
                      <span style={{ fontSize: 13, color: 'var(--c-label)' }}>
                        Most {typeLabel(type).toLowerCase()}s in a week
                      </span>
                    </div>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      color: 'var(--c-label)',
                    }}>
                      {best}
                    </span>
                  </div>
                ) : null
              })}
            </div>
          </div>

          {/* Milestone Badges */}
          {earnedBadges.length > 0 && (
            <div style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-border)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', marginBottom: 12 }}>
                Badges Earned
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {earnedBadges.map(b => (
                  <div
                    key={`${b.type}-${b.milestone}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 20,
                      background: 'var(--c-bg)',
                      border: '1px solid var(--c-border)',
                      fontSize: 12,
                    }}
                  >
                    <span>{typeEmoji(b.type)}</span>
                    <span style={{ color: 'var(--c-label)', fontWeight: 600 }}>
                      {BADGE_LABELS[b.milestone]}
                    </span>
                    <span style={{ color: 'var(--c-label-faint)' }}>
                      {typeLabel(b.type)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unearned badges as targets */}
          {badges.filter(b => !b.earned).length > 0 && (
            <div style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-border)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', marginBottom: 12 }}>
                Next Milestones
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {/* Show the closest unearned badge per type */}
                {(['food', 'workout', 'weight', 'routine'] as ActivityType[]).map(type => {
                  const nextBadge = badges.find(b => b.type === type && !b.earned)
                  if (!nextBadge) return null
                  const cur = streaks.find(s => s.type === type)?.longest ?? 0
                  return (
                    <div
                      key={`next-${type}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: 20,
                        background: 'var(--c-bg)',
                        border: '1px dashed var(--c-border)',
                        fontSize: 12,
                        opacity: 0.6,
                      }}
                    >
                      <span>{typeEmoji(type)}</span>
                      <span style={{ color: 'var(--c-label-faint)' }}>
                        {BADGE_LABELS[nextBadge.milestone]} {typeLabel(type)}
                      </span>
                      <span style={{
                        color: 'var(--c-label-faint)',
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 11,
                      }}>
                        {cur}/{nextBadge.milestone}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
