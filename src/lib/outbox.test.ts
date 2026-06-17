import { describe, it, expect } from 'vitest'
import {
  addItem,
  removeItem,
  bumpTries,
  dropExpired,
  summarize,
  newId,
  MAX_TRIES,
  type OutboxItem,
} from './outbox'

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return { id: over.id ?? 'a', path: '/food', method: 'POST', label: 'food', ts: 0, tries: 0, ...over }
}

describe('outbox pure ops', () => {
  it('addItem appends without mutating the input', () => {
    const a = [item({ id: '1' })]
    const b = addItem(a, item({ id: '2' }))
    expect(b.map(i => i.id)).toEqual(['1', '2'])
    expect(a).toHaveLength(1) // original untouched
  })

  it('removeItem drops by id', () => {
    const a = [item({ id: '1' }), item({ id: '2' })]
    expect(removeItem(a, '1').map(i => i.id)).toEqual(['2'])
  })

  it('bumpTries increments only the matching item', () => {
    const a = [item({ id: '1', tries: 0 }), item({ id: '2', tries: 3 })]
    const b = bumpTries(a, '2')
    expect(b.find(i => i.id === '2')!.tries).toBe(4)
    expect(b.find(i => i.id === '1')!.tries).toBe(0)
  })

  it('dropExpired removes items at/over the try ceiling', () => {
    const a = [item({ id: '1', tries: MAX_TRIES }), item({ id: '2', tries: MAX_TRIES - 1 })]
    expect(dropExpired(a).map(i => i.id)).toEqual(['2'])
  })
})

describe('summarize', () => {
  it('returns empty string for no items', () => {
    expect(summarize([])).toBe('')
  })
  it('groups and pluralizes by label', () => {
    const a = [item({ label: 'food' }), item({ label: 'food' }), item({ label: 'water' })]
    expect(summarize(a)).toBe('2 foods · 1 water')
  })
})

describe('newId', () => {
  it('produces unique-ish ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()))
    expect(ids.size).toBe(50)
  })
})
