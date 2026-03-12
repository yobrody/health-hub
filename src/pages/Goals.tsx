import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WeekStats, Goals, GoalsUpdateInput } from '../api/client'

function MiniBar({ value, goal, color }: { value: number; goal: number; color: string }) {
  return (
    <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        height: '100%', borderRadius: 3, background: color,
        width: `${Math.min(value / Math.max(goal, 1) * 100, 100)}%`,
        transition: 'width 0.6s ease'
      }} />
    </div>
  )
}

function WeekChart({ days }: { days: WeekStats['food_by_day'] }) {
  const maxKcal = Math.max(...days.map(d => d.total_kcal), 1000)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 64, padding: '0 4px' }}>
      {[...days].reverse().map((d, i) => {
        const h = Math.max((d.total_kcal / maxKcal) * 60, d.logged ? 4 : 0)
        const label = new Date(d.date).toLocaleDateString('en-GB', { weekday: 'narrow' })
        const isToday = i === days.length - 1
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', height: h, borderRadius: 4,
              background: isToday ? 'var(--blue)' : d.logged ? 'var(--gray4)' : 'var(--gray6)',
              transition: 'height 0.5s ease', minHeight: d.logged ? 4 : 0
            }} />
            <div style={{ fontSize: 10, color: isToday ? 'var(--blue)' : 'var(--label3)', fontWeight: isToday ? 700 : 400 }}>
              {label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function GoalsPage() {
  const [stats, setStats] = useState<WeekStats | null>(null)
  const [goals, setGoals] = useState<Goals>({ calories: 2200, protein: 160, gym_days: 4 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GoalsUpdateInput>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getWeekStats().then(s => {
      setStats(s)
      setGoals({ calories: s.goal_kcal, protein: 160, gym_days: s.goal_gym_days })
    })
    api.getGoals().then(g => setGoals(g.parsed))
  }, [])

  async function saveGoals() {
    setSaving(true)
    const updated = await api.updateGoals(draft) as { ok: boolean; goals: Goals }
    setGoals(updated.goals)
    setDraft({})
    setEditing(false)
    setSaving(false)
  }

  const loggedDays = stats?.logged_days ?? 0
  const avgKcal = stats?.avg_kcal ?? 0
  const workoutCount = stats?.workout_count ?? 0

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Goals</div>
          <button
            onClick={() => editing ? saveGoals() : setEditing(true)}
            style={{
              background: editing ? 'var(--blue)' : 'none',
              border: editing ? 'none' : '1.5px solid var(--blue)',
              borderRadius: 20, padding: '8px 16px', color: editing ? '#fff' : 'var(--blue)',
              fontSize: 15, fontWeight: 600, cursor: 'pointer'
            }}
          >{saving ? '…' : editing ? 'Save' : 'Edit'}</button>
        </div>

        {/* This week summary */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600, marginBottom: 12 }}>
            THIS WEEK
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Days logged', value: `${loggedDays}/7`, color: loggedDays >= 5 ? 'var(--green)' : loggedDays >= 3 ? 'var(--orange)' : 'var(--red)' },
              { label: 'Avg kcal', value: avgKcal > 0 ? avgKcal.toLocaleString() : '—', color: 'var(--blue)' },
              { label: 'Workouts', value: `${workoutCount}/${goals.gym_days}`, color: workoutCount >= goals.gym_days ? 'var(--green)' : 'var(--orange)' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 11, color: 'var(--label2)', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
          {stats && <WeekChart days={stats.food_by_day} />}
        </div>

        {/* Goals cards */}
        <div className="section-label">Nutrition goals</div>
        <div className="card" style={{ marginBottom: 12 }}>
          {/* Calories */}
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Daily Calories</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Target intake</div>
              </div>
              {editing ? (
                <input
                  type="number"
                  style={{
                    width: 90, background: 'var(--gray6)', border: 'none', borderRadius: 10,
                    padding: '8px 12px', fontSize: 17, fontWeight: 700, textAlign: 'right',
                    color: 'var(--blue)', outline: 'none'
                  }}
                  defaultValue={goals.calories}
                  onChange={e => setDraft(d => ({ ...d, calories: parseInt(e.target.value) }))}
                />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>{goals.calories.toLocaleString()}</div>
              )}
            </div>
            <MiniBar value={avgKcal} goal={goals.calories} color="var(--blue)" />
          </div>

          {/* Protein */}
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Protein</div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>Daily target</div>
              </div>
              {editing ? (
                <input
                  type="number"
                  style={{
                    width: 90, background: 'var(--gray6)', border: 'none', borderRadius: 10,
                    padding: '8px 12px', fontSize: 17, fontWeight: 700, textAlign: 'right',
                    color: 'var(--orange)', outline: 'none'
                  }}
                  defaultValue={goals.protein}
                  onChange={e => setDraft(d => ({ ...d, protein: parseInt(e.target.value) }))}
                />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--orange)' }}>{goals.protein}g</div>
              )}
            </div>
            <MiniBar value={Math.round(avgKcal * 0.15 / 4)} goal={goals.protein} color="var(--orange)" />
          </div>
        </div>

        <div className="section-label">Fitness goals</div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="list-row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Gym sessions</div>
              <div style={{ fontSize: 13, color: 'var(--label2)' }}>Per week</div>
            </div>
            {editing ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {[3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setDraft(d => ({ ...d, gym_days: n }))} style={{
                    width: 36, height: 36, borderRadius: 18, border: 'none',
                    background: (draft.gym_days ?? goals.gym_days) === n ? 'var(--blue)' : 'var(--gray5)',
                    color: (draft.gym_days ?? goals.gym_days) === n ? '#fff' : 'var(--label)',
                    fontSize: 16, fontWeight: 700, cursor: 'pointer'
                  }}>{n}</button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{goals.gym_days}×</div>
            )}
          </div>

          {/* Streak visualization */}
          <div style={{ padding: '8px 16px 16px', display: 'flex', gap: 6 }}>
            {Array.from({ length: goals.gym_days }, (_, i) => (
              <div key={i} style={{
                flex: 1, height: 8, borderRadius: 4,
                background: i < workoutCount ? 'var(--green)' : 'var(--gray5)',
                transition: 'background 0.3s'
              }} />
            ))}
          </div>
        </div>

        {/* Lucky Telegram shortcut */}
        <div className="section-label">Quick actions</div>
        <div className="card">
          <a
            href="https://t.me/yolucky_bot"
            target="_blank"
            rel="noopener"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              textDecoration: 'none', color: 'var(--label)'
            }}
          >
            <div style={{ fontSize: 28 }}>🍀</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Ask Lucky</div>
              <div style={{ fontSize: 13, color: 'var(--label2)' }}>Open @yolucky_bot on Telegram</div>
            </div>
            <div style={{ fontSize: 16, color: 'var(--label3)' }}>›</div>
          </a>
          <div style={{ height: '0.5px', background: 'var(--separator)', margin: '0 16px' }} />
          <a
            href={`https://t.me/yolucky_bot?start=what_can_i_make`}
            target="_blank"
            rel="noopener"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              textDecoration: 'none', color: 'var(--label)'
            }}
          >
            <div style={{ fontSize: 28 }}>🍽️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Meal suggestions</div>
              <div style={{ fontSize: 13, color: 'var(--label2)' }}>Ask Lucky what to cook</div>
            </div>
            <div style={{ fontSize: 16, color: 'var(--label3)' }}>›</div>
          </a>
        </div>

        <div style={{ height: 32 }} />
      </div>
    </div>
  )
}
