import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getPriority,
  loadPriorities,
  LS_PRIORITY_KEY,
  savePriorities,
  withPriority,
} from './agenda-priority'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.get(key) ?? null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  // Test helper
  raw(key: string) { return this.map.get(key) }
}

describe('agenda-priority', () => {
  let storage: MemoryStorage

  beforeEach(() => { storage = new MemoryStorage() })
  afterEach(() => { /* MemoryStorage discarded with each test */ })

  describe('loadPriorities', () => {
    it('returns empty object when no key set', () => {
      expect(loadPriorities(storage)).toEqual({})
    })

    it('parses stored map', () => {
      storage.setItem(LS_PRIORITY_KEY, JSON.stringify({ a: 'urgent', b: 'low' }))
      expect(loadPriorities(storage)).toEqual({ a: 'urgent', b: 'low' })
    })

    it('returns empty object when stored value is corrupt JSON', () => {
      storage.setItem(LS_PRIORITY_KEY, '{not json')
      expect(loadPriorities(storage)).toEqual({})
    })

    it('returns empty object when stored value is null/array', () => {
      storage.setItem(LS_PRIORITY_KEY, 'null')
      expect(loadPriorities(storage)).toEqual({})
    })
  })

  describe('savePriorities', () => {
    it('serializes map to storage under the canonical key', () => {
      savePriorities(storage, { a: 'urgent' })
      expect(storage.raw(LS_PRIORITY_KEY)).toBe('{"a":"urgent"}')
    })
  })

  describe('getPriority', () => {
    it('returns map value when present', () => {
      expect(getPriority({ id: 'x' }, { x: 'urgent' })).toBe('urgent')
    })

    it("falls back to legacy 'urgent'/'low' encoded in notes when map is empty", () => {
      expect(getPriority({ id: 'x', notes: 'urgent' }, {})).toBe('urgent')
      expect(getPriority({ id: 'x', notes: 'low' }, {})).toBe('low')
    })

    it('treats real free-text notes as normal priority', () => {
      expect(getPriority({ id: 'x', notes: 'pick up dry cleaning' }, {})).toBe('normal')
    })

    it('returns normal when neither map nor notes encode a priority', () => {
      expect(getPriority({ id: 'x' }, {})).toBe('normal')
      expect(getPriority({ id: 'x', notes: null }, {})).toBe('normal')
    })

    it('map takes precedence over legacy notes encoding', () => {
      expect(getPriority({ id: 'x', notes: 'urgent' }, { x: 'low' })).toBe('low')
    })
  })

  describe('withPriority', () => {
    it('sets a non-normal priority', () => {
      expect(withPriority({}, 'a', 'urgent')).toEqual({ a: 'urgent' })
    })

    it('removes the entry when priority is normal', () => {
      expect(withPriority({ a: 'urgent' }, 'a', 'normal')).toEqual({})
    })

    it('does not mutate the input map', () => {
      const before = { a: 'urgent' as const }
      withPriority(before, 'a', 'low')
      expect(before).toEqual({ a: 'urgent' })
    })
  })
})
