import { describe, it, expect } from 'vitest'
import { analyseDiet, MIN_LOGGED_DAYS, type FoodLogEntry } from './nutrition-gaps'

const day = (n: number) => {
  const d = new Date('2026-07-28T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const TODAY = '2026-07-28'

/** n distinct logged days of unremarkable food. */
function filler(n: number, extra = ''): FoodLogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    date: day(i),
    meal: 'Lunch',
    items: `chicken and rice ${extra}`,
    kcal: 600,
  }))
}

describe('data sufficiency comes first', () => {
  it('refuses to analyse an empty log', () => {
    const f = analyseDiet([], 14, TODAY)
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('insufficient-data')
  })

  it('refuses on the real current state - 2 days out of 14', () => {
    const f = analyseDiet(filler(2), 14, TODAY)
    expect(f[0].kind).toBe('insufficient-data')
    expect(f[0].headline).toContain('2 of the last 14')
  })

  it('says nothing else while data is thin - no invented gaps', () => {
    const f = analyseDiet(filler(MIN_LOGGED_DAYS - 1), 14, TODAY)
    expect(f).toHaveLength(1)
    expect(f.some(x => x.kind === 'gap')).toBe(false)
  })

  it('starts analysing at the threshold', () => {
    const f = analyseDiet(filler(MIN_LOGGED_DAYS), 14, TODAY)
    expect(f[0].kind).not.toBe('insufficient-data')
  })

  it('ignores rows with unusable dates', () => {
    const bad: FoodLogEntry[] = [{ date: 'not-a-date', items: 'salmon' }, { date: '', items: 'kale' }]
    expect(analyseDiet(bad, 14, TODAY)[0].kind).toBe('insufficient-data')
  })
})

describe('category gaps', () => {
  it('flags missing oily fish, greens, fruit and pulses', () => {
    const f = analyseDiet(filler(7), 14, TODAY)
    const heads = f.map(x => x.headline.toLowerCase()).join(' | ')
    expect(heads).toContain('oily fish')
    expect(heads).toContain('leafy greens')
    expect(heads).toContain('fruit')
  })

  it('does not flag a category that was eaten', () => {
    const entries = [...filler(7), { date: day(1), items: 'grilled salmon fillet', kcal: 400 }]
    const f = analyseDiet(entries, 14, TODAY)
    expect(f.map(x => x.headline.toLowerCase()).join(' ')).not.toContain('oily fish')
  })

  it('matches loosely - tenderstem broccoli counts as greens', () => {
    const entries = [...filler(7), { date: day(1), items: 'tenderstem broccoli side', kcal: 60 }]
    const f = analyseDiet(entries, 14, TODAY)
    expect(f.map(x => x.headline.toLowerCase()).join(' ')).not.toContain('leafy greens')
  })

  it('flags a category that has lapsed even though it appears', () => {
    // Greens 9 days ago, threshold is 4.
    const entries = [...filler(7), { date: day(9), items: 'spinach', kcal: 30 }]
    const f = analyseDiet(entries, 14, TODAY)
    expect(f.some(x => /leafy greens/i.test(x.headline))).toBe(true)
  })

  it('reports no gaps when everything appears', () => {
    const entries = [
      ...filler(7),
      { date: day(1), items: 'salmon', kcal: 400 },
      { date: day(1), items: 'kale salad', kcal: 80 },
      { date: day(1), items: 'banana', kcal: 90 },
      { date: day(1), items: 'black beans', kcal: 150 },
    ]
    const f = analyseDiet(entries, 14, TODAY)
    expect(f[0].kind).toBe('ok')
  })
})

describe('fibre', () => {
  it('flags a low average once fibre is actually measured', () => {
    const entries = filler(7).map(e => ({ ...e, fiber_g: 3 }))
    const f = analyseDiet(entries, 14, TODAY)
    expect(f.some(x => /fibre averaging/i.test(x.headline))).toBe(true)
  })

  it('stays quiet when fibre is adequate', () => {
    const entries = filler(7).map(e => ({ ...e, fiber_g: 32 }))
    const f = analyseDiet(entries, 14, TODAY)
    expect(f.some(x => /fibre averaging/i.test(x.headline))).toBe(false)
  })

  it('says nothing about fibre when it was never recorded', () => {
    const f = analyseDiet(filler(7), 14, TODAY)
    expect(f.some(x => /fibre/i.test(x.headline))).toBe(false)
  })
})

describe('vitamin D is standing advice, not a detected gap', () => {
  it('always appears once there is enough data', () => {
    const f = analyseDiet(filler(7), 14, TODAY)
    const vd = f.find(x => /vitamin d/i.test(x.headline))
    expect(vd).toBeDefined()
    expect(vd!.kind).toBe('standing')
  })

  it('is withheld while data is insufficient', () => {
    const f = analyseDiet(filler(2), 14, TODAY)
    expect(f.some(x => /vitamin d/i.test(x.headline))).toBe(false)
  })

  it('never claims a measured amount', () => {
    const f = analyseDiet(filler(7), 14, TODAY)
    const vd = f.find(x => /vitamin d/i.test(x.headline))!
    expect(vd.headline + vd.detail).not.toMatch(/\d+\s*(µg|mcg|iu)\s*(today|logged|consumed|intake)/i)
  })
})
