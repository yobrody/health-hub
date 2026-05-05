import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { RoutineData } from '../api/client'
import { showToast } from '../toast'

const ROUTINES = [
  { id: 'meditate', label: 'Meditate', icon: '🧘' },
  { id: 'vitamins', label: 'Vitamins', icon: '💊' },
  { id: 'journal',  label: 'Journal',  icon: '📓' },
  { id: 'read',     label: 'Read',     icon: '📚' },
  { id: 'stretch',  label: 'Stretch',  icon: '🤸' },
]

export default function Routines() {
  const [data, setData] = useState<Record<string, RoutineData>>({})
  const [loading, setLoading] = useState(true)
  const [logging, setLogging] = useState<string | null>(null)

  function loadAll() {
    setLoading(true)
    Promise.all(ROUTINES.map(r =>
      api.getRoutine(r.id).then(d => [r.id, d] as const).catch(() => [r.id, null] as const)
    ))
      .then(results => {
        const next: Record<string, RoutineData> = {}
        for (const [id, d] of results) if (d) next[id] = d
        setData(next)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  async function markDone(id: string) {
    const current = data[id]
    if (current?.done_today) return
    setLogging(id)
    // optimistic update
    setData(prev => ({
      ...prev,
      [id]: {
        name: id,
        done_today: true,
        streak: (prev[id]?.streak ?? 0) + 1,
        log: prev[id]?.log ?? [],
      },
    }))
    if (navigator.vibrate) navigator.vibrate(10)
    try {
      await api.logRoutine(id)
    } catch {
      showToast('Failed to log — try again', 'err')
      // revert
      setData(prev => ({
        ...prev,
        [id]: current ?? { name: id, done_today: false, streak: 0, log: [] },
      }))
    } finally {
      setLogging(null)
    }
  }

  const doneCount = ROUTINES.filter(r => data[r.id]?.done_today).length

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Routines</div>
        <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 20 }}>
          {loading ? 'Loading…' : `${doneCount} of ${ROUTINES.length} done today`}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ROUTINES.map(r => {
            const d = data[r.id]
            const done = d?.done_today ?? false
            const streak = d?.streak ?? 0
            const isLogging = logging === r.id
            return (
              <button
                key={r.id}
                onClick={() => markDone(r.id)}
                disabled={done || isLogging}
                aria-label={done ? `${r.label} done today` : `Mark ${r.label} done`}
                className={done ? 'card' : 'card routine-tap'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  border: 'none',
                  textAlign: 'left',
                  cursor: done ? 'default' : 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  opacity: done ? 0.7 : 1,
                  transition: 'opacity 0.15s, transform 0.12s ease, box-shadow 0.18s ease',
                }}
              >
                <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{r.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label)' }}>{r.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
                    {streak > 0 ? `🔥 ${streak} day${streak === 1 ? '' : 's'}` : 'No streak yet'}
                  </div>
                </div>
                {done ? (
                  <span style={{
                    background: 'var(--green)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                ) : (
                  <span style={{
                    color: 'var(--blue)',
                    fontSize: 14,
                    fontWeight: 600,
                    flexShrink: 0,
                    opacity: isLogging ? 0.4 : 1,
                  }}>
                    {isLogging ? '…' : 'Mark done'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {!loading && (
          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--label3)', textAlign: 'center' }}>
            Tap a routine to log it for today. Streak counts consecutive days.
          </div>
        )}
      </div>
    </div>
  )
}
