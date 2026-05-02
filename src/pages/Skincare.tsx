import { useEffect, useMemo, useState } from 'react'

type RoutineStep = { id: string; label: string; icon: string }
type DayLog = { date: string; morning: string[]; evening: string[] }

const MORNING_STEPS: RoutineStep[] = [
  { id: 'cleanse', label: 'Cleanse', icon: '🫧' },
  { id: 'moisturize', label: 'Moisturize', icon: '🧴' },
  { id: 'spf', label: 'SPF', icon: '☀️' },
]

const EVENING_STEPS: RoutineStep[] = [
  { id: 'cleanse', label: 'Cleanse', icon: '🫧' },
  { id: 'treat', label: 'Treat', icon: '✨' },
  { id: 'moisturize', label: 'Moisturize', icon: '🧴' },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function getLog(): DayLog[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('skincare_log') || '[]')
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore corrupt JSON */ }
  return []
}

function setLog(next: DayLog[]) {
  try { localStorage.setItem('skincare_log', JSON.stringify(next)) } catch { /* ignore quota errors */ }
}

function getStreak(days: DayLog[]): number {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  const d = new Date()
  while (true) {
    const key = d.toISOString().slice(0, 10)
    const row = sorted.find(r => r.date === key)
    if (!row) break
    const doneMorning = row.morning.length >= MORNING_STEPS.length
    const doneEvening = row.evening.length >= EVENING_STEPS.length
    if (!doneMorning && !doneEvening) break
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

export default function Skincare() {
  const [log, setLocalLog] = useState<DayLog[]>(() => getLog())
  const [period, setPeriod] = useState<'morning' | 'evening'>(() => new Date().getHours() < 14 ? 'morning' : 'evening')
  const [showCelebrate, setShowCelebrate] = useState(false)
  const today = todayISO()

  const todayRow = useMemo(
    () => log.find(r => r.date === today) ?? { date: today, morning: [], evening: [] },
    [log, today],
  )
  const doneIds = period === 'morning' ? todayRow.morning : todayRow.evening
  const steps = period === 'morning' ? MORNING_STEPS : EVENING_STEPS

  const streak = getStreak(log)
  const totalDoneToday = todayRow.morning.length + todayRow.evening.length

  useEffect(() => {
    if (totalDoneToday < 6) return
    const key = `skin_celebrate_${today}`
    if (localStorage.getItem(key) === '1') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot celebration when today's checklist hits 6
    setShowCelebrate(true)
    localStorage.setItem(key, '1')
    const t = window.setTimeout(() => setShowCelebrate(false), 1800)
    if (navigator.vibrate) navigator.vibrate([20, 40, 20])
    return () => window.clearTimeout(t)
  }, [totalDoneToday, today])

  function toggle(stepId: string) {
    const has = doneIds.includes(stepId)
    const updated = log.filter(r => r.date !== today)
    const nextRow: DayLog = {
      ...todayRow,
      [period]: has ? doneIds.filter(s => s !== stepId) : [...doneIds, stepId],
    }
    const next = [...updated, nextRow].sort((a, b) => a.date.localeCompare(b.date)).slice(-60)
    setLocalLog(next)
    setLog(next)
    if (navigator.vibrate) navigator.vibrate(8)
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Skincare</div>
        <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 14 }}>
          Super simple. Tap each step when done.
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>TODAY</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{totalDoneToday}/6</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>STREAK</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--orange)' }}>🔥 {streak}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['morning', 'evening'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1,
                background: period === p ? 'var(--blue)' : 'var(--card)',
                color: period === p ? '#fff' : 'var(--label2)',
                border: period === p ? 'none' : '1px solid var(--separator)',
                borderRadius: 14,
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {p === 'morning' ? '☀️ Morning' : '🌙 Evening'}
            </button>
          ))}
        </div>

        <div className="card">
          {steps.map((step) => {
            const done = doneIds.includes(step.id)
            return (
              <button
                key={step.id}
                onClick={() => toggle(step.id)}
                className="list-row"
                style={{ width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 10 }}
              >
                <span style={{ fontSize: 20 }}>{step.icon}</span>
                <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{step.label}</span>
                <span className={done ? 'badge badge-green' : 'badge'} style={!done ? { background: 'var(--gray6)', color: 'var(--label2)' } : undefined}>
                  {done ? 'Done' : 'Tap'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {showCelebrate && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="celebrate-pop" style={{ background: 'var(--card)', borderRadius: 16, padding: '10px 14px', border: '1px solid var(--separator)' }}>
            <div style={{ fontSize: 20, textAlign: 'center' }}>✨ 🧴 ✨</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Skincare complete today!</div>
          </div>
        </div>
      )}
    </div>
  )
}
