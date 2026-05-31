import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TimelineEvent } from '../api/client'

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  food:    { icon: '🍽️', color: 'var(--orange)' },
  workout: { icon: '💪', color: 'var(--blue)' },
  sleep:   { icon: '😴', color: 'var(--purple)' },
  metric:  { icon: '⚖️', color: 'var(--green)' },
  routine: { icon: '✨', color: 'var(--teal, var(--green))' },
}

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getTimeline(days).then(r => setEvents(r.events)).finally(() => setLoading(false))
  }, [days])

  // Group events by date
  const grouped: Record<string, TimelineEvent[]> = {}
  for (const ev of events) {
    if (!grouped[ev.date]) grouped[ev.date] = []
    grouped[ev.date].push(ev)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>Timeline</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: days === d ? 'var(--blue)' : 'var(--gray5)',
                color: days === d ? '#fff' : 'var(--label2)',
              }}>{d}d</button>
            ))}
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', color: 'var(--label2)', padding: 40 }}>Loading...</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--label2)', padding: 40 }}>
            No activity logged yet. Start by logging food, a workout, or sleep.
          </div>
        )}

        {Object.entries(grouped).map(([dateStr, dayEvents]) => {
          const dateLabel = dateStr === today ? 'Today' :
            dateStr === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? 'Yesterday' :
            new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

          return (
            <div key={dateStr} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label2)', marginBottom: 8, paddingLeft: 4 }}>{dateLabel}</div>
              <div className="card">
                {dayEvents.map((ev, i) => {
                  const cfg = TYPE_CONFIG[ev.type] || { icon: '📌', color: 'var(--label)' }
                  return (
                    <div key={i} className="list-row" style={{ borderBottom: i < dayEvents.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                      <div style={{ fontSize: 24, width: 36, textAlign: 'center' }}>{cfg.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: cfg.color }}>{ev.summary}</div>
                        {ev.detail && <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 1 }}>{ev.detail}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
