// Pure helpers for agenda priority. Priority is stored client-side in a
// localStorage map keyed by item id, so the server's `notes` field stays
// reserved for free-text task notes. Legacy items whose notes is exactly
// 'urgent' or 'low' are still treated as priority for back-compat.

export type Priority = 'normal' | 'urgent' | 'low'

export const LS_PRIORITY_KEY = 'agenda_priorities'

type ItemLike = { id: string; notes?: string | null }

export function loadPriorities(storage: Pick<Storage, 'getItem'>): Record<string, Priority> {
  try {
    const raw = storage.getItem(LS_PRIORITY_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, Priority>
  } catch { /* ignore corrupt JSON */ }
  return {}
}

export function savePriorities(
  storage: Pick<Storage, 'setItem'>,
  map: Record<string, Priority>,
): void {
  try { storage.setItem(LS_PRIORITY_KEY, JSON.stringify(map)) } catch { /* ignore quota errors */ }
}

export function getPriority(item: ItemLike, map: Record<string, Priority>): Priority {
  const fromMap = map[item.id]
  if (fromMap) return fromMap
  if (item.notes === 'urgent' || item.notes === 'low') return item.notes
  return 'normal'
}

export function withPriority(
  map: Record<string, Priority>,
  itemId: string,
  p: Priority,
): Record<string, Priority> {
  const next = { ...map }
  if (p === 'normal') delete next[itemId]
  else next[itemId] = p
  return next
}
