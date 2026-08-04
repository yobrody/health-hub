import { useEffect, useState } from 'react'
import type { WorkoutAnalysis } from '../lib/gym-analysis'
import { MUSCLE_LABELS } from '../lib/gym-muscles'
import { buildHighlights, type Tone } from '../lib/gym-highlights'
import { api } from '../api/client'

/**
 * Shown after `Save workout`. Local-computed scorecard + on-demand AI
 * narrative ("Generate insights"). Closes via Done button.
 */
export function PostWorkoutSheet({
  analysis, onClose, weeklyVolume,
}: {
  analysis: WorkoutAnalysis
  onClose: () => void
  weeklyVolume: { muscle: string; sets: number }[]
}) {
  const [narrative, setNarrative] = useState<string | null>(null)
  const [loadingNarrative, setLoadingNarrative] = useState(false)
  const [narrativeError, setNarrativeError] = useState<string | null>(null)

  // Persist + auto-load any previously generated narrative for this workout.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(`gym_narrative_${analysis.workoutId}`)
      if (cached) setNarrative(cached)
    } catch { /* localStorage may be disabled */ }
  }, [analysis.workoutId])

  async function generateInsights() {
    setLoadingNarrative(true)
    setNarrativeError(null)
    try {
      const r = await api.gymCoachSummary(analysis, weeklyVolume)
      setNarrative(r.narrative)
      try { localStorage.setItem(`gym_narrative_${analysis.workoutId}`, r.narrative) }
      catch { /* ignore quota errors */ }
    } catch (e) {
      setNarrativeError(String(e))
    } finally {
      setLoadingNarrative(false)
    }
  }

  // Instant, offline coach read computed from the local scorecard — no AI call
  // needed. The AI narrative below is the optional deeper dive.
  const highlights = buildHighlights(analysis)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
        padding: '16px 20px calc(28px + var(--safe-bottom))',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 12px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px' }}>{analysis.title}</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>{analysis.headline}</div>
          </div>
          <ScoreBadge score={analysis.score} />
        </div>

        {/* Sub-scores */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          <SubscoreTile label="Completion" value={analysis.subscores.completion} />
          <SubscoreTile label="Progress" value={analysis.subscores.progress} />
          <SubscoreTile label="Intensity" value={analysis.subscores.intensity} />
          <SubscoreTile label="Cadence" value={analysis.subscores.consistency} />
        </div>

        {/* Stat strip */}
        <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <StatRow label="Sets logged" value={`${analysis.completedSets} / ${analysis.totalSets}`} />
          <StatRow label="Total volume" value={`${analysis.totalVolume.toLocaleString()} kg`} />
          {analysis.volumeDeltaPct !== null && (
            <StatRow label="vs last session" value={`${analysis.volumeDeltaPct >= 0 ? '+' : ''}${Math.round(analysis.volumeDeltaPct * 100)}%`} highlight={analysis.volumeDeltaPct >= 0 ? 'good' : 'bad'} />
          )}
          <StatRow label="Working time" value={`${analysis.workingTimeMins}m of ${analysis.durationMins}m`} />
          {analysis.setsAtTopOfRange > 0 && (
            <StatRow label="Top-of-range sets" value={`${analysis.setsAtTopOfRange}`} highlight="good" />
          )}
          {analysis.setsBelowRange > 0 && (
            <StatRow label="Below-range sets" value={`${analysis.setsBelowRange}`} highlight="bad" />
          )}
        </div>

        {/* PRs */}
        {analysis.prHits.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>Personal records hit</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {analysis.prHits.map((pr, i) => (
                <div key={i} style={{ background: 'rgba(255,215,0,0.18)', borderRadius: 12, padding: '8px 12px' }}>
                  <div style={{ fontSize: 12, color: 'var(--label2)' }}>{pr.exerciseName}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
                    {pr.newWeight_kg}kg × {pr.newReps}
                    {pr.isWeightPR && <span style={{ fontSize: 10, color: '#B8860B', marginLeft: 6 }}>WT PR</span>}
                    {pr.isRepsPR && !pr.isWeightPR && <span style={{ fontSize: 10, color: '#B8860B', marginLeft: 6 }}>REP PR</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Per-muscle */}
        {analysis.perMuscle.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>Muscle volume from this session</div>
            <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}>
              {analysis.perMuscle.map(m => (
                <div key={m.muscle} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--label2)' }}>{MUSCLE_LABELS[m.muscle as keyof typeof MUSCLE_LABELS] ?? m.muscle}</span>
                  <span style={{ fontWeight: 600 }}>{m.sets} sets</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Coach insights — instant local highlights, AI deep-dive optional */}
        <div className="section-label" style={{ marginTop: 0 }}>Coach insights</div>
        {highlights.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {highlights.map((hl, i) => (
              <HighlightRow key={i} icon={hl.icon} text={hl.text} tone={hl.tone} />
            ))}
          </div>
        )}
        {narrative ? (
          <div className="card" style={{ padding: 14, marginBottom: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--label)' }}>
            {narrative}
          </div>
        ) : (
          <button
            onClick={generateInsights}
            disabled={loadingNarrative}
            style={{ width: '100%', background: highlights.length ? 'var(--gray6)' : 'var(--blue)', color: highlights.length ? 'var(--label)' : '#fff', border: 'none', borderRadius: 14, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 10, opacity: loadingNarrative ? 0.5 : 1 }}
          >{loadingNarrative ? 'Thinking…' : highlights.length ? 'Get the deeper read from your coach' : 'Generate insights'}</button>
        )}
        {narrativeError && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{narrativeError}</div>
        )}

        <button
          onClick={onClose}
          style={{ width: '100%', background: 'var(--gray6)', color: 'var(--label)', border: 'none', borderRadius: 14, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >Done</button>
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 40 ? 'var(--orange)' : 'var(--red)'
  return (
    <div style={{ width: 64, height: 64, borderRadius: 32, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, opacity: 0.85, textTransform: 'uppercase', marginTop: 2 }}>Score</div>
    </div>
  )
}

function SubscoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--gray6)', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: 'good' | 'bad' }) {
  const color = highlight === 'good' ? 'var(--green)' : highlight === 'bad' ? 'var(--orange)' : 'var(--label)'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--label2)' }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  )
}

function HighlightRow({ icon, text, tone }: { icon: string; text: string; tone: Tone }) {
  const bg = tone === 'good' ? 'rgba(48,209,88,0.14)' : tone === 'warn' ? 'rgba(255,159,10,0.16)' : 'rgba(10,132,255,0.14)'
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: bg, marginBottom: 8 }}>
      <span style={{ fontSize: 17, lineHeight: '20px', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.35, color: 'var(--label)', fontWeight: 500 }}>{text}</span>
    </div>
  )
}
