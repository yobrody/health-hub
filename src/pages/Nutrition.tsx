import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { FoodEntry, TodayData, HistoryDay } from '../api/client'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']

export default function Nutrition() {
  const [data, setData] = useState<TodayData | null>(null)
  const [history, setHistory] = useState<HistoryDay[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [kcal, setKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const hour = new Date().getHours()
  const defaultMeal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'

  useEffect(() => {
    setMeal(defaultMeal)
    api.getToday().then(setData)
    api.getFoodHistory(7).then(setHistory)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!desc || !kcal) return
    setSubmitting(true)
    await api.addFood({ meal, description: desc, kcal: parseInt(kcal) })
    const updated = await api.getToday()
    setData(updated)
    setDesc(''); setKcal(''); setShowAdd(false)
    setSubmitting(false)
    if (navigator.vibrate) navigator.vibrate(10)
  }

  const total = data?.total_kcal ?? 0
  const goal = data?.goals.calories ?? 2200
  const pct = Math.min(total / goal, 1)
  const remaining = Math.max(goal - total, 0)

  // Group entries by meal
  const byMeal = (data?.entries ?? []).reduce((acc: Record<string, FoodEntry[]>, e) => {
    acc[e.meal] = [...(acc[e.meal] ?? []), e]
    return acc
  }, {})

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Nutrition</div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: 'var(--blue)', color: '#fff', border: 'none',
              borderRadius: 20, padding: '8px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer'
            }}
          >+ Add</button>
        </div>

        {/* Daily summary bar */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{total.toLocaleString()}</span>
              <span style={{ fontSize: 14, color: 'var(--label2)', marginLeft: 4 }}>kcal today</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, color: 'var(--label2)' }}>{remaining > 0 ? `${remaining.toLocaleString()} remaining` : 'Goal reached!'}</div>
              <div style={{ fontSize: 13, color: 'var(--label3)' }}>of {goal.toLocaleString()} goal</div>
            </div>
          </div>
          <div style={{ height: 8, background: 'var(--gray5)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: pct > 1 ? 'var(--red)' : pct > 0.85 ? 'var(--orange)' : 'var(--blue)',
              width: `${pct * 100}%`, transition: 'width 0.6s ease, background 0.3s'
            }} />
          </div>
        </div>

        {/* Meal groups */}
        {Object.keys(byMeal).length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '48px 24px',
            color: 'var(--label2)', fontSize: 16
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🍽️</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing logged yet</div>
            <div style={{ fontSize: 14 }}>Tap + Add to start tracking</div>
          </div>
        ) : (
          MEALS.filter(m => byMeal[m]?.length).map(mealName => (
            <div key={mealName} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="section-label" style={{ marginTop: 0 }}>{mealName}</div>
                <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>
                  ~{byMeal[mealName].reduce((a, e) => a + e.kcal, 0).toLocaleString()} kcal
                </div>
              </div>
              <div className="card">
                {byMeal[mealName].map((e, i) => (
                  <div key={i} className="list-row">
                    <div style={{ width: 36, fontSize: 12, color: 'var(--label3)', fontWeight: 500 }}>{e.time}</div>
                    <div style={{ flex: 1, fontSize: 15 }}>
                      {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)' }}>~{e.kcal}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {/* 7-day history */}
        {history.length > 0 && (
          <>
            <div className="section-label">Last 7 days</div>
            <div className="card">
              {history.slice(1).map((d, i) => {
                const dayLabel = new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
                return (
                  <div key={i} className="list-row">
                    <div style={{ width: 70, fontSize: 14, color: 'var(--label2)' }}>{dayLabel}</div>
                    <div style={{ flex: 1, height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
                      {d.logged && (
                        <div style={{
                          height: '100%', borderRadius: 3,
                          background: d.total_kcal > goal ? 'var(--red)' : 'var(--blue)',
                          width: `${Math.min(d.total_kcal / goal * 100, 100)}%`
                        }} />
                      )}
                    </div>
                    <div style={{ width: 70, textAlign: 'right', fontSize: 14, fontWeight: 500 }}>
                      {d.logged ? `${d.total_kcal.toLocaleString()} kcal` : <span style={{ color: 'var(--label3)' }}>—</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Add food sheet */}
      {showAdd && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 200, display: 'flex', alignItems: 'flex-end',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div style={{
            background: 'var(--card)', borderRadius: '20px 20px 0 0',
            padding: '8px 20px 40px', width: '100%',
            animation: 'slideUp 0.3s cubic-bezier(0.32,0.72,0,1)'
          }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '8px auto 20px' }} />
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Log Food</div>

            <form onSubmit={submit}>
              {/* Meal picker */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {MEALS.map(m => (
                  <button
                    key={m} type="button"
                    onClick={() => setMeal(m)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none',
                      background: meal === m ? 'var(--blue)' : 'var(--gray5)',
                      color: meal === m ? '#fff' : 'var(--label)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer'
                    }}
                  >{m}</button>
                ))}
              </div>

              <input
                className="input-field" style={{ marginBottom: 10 }}
                placeholder="What did you eat? e.g. Chicken and rice"
                value={desc} onChange={e => setDesc(e.target.value)}
                autoFocus
              />
              <input
                className="input-field" style={{ marginBottom: 20 }}
                placeholder="Estimated calories (e.g. 650)"
                type="number" value={kcal} onChange={e => setKcal(e.target.value)}
              />

              <button
                type="submit" className="btn-primary"
                disabled={submitting || !desc || !kcal}
                style={{ opacity: (!desc || !kcal) ? 0.5 : 1 }}
              >
                {submitting ? 'Saving…' : 'Add to Log'}
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
