import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { WorkoutData, ExerciseSet } from '../api/client'
import { showToast } from '../toast'
import { PROGRAM, type SkillExercise } from '../program'
import {
  skillBests, ladderRung, ladderFor, SKILL_WORKOUT_TITLE,
} from '../lib/skill-progress'

// The full block, in order. Legs day carries all five; Push and Pull each
// drop the movements that would interfere with that day's pressing or pulling.
const BLOCK: SkillExercise[] = PROGRAM.Legs.skill

function fmtLoc(loc: SkillExercise['location']): string {
  return loc === 'home' ? 'Home' : loc === 'gym' ? 'Gym' : 'Anywhere'
}

/** Three-segment ladder bar. Filled segments are cleared rungs; the active
 * one fills proportionally to how far you are from the rung below. */
function Ladder({ value, ladder, unit }: { value: number; ladder: readonly number[]; unit: string }) {
  const r = ladderRung(value, ladder)
  return (
    <div style={{ margin: '10px 0 8px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {ladder.map((rung, i) => {
          const fill = i < r.cleared ? 1 : i === r.cleared ? r.pct : 0
          return (
            <div key={rung} style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--c-border, #27272A)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fill * 100}%`, background: 'var(--c-accent, #3B82F6)', borderRadius: 2, transition: 'width .35s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        {ladder.map((rung, i) => (
          <div key={rung} style={{ flex: 1, fontSize: 13, fontWeight: 500, color: i < r.cleared ? 'var(--c-label, #FAFAFA)' : 'var(--c-label-faint, #52525B)' }}>
            {rung}{unit}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SkillBlock({ onBack }: { onBack?: () => void }) {
  const [workouts, setWorkouts] = useState<WorkoutData[]>([])
  const [expanded, setExpanded] = useState<string | null>(BLOCK[1]?.name ?? null)
  // Values recorded this session: seconds for holds, reps for rep work.
  const [logged, setLogged] = useState<Record<string, number[]>>({})
  const [saving, setSaving] = useState(false)

  // Stopwatch for the hold. Counts UP — you hold until you drop, then stop.
  const [running, setRunning] = useState(false)
  const [secs, setSecs] = useState(0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => { api.getWorkouts(60).then(setWorkouts).catch(() => setWorkouts([])) }, [])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      if (startedAt.current !== null) setSecs(Math.floor((Date.now() - startedAt.current) / 1000))
    }, 200)
    return () => clearInterval(t)
  }, [running])

  const bests = useMemo(() => skillBests(workouts), [workouts])
  const isFirstSession = useMemo(
    () => !workouts.some(w => w.title === SKILL_WORKOUT_TITLE),
    [workouts],
  )
  const anyLogged = Object.values(logged).some(v => v.length > 0)

  /** Best including anything recorded in this session, so the ladder moves live. */
  function currentBest(s: SkillExercise): number {
    const stored = bests[s.name]?.value ?? 0
    const today = Math.max(0, ...(logged[s.name] ?? [0]))
    return Math.max(stored, today)
  }

  function record(name: string, value: number) {
    if (value <= 0) return
    setLogged(prev => ({ ...prev, [name]: [...(prev[name] ?? []), value] }))
    if (navigator.vibrate) navigator.vibrate(15)
  }

  function toggleHold(name: string) {
    if (running) {
      setRunning(false)
      const held = startedAt.current !== null ? Math.floor((Date.now() - startedAt.current) / 1000) : 0
      startedAt.current = null
      setSecs(0)
      if (held > 0) {
        record(name, held)
        showToast(`${held}s held`)
      }
    } else {
      startedAt.current = Date.now()
      setSecs(0)
      setRunning(true)
      if (navigator.vibrate) navigator.vibrate(10)
    }
  }

  async function finish() {
    if (!anyLogged || saving) return
    setSaving(true)
    const now = new Date()
    const start = new Date(now.getTime() - 12 * 60000)
    const exercises = BLOCK
      .filter(s => s.kind !== 'prep' && (logged[s.name]?.length ?? 0) > 0)
      .map(s => ({
        name: s.name,
        sets: (logged[s.name] ?? []).map((v): ExerciseSet =>
          s.kind === 'hold' ? { duration_seconds: v } : { reps: v }),
      }))
    try {
      await api.saveWorkout({
        title: SKILL_WORKOUT_TITLE,
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        exercises,
      })
      showToast('Skill block saved')
      setLogged({})
      const fresh = await api.getWorkouts(60)
      setWorkouts(fresh)
      if (navigator.vibrate) navigator.vibrate([40, 40, 120])
    } catch {
      showToast('Saved offline — will sync', 'err')
      setLogged({})
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page" style={{ background: 'var(--c-bg, #09090B)', minHeight: '100dvh' }}>
      <div className="page-content" style={{ paddingTop: 8 }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', color: 'var(--c-label, #FAFAFA)' }}>
              Skill block
            </div>
            <div style={{ fontSize: 15, color: 'var(--c-label-dim, #A1A1AA)', marginTop: 2 }}>
              12 min{isFirstSession ? ' · first session' : ''}
            </div>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'var(--c-card, #18181B)', border: '1px solid var(--c-border, #27272A)',
                color: 'var(--c-label, #FAFAFA)', borderRadius: 999, padding: '10px 18px',
                fontSize: 15, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}
            >Home</button>
          )}
        </div>

        {isFirstSession && (
          <div style={{
            background: 'var(--c-card, #18181B)', borderRadius: 18, padding: '18px 20px', marginTop: 16,
          }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--c-label, #FAFAFA)', marginBottom: 6 }}>
              Today writes the baseline.
            </div>
            <div style={{ fontSize: 15, color: 'var(--c-label-dim, #A1A1AA)', lineHeight: 1.5 }}>
              Nothing is recorded yet. Whatever you manage in this first block becomes rung one — the handstand is three rungs away.
            </div>
          </div>
        )}

        {BLOCK.map(s => {
          const open = expanded === s.name
          const best = currentBest(s)
          const ladder = ladderFor(s)
          const unit = s.kind === 'hold' ? 's' : ''
          const doneThisSession = logged[s.name] ?? []
          const setsLeft = Math.max(0, s.sets - doneThisSession.length)

          return (
            <div
              key={s.name}
              style={{
                background: 'var(--c-card, #18181B)', borderRadius: 18,
                padding: open ? '18px 20px 20px' : '16px 20px', marginTop: 12,
              }}
            >
              <button
                onClick={() => { if (running) return; setExpanded(open ? null : s.name) }}
                style={{
                  width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  textAlign: 'left', color: 'inherit', display: 'flex', alignItems: 'flex-start', gap: 12,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label, #FAFAFA)', letterSpacing: '-0.3px' }}>
                    {s.name.replace('Chest-to-wall handstand hold', 'Chest-to-wall handstand').replace(' (skill)', '')}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--c-label-dim, #A1A1AA)', marginTop: 3 }}>
                    {s.kind === 'prep'
                      ? `${s.target} · nothing recorded`
                      : `${s.sets} sets · ${s.kind === 'hold' ? 'hold to failure' : s.target}`}
                    {s.location !== 'either' && (
                      <span style={{ color: 'var(--c-label-faint, #52525B)' }}> · {fmtLoc(s.location)}</span>
                    )}
                  </div>
                </div>
                {s.kind !== 'prep' && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--c-label-faint, #52525B)' }}>BEST</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: best > 0 ? 'var(--c-label, #FAFAFA)' : 'var(--c-label-faint, #52525B)' }}>
                      {best > 0 ? `${best}${unit}` : '—'}
                    </div>
                  </div>
                )}
                {s.kind === 'prep' && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--c-label-faint, #52525B)' }}>BEST</div>
                    <div style={{ fontSize: 17, color: 'var(--c-label-faint, #52525B)' }}>—</div>
                  </div>
                )}
              </button>

              {open && s.kind !== 'prep' && (
                <>
                  <Ladder value={best} ladder={ladder} unit={unit} />
                  <div style={{ fontSize: 15, color: 'var(--c-label-dim, #A1A1AA)', lineHeight: 1.45 }}>
                    {best === 0
                      ? 'No baseline yet — first set lands you on the ladder.'
                      : ladderRung(best, ladder).next === null
                        ? 'Ladder topped out. Time for a harder variation.'
                        : `${ladderRung(best, ladder).next! - best}${unit} to the next rung.`}
                  </div>

                  {s.kind === 'hold' ? (
                    <>
                      <div style={{ textAlign: 'center', margin: '22px 0 6px' }}>
                        <span style={{ fontSize: 92, fontWeight: 800, letterSpacing: '-4px', lineHeight: 1, color: 'var(--c-label, #FAFAFA)', fontVariantNumeric: 'tabular-nums' }}>
                          {running ? secs : 0}
                        </span>
                        <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--c-label-dim, #A1A1AA)', marginLeft: 8 }}>sec</span>
                      </div>
                      <button
                        onClick={() => toggleHold(s.name)}
                        style={{
                          width: '100%', border: 'none', borderRadius: 999, padding: '20px 0',
                          background: running ? 'var(--c-red, #EF4444)' : 'var(--c-accent, #3B82F6)',
                          color: '#fff', fontSize: 21, fontWeight: 700, cursor: 'pointer', marginTop: 10,
                        }}
                      >{running ? 'Stop' : 'Start hold'}</button>
                    </>
                  ) : (
                    <RepLogger onLog={v => record(s.name, v)} />
                  )}

                  {doneThisSession.length > 0 && (
                    <div style={{ fontSize: 14, color: 'var(--c-label-dim, #A1A1AA)', marginTop: 12, textAlign: 'center' }}>
                      Today: {doneThisSession.map(v => `${v}${unit}`).join(' · ')}
                      {setsLeft > 0 ? ` · ${setsLeft} set${setsLeft === 1 ? '' : 's'} left` : ' · done'}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}

        <button
          onClick={anyLogged ? finish : onBack}
          disabled={saving}
          style={{
            width: '100%', marginTop: 16, marginBottom: 8,
            background: anyLogged ? 'var(--c-accent, #3B82F6)' : 'var(--c-card, #18181B)',
            color: anyLogged ? '#fff' : 'var(--c-label, #FAFAFA)',
            border: 'none', borderRadius: 18, padding: '20px 0',
            fontSize: 19, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.5 : 1,
          }}
        >{saving ? 'Saving…' : anyLogged ? 'Finish block' : 'Skip today'}</button>

      </div>
    </div>
  )
}

/** Rep entry: tap to adjust, one button to log the set. */
function RepLogger({ onLog }: { onLog: (v: number) => void }) {
  const [v, setV] = useState(0)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26, margin: '20px 0 4px' }}>
        <button
          onClick={() => setV(x => Math.max(0, x - 1))}
          aria-label="One fewer"
          style={{ width: 56, height: 56, borderRadius: 999, border: '1px solid var(--c-border, #27272A)', background: 'var(--c-bg, #09090B)', color: 'var(--c-label, #FAFAFA)', fontSize: 28, cursor: 'pointer' }}
        >−</button>
        <div style={{ minWidth: 100, textAlign: 'center' }}>
          <span style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-3px', lineHeight: 1, color: 'var(--c-label, #FAFAFA)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-label-dim, #A1A1AA)', marginTop: 2 }}>reps</div>
        </div>
        <button
          onClick={() => setV(x => x + 1)}
          aria-label="One more"
          style={{ width: 56, height: 56, borderRadius: 999, border: '1px solid var(--c-border, #27272A)', background: 'var(--c-bg, #09090B)', color: 'var(--c-label, #FAFAFA)', fontSize: 28, cursor: 'pointer' }}
        >+</button>
      </div>
      <button
        onClick={() => { if (v > 0) { onLog(v); setV(0) } }}
        disabled={v <= 0}
        style={{
          width: '100%', border: 'none', borderRadius: 999, padding: '20px 0', marginTop: 12,
          background: v > 0 ? 'var(--c-accent, #3B82F6)' : 'var(--c-border, #27272A)',
          color: v > 0 ? '#fff' : 'var(--c-label-faint, #52525B)',
          fontSize: 21, fontWeight: 700, cursor: v > 0 ? 'pointer' : 'default',
        }}
      >Log set</button>
    </>
  )
}
