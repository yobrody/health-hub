import { describe, expect, it } from 'vitest'
import { getStreak, type DayLog } from './streaks'

const MORNING_STEPS = 3
const EVENING_STEPS = 4

function dayOf(today: Date, offsetDays: number): string {
  const d = new Date(today.getTime())
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const TODAY = new Date('2026-05-02T12:00:00Z')

describe('getStreak', () => {
  it('counts the day by LOCAL calendar date, not the UTC date', () => {
    // An early-morning "today" (00:30 local). East of UTC this instant is still
    // the PREVIOUS day in UTC, so keying off toISOString() (UTC) misses the log,
    // which is stored by LOCAL date. The streak must use the local day.
    const today = new Date(2026, 4, 2, 0, 30) // local 2026-05-02 00:30
    const days: DayLog[] = [{ date: '2026-05-02', morning: ['a', 'b', 'c'], evening: ['a', 'b', 'c', 'd'] }]
    expect(getStreak(days, today, MORNING_STEPS, EVENING_STEPS)).toBe(1)
  })

  it('returns 0 when there are no logs', () => {
    expect(getStreak([], TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(0)
  })

  it('returns 0 when today has no entry', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, -1), morning: ['a', 'b', 'c'], evening: [] },
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(0)
  })

  it('counts a single completed day', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, 0), morning: ['a', 'b', 'c'], evening: [] },
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(1)
  })

  it('counts consecutive days when at least one period is completed', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, 0),  morning: ['a', 'b', 'c'], evening: [] },
      { date: dayOf(TODAY, -1), morning: [],              evening: ['a', 'b', 'c', 'd'] },
      { date: dayOf(TODAY, -2), morning: ['a', 'b', 'c'], evening: ['a', 'b', 'c', 'd'] },
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(3)
  })

  it('stops at the first gap', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, 0),  morning: ['a', 'b', 'c'], evening: [] },
      { date: dayOf(TODAY, -1), morning: ['a', 'b', 'c'], evening: [] },
      // gap at -2
      { date: dayOf(TODAY, -3), morning: ['a', 'b', 'c'], evening: [] },
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(2)
  })

  it('does not count a day where neither period is fully complete', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, 0), morning: ['a', 'b'], evening: ['a', 'b'] }, // both partial
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(0)
  })

  it('handles unsorted input', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, -2), morning: ['a', 'b', 'c'], evening: [] },
      { date: dayOf(TODAY, 0),  morning: ['a', 'b', 'c'], evening: [] },
      { date: dayOf(TODAY, -1), morning: ['a', 'b', 'c'], evening: [] },
    ]
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(3)
  })

  it('respects step counts — under-count breaks the streak', () => {
    const log: DayLog[] = [
      { date: dayOf(TODAY, 0), morning: ['a', 'b'], evening: ['a', 'b', 'c'] },
    ]
    // morning needs 3, evening needs 4; both short → not counted
    expect(getStreak(log, TODAY, MORNING_STEPS, EVENING_STEPS)).toBe(0)
  })
})
