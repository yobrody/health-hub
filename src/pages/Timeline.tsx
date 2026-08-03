import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TimelineEvent } from '../api/client'

// ── Design config matching dark bento patterns ──────────────────────────────

const TYPE_CONFIG: Record<string, { icon: string; color: string; border: string }> = {
  food:    { icon: '...', color: 'var(--orange)', border: '#F97316' },
  workout: { icon: '...', color: 'var(--blue)', border: '#3B82F6' },
  sleep:   { icon: '...', color: 'var(--purple)', border: '#A855F7' },
  metric:  { icon: '...', color: 'var(--green)', border: '#10B981' },
  routine: { icon: '...', color: 'var(--teal, var(--green))', border: '#14B8A6' },
}

type FilterType = 'all' | 'food' | 'workout' | 'sleep'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-[var(--c-label-faint)] font-medium mb-2">{children}</div>
}

// ── Activity Heatmap (GitHub-style) ─────────────────────────────────────────

function ActivityHeatmap({ events, days = 28 }: { events: TimelineEvent[]; days?: number }) {
  // Build a map of date -> event count
  const countByDate: Record<string, number> = {}
  for (const ev of events) {
    countByDate[ev.date] = (countByDate[ev.date] || 0) + 1
  }

  // Generate last N days grid (4 weeks x 7 days)
  const today = new Date()
  const cells: { date: string; count: number; dayOfWeek: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const dateStr = d.toISOString().slice(0, 10)
    cells.push({ date: dateStr, count: countByDate[dateStr] || 0, dayOfWeek: d.getDay() })
  }

  const maxCount = Math.max(...cells.map(c => c.count), 1)
  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

  // Arrange into columns (weeks)
  const weeks: typeof cells[] = []
  let currentWeek: typeof cells = []
  for (const cell of cells) {
    const adjustedDay = cell.dayOfWeek === 0 ? 6 : cell.dayOfWeek - 1 // Mon=0
    if (currentWeek.length > 0 && adjustedDay === 0) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    currentWeek.push(cell)
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  function getColor(count: number) {
    if (count === 0) return 'var(--c-border)'
    const intensity = Math.min(count / maxCount, 1)
    if (intensity < 0.33) return '#3B82F640'
    if (intensity < 0.66) return '#3B82F680'
    return '#3B82F6'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 3 }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 4 }}>
          {weekDays.map((d, i) => (
            <div key={i} style={{ width: 12, height: 14, fontSize: 9, color: 'var(--c-label-faint)', display: 'flex', alignItems: 'center' }}>{d}</div>
          ))}
        </div>
        {/* Grid */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {week.map((cell, ci) => (
              <div key={ci} style={{
                width: 14, height: 14, borderRadius: 3,
                background: getColor(cell.count),
                transition: 'background 0.2s',
              }} title={`${cell.date}: ${cell.count} events`} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--c-label-faint)' }}>Less</span>
        {[0, 0.33, 0.66, 1].map((intensity, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: 2,
            background: intensity === 0 ? 'var(--c-border)' : `rgba(59, 130, 246, ${0.25 + intensity * 0.75})`,
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--c-label-faint)' }}>More</span>
      </div>
    </div>
  )
}

// ── Milestone logic ─────────────────────────────────────────────────────────

function getMilestones(events: TimelineEvent[]): { date: string; text: string }[] {
  const milestones: { date: string; text: string }[] = []
  const workouts = events.filter(e => e.type === 'workout')
  const totalWorkouts = workouts.length

  if (totalWorkouts >= 50) milestones.push({ date: workouts[49]?.date ?? '', text: '50th workout!' })
  else if (totalWorkouts >= 25) milestones.push({ date: workouts[24]?.date ?? '', text: '25th workout!' })
  else if (totalWorkouts >= 10) milestones.push({ date: workouts[9]?.date ?? '', text: '10th workout!' })

  // Check for streaks (consecutive days with any event)
  const dates = [...new Set(events.map(e => e.date))].sort()
  let streak = 1
  let maxStreak = 1
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]).getTime() - new Date(dates[i-1]).getTime()) / 86400000
    if (diff === 1) { streak++; maxStreak = Math.max(maxStreak, streak) }
    else streak = 1
  }
  if (maxStreak >= 7) milestones.push({ date: dates[dates.length - 1], text: `${maxStreak}-day streak!` })

  return milestones
}

