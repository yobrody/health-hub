import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { WorkoutData, ExerciseSet } from '../api/client'

interface LiveSet extends ExerciseSet { done: boolean }
interface LiveExercise { name: string; sets: LiveSet[]; prevBest?: { weight_kg: number; reps: number } }
interface LiveWorkout { title: string; startTime: string; exercises: LiveExercise[] }

// Wger exercise search (free, no auth needed for read)
async function searchExercises(query: string): Promise<string[]> {
  try {
    const url = `https://wger.de/api/v2/exercise/search/?term=${encodeURIComponent(query)}&language=english&format=json`
    const res = await fetch(url)
    const data = await res.json()
    return (data.suggestions ?? []).slice(0, 8).map((s: { value: string }) => s.value)
  } catch { return [] }
}

function RestTimer({ seconds, onSkip }: { seconds: number; onSkip: () => void }) {
  const [remaining, setRemaining] = useState(seconds)
  const pct = remaining / seconds

  useEffect(() => {
    if (remaining <= 0) { onSkip(); return }
    // Haptic at 15s intervals
    if (remaining % 15 === 0 && remaining < seconds && navigator.vibrate) navigator.vibrate(30)
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining])

  // Big buzz at 0
  useEffect(() => {
    if (remaining === 0 && navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200])
  }, [remaining === 0])

  return (
    <div style={{
      position: 'fixed', bottom: 'calc(var(--tab-bar-height) + var(--safe-bottom))',
      left: 0, right: 0, zIndex: 50
    }}>
      <div style={{ background: 'var(--card)', padding: '12px 20px 14px', borderTop: '0.5px solid var(--separator)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)' }}>Rest</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: remaining <= 10 ? 'var(--red)' : 'var(--label)', letterSpacing: '-0.5px' }}>
            {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
          </div>
          <button onClick={onSkip} style={{
            background: 'none', border: '1.5px solid var(--blue)', borderRadius: 16,
            color: 'var(--blue)', fontSize: 14, fontWeight: 600, padding: '4px 12px', cursor: 'pointer'
          }}>Skip</button>
        </div>
        <div style={{ height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: remaining <= 10 ? 'var(--red)' : 'var(--blue)',
            width: `${pct * 100}%`, borderRadius: 3,
            transition: 'width 1s linear, background 0.3s'
          }} />
        </div>
      </div>
    </div>
  )
}

function ElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [startTime])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  return <span>{h > 0 ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
}

function SetRow({ set, idx, onUpdate, onDone, prevSets }: {
  set: LiveSet; idx: number;
  onUpdate: (field: keyof LiveSet, val: number) => void
  onDone: () => void
  prevSets: ExerciseSet[]
}) {
  const isPR = set.done && set.weight_kg && set.reps &&
    (!prevSets.length || prevSets.every(p => !p.weight_kg || (set.weight_kg ?? 0) > (p.weight_kg ?? 0)))

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 0', borderBottom: '0.5px solid var(--separator)',
      opacity: set.done ? 0.6 : 1, transition: 'opacity 0.3s'
    }}>
      <div style={{ width: 28, fontSize: 14, color: 'var(--label2)', fontWeight: 500 }}>{idx + 1}</div>

      {prevSets[idx] && (
        <div style={{ width: 60, fontSize: 12, color: 'var(--label3)', textAlign: 'center' }}>
          {prevSets[idx].weight_kg}kg×{prevSets[idx].reps}
        </div>
      )}

      <input
        type="number" placeholder="kg"
        style={{
          flex: 1, background: 'var(--bg)', border: 'none', borderRadius: 10,
          padding: '10px 12px', fontSize: 17, fontWeight: 600, textAlign: 'center',
          color: 'var(--label)', outline: 'none'
        }}
        value={set.weight_kg ?? ''}
        onChange={e => onUpdate('weight_kg', parseFloat(e.target.value))}
        disabled={set.done}
      />

      <input
        type="number" placeholder="reps"
        style={{
          flex: 1, background: 'var(--bg)', border: 'none', borderRadius: 10,
          padding: '10px 12px', fontSize: 17, fontWeight: 600, textAlign: 'center',
          color: 'var(--label)', outline: 'none'
        }}
        value={set.reps ?? ''}
        onChange={e => onUpdate('reps', parseInt(e.target.value))}
        disabled={set.done}
      />

      <button
        onClick={onDone}
        disabled={set.done || !set.weight_kg || !set.reps}
        style={{
          width: 40, height: 40, borderRadius: 20, border: 'none',
          background: set.done ? 'var(--green)' : 'var(--gray5)',
          cursor: set.done ? 'default' : 'pointer',
          fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: (!set.done && (!set.weight_kg || !set.reps)) ? 0.4 : 1,
          transition: 'background 0.2s, opacity 0.2s'
        }}
      >{set.done ? '✓' : isPR ? '🏆' : '○'}</button>
    </div>
  )
}

