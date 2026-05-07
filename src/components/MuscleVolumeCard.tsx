import { useMemo } from 'react'
import type { WorkoutData } from '../api/client'
import {
  weeklyVolumeByMuscle, MUSCLE_LABELS, STATUS_COLOR, STATUS_LABEL,
  type MuscleVolume,
} from '../lib/gym-muscles'

/**
 * 7-day per-muscle volume bar chart against MEV/MAV/MRV landmarks.
 * Each row shows a translucent track from MEV→MRV with the MAV target band
 * darkened, and a coloured fill bar = actual sets. Status pill on the right.
 */
export function MuscleVolumeCard({ workouts }: { workouts: WorkoutData[] }) {
  const volumes = useMemo(() => weeklyVolumeByMuscle(workouts, 7), [workouts])

  // Filter out muscles with mev=0 AND zero sets so the card stays focused.
  const visible = volumes.filter(v => v.landmarks.mev > 0 || v.sets > 0)

  if (visible.length === 0) {
    return (
      <div className="card" style={{ padding: 14, textAlign: 'center', color: 'var(--label2)', fontSize: 13 }}>
        No volume logged this week yet
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      {visible.map(v => <MuscleRow key={v.muscle} v={v} />)}
    </div>
  )
}

function MuscleRow({ v }: { v: MuscleVolume }) {
  const max = Math.max(v.landmarks.mrv, v.sets, 1)
  const pct = Math.min(100, (v.sets / max) * 100)
  const mevPct = (v.landmarks.mev / max) * 100
  const mavLowPct = (v.landmarks.mavLow / max) * 100
  const mavHighPct = (v.landmarks.mavHigh / max) * 100
  const fillColor = STATUS_COLOR[v.status]

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{MUSCLE_LABELS[v.muscle]}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label2)' }}>
          {v.sets} {v.sets === 1 ? 'set' : 'sets'}
          <span style={{ color: 'var(--label3)', marginLeft: 6 }}>· {STATUS_LABEL[v.status]}</span>
        </span>
      </div>
      <div style={{ position: 'relative', height: 10, background: 'var(--gray6)', borderRadius: 5, overflow: 'hidden' }}>
        {/* MAV target band — darker stripe */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${mavLowPct}%`, width: `${mavHighPct - mavLowPct}%`,
          background: 'var(--gray5)',
        }} />
        {/* MEV tick */}
        <div style={{
          position: 'absolute', top: -1, bottom: -1, left: `${mevPct}%`, width: 1,
          background: 'var(--label3)', opacity: 0.5,
        }} />
        {/* Actual fill */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`,
          background: fillColor, transition: 'width 0.3s, background 0.3s',
          borderRadius: 5,
        }} />
      </div>
    </div>
  )
}