// ── Main Timeline Page ──────────────────────────────────────────────────────

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    api.getTimeline(days).then(r => { if (!cancelled) { setEvents(r.events); setLoading(false) } }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [days])

  // Filter events by type
  const filtered = filter === 'all' ? events : events.filter(ev => ev.type === filter)

  // Group events by date
  const grouped: Record<string, TimelineEvent[]> = {}
  for (const ev of filtered) {
    if (!grouped[ev.date]) grouped[ev.date] = []
    grouped[ev.date].push(ev)
  }

  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [yesterday] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10))

  // Weekly summary
  const thisWeekStart = new Date()
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay() + 1)
  const thisWeekStr = thisWeekStart.toISOString().slice(0, 10)
  const weekEvents = events.filter(e => e.date >= thisWeekStr)
  const weekWorkouts = weekEvents.filter(e => e.type === 'workout').length
  const weekFood = weekEvents.filter(e => e.type === 'food')
  const weekSleep = weekEvents.filter(e => e.type === 'sleep')

  // Milestones
  const milestones = getMilestones(events)
  const milestoneDates = new Set(milestones.map(m => m.date))

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>Timeline</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, minHeight: 36,
                background: days === d ? 'var(--blue)' : 'var(--c-border)',
                color: days === d ? '#fff' : 'var(--c-label-dim)',
              }}>{d}d</button>
            ))}
          </div>
        </div>

        {/* ─── Weekly Summary ─── */}
        <Card>
          <CardLabel>This Week</CardLabel>
          <div style={{ fontSize: 14, color: 'var(--c-label)', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{weekWorkouts}</span>
            <span style={{ color: 'var(--c-label-dim)' }}> workouts</span>
            <span style={{ color: 'var(--c-label-faint)', margin: '0 6px' }}>/</span>
            <span style={{ fontWeight: 600 }}>{weekFood.length}</span>
            <span style={{ color: 'var(--c-label-dim)' }}> meals logged</span>
            <span style={{ color: 'var(--c-label-faint)', margin: '0 6px' }}>/</span>
            <span style={{ fontWeight: 600 }}>{weekSleep.length}</span>
            <span style={{ color: 'var(--c-label-dim)' }}> sleep logs</span>
          </div>
        </Card>

        {/* ─── Activity Heatmap ─── */}
        <Card>
          <CardLabel>Activity (4 weeks)</CardLabel>
          <ActivityHeatmap events={events} days={Math.max(days, 14)} />
        </Card>

        {/* ─── Milestones ─── */}
        {milestones.length > 0 && (
          <Card>
            <CardLabel>Milestones</CardLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {milestones.map((m, i) => (
                <span key={i} style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8,
                  background: '#F59E0B18', color: '#F59E0B', border: '1px solid #F59E0B30',
                }}>{m.text}</span>
              ))}
            </div>
          </Card>
        )}

        {/* ─── Type Filter ─── */}
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { id: 'all', label: 'All' },
            { id: 'food', label: 'Food' },
            { id: 'workout', label: 'Workout' },
            { id: 'sleep', label: 'Sleep' },
          ] as const).map(f => (
            <button key={f.id} onClick={() => { setFilter(f.id); if (navigator.vibrate) navigator.vibrate(5) }} style={{
              flex: 1, padding: '10px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, minHeight: 44,
              background: filter === f.id ? 'var(--blue)' : 'var(--c-card)',
              color: filter === f.id ? '#fff' : 'var(--c-label-dim)',
              transition: 'background 0.15s, color 0.15s',
              border: `1px solid ${filter === f.id ? 'var(--blue)' : 'var(--c-border)'}`,
            }}>{f.label}</button>
          ))}
        </div>

        {/* ─── Timeline Events ─── */}
        {loading && <div style={{ textAlign: 'center', color: 'var(--c-label-dim)', padding: 40 }}>Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-label)', marginBottom: 8 }}>
              {filter !== 'all' ? `No ${filter} events yet` : 'Your health timeline starts here'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--c-label-dim)', lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>
              {filter !== 'all'
                ? `No ${filter} events in the last ${days} days. Try expanding the time range or logging a ${filter} entry.`
                : 'Every meal, workout, and sleep log will appear here as a timeline. Start by logging something on the Today page.'}
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([dateStr, dayEvents]) => {
          const dateLabel = dateStr === today ? 'Today' :
            dateStr === yesterday ? 'Yesterday' :
            new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

          const hasMilestone = milestoneDates.has(dateStr)
          const dayMilestones = milestones.filter(m => m.date === dateStr)

          return (
            <div key={dateStr}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-label-dim)' }}>{dateLabel}</div>
                <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
                <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>{dayEvents.length} events</div>
              </div>
              <div style={{
                background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
                overflow: 'hidden', marginBottom: 4,
              }}>
                {dayEvents.map((ev, i) => {
                  const cfg = TYPE_CONFIG[ev.type] || { icon: '...', color: 'var(--c-label)', border: '#71717A' }
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                      borderBottom: i < dayEvents.length - 1 ? '1px solid var(--c-border)' : 'none',
                      borderLeft: `3px solid ${cfg.border}`,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: cfg.color }}>{ev.summary}</div>
                        {ev.detail && <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginTop: 2 }}>{ev.detail}</div>}
                      </div>
                      {ev.time && <div style={{ fontSize: 11, color: 'var(--c-label-faint)', fontFamily: "'JetBrains Mono', monospace" }}>{ev.time}</div>}
                    </div>
                  )
                })}
              </div>
              {/* Inline milestones */}
              {hasMilestone && dayMilestones.map((m, mi) => (
                <div key={mi} style={{
                  margin: '4px 0 8px', padding: '8px 12px', borderRadius: 8,
                  background: '#F59E0B12', border: '1px solid #F59E0B25',
                  fontSize: 13, fontWeight: 600, color: '#F59E0B', textAlign: 'center',
                }}>{m.text}</div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