export default function Workout() {
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [prs, setPRs] = useState<Record<string, { weight_kg: number; reps: number; date: string }>>({})
  const [live, setLive] = useState<LiveWorkout | null>(null)
  const [restTimer, setRestTimer] = useState<number | null>(null)
  const [exSearch, setExSearch] = useState('')
  const [exResults, setExResults] = useState<string[]>([])
  const [showExSearch, setShowExSearch] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    api.getWorkouts(10).then(setWorkouts)
    api.getPRs().then(setPRs)
  }, [])

  useEffect(() => {
    if (!exSearch) { setExResults([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      const results = await searchExercises(exSearch)
      setExResults(results)
    }, 300)
  }, [exSearch])

  function startWorkout() {
    const hour = new Date().getHours()
    const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
    setLive({ title: `${timeOfDay} Session`, startTime: new Date().toISOString(), exercises: [] })
    if (navigator.vibrate) navigator.vibrate(20)
  }

  function addExercise(name: string) {
    if (!live) return
    const defaultSets: LiveSet[] = [
      { weight_kg: prs[name]?.weight_kg ?? undefined, reps: prs[name]?.reps ?? undefined, done: false },
      { weight_kg: prs[name]?.weight_kg ?? undefined, reps: prs[name]?.reps ?? undefined, done: false },
      { weight_kg: prs[name]?.weight_kg ?? undefined, reps: prs[name]?.reps ?? undefined, done: false },
    ]
    setLive(w => w ? { ...w, exercises: [...w.exercises, { name, sets: defaultSets, prevBest: prs[name] }] } : w)
    setExSearch('')
    setExResults([])
    setShowExSearch(false)
  }

  function updateSet(exIdx: number, setIdx: number, field: keyof LiveSet, val: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], [field]: val }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
  }

  function completeSet(exIdx: number, setIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const sets = [...exercises[exIdx].sets]
      sets[setIdx] = { ...sets[setIdx], done: true }
      exercises[exIdx] = { ...exercises[exIdx], sets }
      return { ...w, exercises }
    })
    setRestTimer(90) // default 90s rest
    if (navigator.vibrate) navigator.vibrate([10, 10, 30])
  }

  function addSet(exIdx: number) {
    setLive(w => {
      if (!w) return w
      const exercises = [...w.exercises]
      const lastSet = exercises[exIdx].sets.at(-1)
      exercises[exIdx] = {
        ...exercises[exIdx],
        sets: [...exercises[exIdx].sets, { weight_kg: lastSet?.weight_kg, reps: lastSet?.reps, done: false }]
      }
      return { ...w, exercises }
    })
  }

  async function finishWorkout() {
    if (!live) return
    setFinishing(true)
    const endTime = new Date().toISOString()
    await api.saveWorkout({
      title: live.title,
      start_time: live.startTime,
      end_time: endTime,
      exercises: live.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.filter(s => s.done).map(({ done, ...rest }) => rest)
      }))
    })
    const [updated, updatedPRs] = await Promise.all([api.getWorkouts(10), api.getPRs()])
    setWorkouts(updated)
    setPRs(updatedPRs)
    setLive(null)
    setRestTimer(null)
    setFinishing(false)
    if (navigator.vibrate) navigator.vibrate([50, 50, 200])
  }

  if (live) {
    const totalSets = live.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0)
    const totalVolume = live.exercises.reduce((a, ex) =>
      a + ex.sets.filter(s => s.done && s.weight_kg && s.reps)
        .reduce((b, s) => b + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0)

    return (
      <div className="page" style={{ background: 'var(--bg)' }}>
        <div className="page-content">
          {/* Live header */}
          <div style={{
            background: 'var(--blue)', borderRadius: 16, padding: '14px 16px',
            marginBottom: 16, color: '#fff'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{live.title}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                  <ElapsedTimer startTime={live.startTime} /> · {totalSets} sets · {Math.round(totalVolume).toLocaleString()}kg vol
                </div>
              </div>
              <button
                onClick={finishWorkout} disabled={finishing || live.exercises.length === 0}
                style={{
                  background: 'rgba(255,255,255,0.25)', border: 'none',
                  borderRadius: 20, padding: '8px 16px', color: '#fff',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  opacity: (finishing || live.exercises.length === 0) ? 0.5 : 1
                }}
              >{finishing ? '…' : 'Finish'}</button>
            </div>
          </div>

          {/* Exercises */}
          {live.exercises.map((ex, exIdx) => {
            const exPR = prs[ex.name]
            const hasNewPR = ex.sets.some(s => s.done && s.weight_kg && exPR && s.weight_kg > exPR.weight_kg)
            return (
              <div key={exIdx} className="card" style={{ marginBottom: 12, padding: '0 16px' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 0', borderBottom: '0.5px solid var(--separator)'
                }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{ex.name}</div>
                    {exPR && <div style={{ fontSize: 12, color: 'var(--label2)' }}>Best: {exPR.weight_kg}kg × {exPR.reps}</div>}
                  </div>
                  {hasNewPR && <span className="badge badge-gold">🏆 New PR!</span>}
                </div>
                <div style={{ padding: '4px 0 8px' }}>
                  <div style={{ display: 'flex', gap: 8, padding: '6px 0 4px' }}>
                    <div style={{ width: 28 }}/>
                    {exPR && <div style={{ width: 60, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>prev</div>}
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>kg</div>
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--label3)', textAlign: 'center' }}>reps</div>
                    <div style={{ width: 40 }}/>
                  </div>
                  {ex.sets.map((set, setIdx) => (
                    <SetRow
                      key={setIdx} set={set} idx={setIdx}
                      prevSets={exPR ? [{ weight_kg: exPR.weight_kg, reps: exPR.reps }] : []}
                      onUpdate={(f, v) => updateSet(exIdx, setIdx, f, v)}
                      onDone={() => completeSet(exIdx, setIdx)}
                    />
                  ))}
                </div>
                <button
                  onClick={() => addSet(exIdx)}
                  style={{
                    width: '100%', background: 'none', border: '1.5px dashed var(--gray4)',
                    borderRadius: 10, padding: '10px', color: 'var(--label2)', fontSize: 14,
                    fontWeight: 600, cursor: 'pointer', marginBottom: 12
                  }}
                >+ Add Set</button>
              </div>
            )
          })}

          {/* Add exercise */}
          <div className="card" style={{ overflow: 'visible' }}>
            {!showExSearch ? (
              <button
                onClick={() => setShowExSearch(true)}
                style={{
                  width: '100%', background: 'none', border: 'none', padding: '16px',
                  color: 'var(--blue)', fontSize: 17, fontWeight: 600, cursor: 'pointer'
                }}
              >+ Add Exercise</button>
            ) : (
              <div style={{ padding: 12 }}>
                <input
                  className="input-field"
                  placeholder="Search exercises (e.g. bench press)"
                  value={exSearch} onChange={e => setExSearch(e.target.value)} autoFocus
                />
                {exResults.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {exResults.map((r, i) => (
                      <div key={i} className="list-row" style={{ borderRadius: 10 }} onClick={() => addExercise(r)}>
                        <span style={{ fontSize: 15 }}>{r}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Common exercises */}
                {!exSearch && (
                  <div style={{ marginTop: 8 }}>
                    {['Bench Press (Barbell)', 'Squat (Barbell)', 'Deadlift (Barbell)', 'Overhead Press (Barbell)', 'Pull-Up', 'Barbell Row'].map(ex => (
                      <div key={ex} className="list-row" onClick={() => addExercise(ex)}>
                        <span style={{ fontSize: 15 }}>{ex}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {restTimer !== null && (
          <RestTimer seconds={restTimer} onSkip={() => setRestTimer(null)} />
        )}
      </div>
    )
  }

  // Default: workout history
  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 8 }}>Workout</div>

        <button className="btn-primary" onClick={startWorkout} style={{ marginBottom: 24 }}>
          Start Workout
        </button>

        {/* PRs */}
        {Object.keys(prs).length > 0 && (
          <>
            <div className="section-label">Personal Records</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {Object.entries(prs).slice(0, 6).map(([ex, pr]) => (
                <div key={ex} style={{
                  background: 'var(--card)', borderRadius: 12, padding: '10px 14px',
                  minWidth: 140, flex: '1 1 140px'
                }}>
                  <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{ex}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{pr.weight_kg}kg <span style={{ fontSize: 14, fontWeight: 400 }}>× {pr.reps}</span></div>
                  <div className="badge badge-gold" style={{ marginTop: 4 }}>🏆 PR</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Recent workouts */}
        {workouts.length > 0 && (
          <>
            <div className="section-label">Recent</div>
            <div className="card">
              {[...workouts].reverse().slice(0, 5).map((w, i) => {
                const start = new Date(w.start_time)
                const end = new Date(w.end_time)
                const mins = Math.round((end.getTime() - start.getTime()) / 60000)
                const vol = w.exercises.reduce((a, ex) =>
                  a + ex.sets.reduce((b, s) => b + (s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0)
                return (
                  <div key={i} className="list-row">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{w.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>
                        {start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {mins} min
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{w.exercises.length} exercises</div>
                      <div style={{ fontSize: 12, color: 'var(--label2)' }}>{Math.round(vol).toLocaleString()}kg vol</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {workouts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--label2)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💪</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No workouts yet</div>
            <div style={{ fontSize: 14 }}>Hit Start Workout to begin tracking</div>
          </div>
        )}
      </div>
    </div>
  )
}
