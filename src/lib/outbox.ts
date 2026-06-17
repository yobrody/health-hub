// Offline outbox — the queue behind "Health Hub never loses a log on a flaky
// connection." When a mutating API call can't reach the server, the request is
// captured here and persisted to localStorage; on reconnect it's replayed in
// order. This module holds the *pure* queue operations (unit-tested) plus a
// tiny localStorage-backed store used by api/client.

export interface OutboxItem {
  id: string
  path: string
  method: string
  body?: string        // JSON string, as sent to the server
  label: string        // human bucket for the banner: 'food' | 'water' | ...
  ts: number
  tries: number
}

/** Drop an item after this many failed replays so a permanently-rejected
 *  request can't wedge the queue forever. */
export const MAX_TRIES = 8

// ── Pure list operations (no I/O — unit-tested) ─────────────────────────────

export function addItem(items: OutboxItem[], item: OutboxItem): OutboxItem[] {
  return [...items, item]
}

export function removeItem(items: OutboxItem[], id: string): OutboxItem[] {
  return items.filter(i => i.id !== id)
}

export function bumpTries(items: OutboxItem[], id: string): OutboxItem[] {
  return items.map(i => (i.id === id ? { ...i, tries: i.tries + 1 } : i))
}

export function dropExpired(items: OutboxItem[], maxTries: number = MAX_TRIES): OutboxItem[] {
  return items.filter(i => i.tries < maxTries)
}

/** Short, friendly summary for the banner, grouped by label.
 *  e.g. [food, food, water] → "2 foods · 1 water". */
export function summarize(items: OutboxItem[]): string {
  if (items.length === 0) return ''
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1)
  const parts: string[] = []
  for (const [label, n] of counts) parts.push(`${n} ${label}${n > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

// ── localStorage-backed persistence ─────────────────────────────────────────

const STORAGE_KEY = 'hh_outbox_v1'

export function loadOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveOutbox(items: OutboxItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* quota / access denied — nothing we can do, keep going */
  }
}

/** Generate a reasonably-unique id without pulling in a dependency. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
