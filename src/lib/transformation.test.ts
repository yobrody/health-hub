import { describe, it, expect } from 'vitest'
import { projectRoadmap, physiqueMilestones } from './transformation'

describe('projectRoadmap', () => {
  it('projects weeks + ETA from a reliable observed rate that matches the goal', () => {
    // 62 → 72kg, gaining a real +0.2kg/wk → 50 weeks, ETA today + 350 days.
    const r = projectRoadmap({ currentKg: 62, goalKg: 72, weeklyChangeKg: 0.2, reliable: true, todayIso: '2026-01-01' })
    expect(r.direction).toBe('gain')
    expect(r.remainingKg).toBeCloseTo(10, 5)
    expect(r.rateSource).toBe('observed')
    expect(r.onTrack).toBe(true)
    expect(r.rateKgPerWeek).toBeCloseTo(0.2, 5)
    expect(r.weeksToGoal).toBe(50)
    expect(r.etaIso).toBe('2026-12-17') // 2026-01-01 + 350 days
  })

  it('falls back to a healthy default rate when the trend is not yet reliable', () => {
    const r = projectRoadmap({ currentKg: 62, goalKg: 72, weeklyChangeKg: null, reliable: false, todayIso: '2026-01-01' })
    expect(r.rateSource).toBe('default')
    expect(r.rateKgPerWeek).toBeGreaterThan(0)
    expect(r.weeksToGoal).toBeGreaterThan(0)
  })

  it('flags being off-track when the reliable trend moves AWAY from the goal', () => {
    // Goal is to gain, but the real trend is losing → not on track. Still gives
    // an honest projection using the healthy default rate.
    const r = projectRoadmap({ currentKg: 62, goalKg: 72, weeklyChangeKg: -0.3, reliable: true, todayIso: '2026-01-01' })
    expect(r.onTrack).toBe(false)
    expect(r.rateSource).toBe('default')
    expect(r.note.toLowerCase()).toContain('losing')
  })

  it('returns no timeline when already at goal (maintain)', () => {
    const r = projectRoadmap({ currentKg: 72, goalKg: 72, weeklyChangeKg: 0.1, reliable: true, todayIso: '2026-01-01' })
    expect(r.direction).toBe('maintain')
    expect(r.weeksToGoal).toBeNull()
    expect(r.etaIso).toBeNull()
  })
})

describe('physiqueMilestones', () => {
  it('measures weight-anchored milestones from the START of the journey', () => {
    const ms = physiqueMilestones({ startKg: 62, currentKg: 65, goalKg: 72 })
    const shoulders = ms.find(m => m.id === 'shoulders')!
    expect(shoulders.anchor).toBe('weight')
    expect(shoulders.targetWeightKg).toBe(65) // 62 + 3kg
    expect(shoulders.status).toBe('reached')
    expect(shoulders.progressPct).toBe(1)
  })

  it('reports partial progress toward a not-yet-reached weight milestone', () => {
    const ms = physiqueMilestones({ startKg: 62, currentKg: 64, goalKg: 72 })
    const chest = ms.find(m => m.id === 'chest-back')! // 62 + 7 = 69kg
    expect(chest.targetWeightKg).toBe(69)
    expect(chest.status).toBe('approaching')
    expect(chest.progressPct).toBeCloseTo((64 - 62) / (69 - 62), 2)
  })

  it('anchors visible abs to BODY FAT, never to scale weight', () => {
    const ms = physiqueMilestones({ startKg: 62, currentKg: 66, goalKg: 72 })
    const abs = ms.find(m => m.id === 'abs')!
    expect(abs.anchor).toBe('bodyfat')
    expect(abs.targetWeightKg).toBeUndefined()
  })

  it('does not fake abs progress without a body-fat reading', () => {
    const abs = physiqueMilestones({ startKg: 62, currentKg: 66, goalKg: 72 }).find(m => m.id === 'abs')!
    expect(abs.status).toBe('needs-data')
    expect(abs.progressPct).toBeNull()
  })

  it('is honest that a bulk RAISES body fat when abs are the goal', () => {
    const abs = physiqueMilestones({ startKg: 62, currentKg: 66, goalKg: 72, bodyFatPct: 16 }).find(m => m.id === 'abs')!
    expect(abs.progressPct).not.toBeNull()
    expect(abs.note.toLowerCase()).toMatch(/bulk|cut|body.?fat/)
  })
})
