import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { AgendaItemData } from '../api/client'
import { showToast } from '../toast'

const PRIORITY_OPTS = [
  { id: 'normal', label: 'Normal', color: 'var(--blue)' },
  { id: 'urgent', label: 'Urgent', color: 'var(--red)' },
  { id: 'low',    label: 'Low',    color: 'var(--label3)' },
] as const

type Priority = 'normal' | 'urgent' | 'low'

// Priority is stored client-side keyed by item id. The server's `notes` field
// is reserved for free-text task notes — overloading it for priority breaks
// the moment a notes UI is added. Legacy items whose notes is exactly
// 'urgent'/'low' are treated as priority for backwards compat on first load.
const LS_PRIORITY_KEY = 'agenda_priorities'

function loadPriorities(): Record<string, Priority> {
  try {
    const raw = localStorage.getItem(LS_PRIORITY_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, Priority>
  } catch { /* ignore corrupt JSON */ }
  return {}
}

function savePriorities(map: Record<string, Priority>) {
  try { localStorage.setItem(LS_PRIORITY_KEY, JSON.stringify(map)) } catch { /* ignore quota errors */ }
}

function getPriority(item: AgendaItemData, map: Record<string, Priority>): Priority {
  const fromMap = map[item.id]
  if (fromMap) return fromMap
  // Legacy compat: items created before the priority split stored 'urgent'/'low' in notes.
  if (item.notes === 'urgent' || item.notes === 'low') return item.notes
  return 'normal'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Agenda() {
  const [items, setItems] = useState<AgendaItemData[]>([])
  const [priorities, setPriorities] = useState<Record<string, Priority>>(loadPriorities)
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function load() {
    setLoading(true)
    api.getAgendaToday()
      .then(d => setItems(d.items))
      .catch(() => showToast('Failed to load agenda', 'err'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function setItemPriority(itemId: string, p: Priority) {
    setPriorities(prev => {
      const next = { ...prev }
      if (p === 'normal') delete next[itemId]
      else next[itemId] = p
      savePriorities(next)
      return next
    })
  }

  async function addItem() {
    const title = input.trim()
    if (!title) return
    setInput('')
    setAdding(true)
    try {
      const { item } = await api.addAgendaItem(title)
      setItems(prev => [...(prev || []), item])
      if (priority !== 'normal') setItemPriority(item.id, priority)
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      showToast('Failed to add task', 'err')
    } finally {
      setAdding(false)
      inputRef.current?.focus()
    }
  }

  async function toggle(itemId: string) {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, done: !i.done } : i))
    try {
      await api.toggleAgendaItem(itemId)
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      showToast('Failed to update task', 'err')
      load()
    }
  }

  async function remove(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId))
    setItemPriority(itemId, 'normal') // clean up priority entry
    try {
      await api.deleteAgendaItem(itemId)
    } catch {
      showToast('Failed to delete task', 'err')
      load()
    }
  }

  const pending = items.filter(i => !i.done)
  const done = items.filter(i => i.done)

  // Sort pending: urgent first, then normal, then low
  const order: Record<Priority, number> = { urgent: 0, normal: 1, low: 2 }
  const sorted = [...pending].sort((a, b) => order[getPriority(a, priorities)] - order[getPriority(b, priorities)])

  function urgencyColor(item: AgendaItemData) {
    const p = getPriority(item, priorities)
    if (p === 'urgent') return 'var(--red)'
    if (p === 'low') return 'var(--label3)'
    return 'var(--blue)'
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 2 }}>Today</div>
        <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 16 }}>{todayLabel()}</div>

        {/* Priority selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {PRIORITY_OPTS.map(p => (
            <button
              key={p.id}
              onClick={() => setPriority(p.id)}
              style={{
                flex: 1,
                background: priority === p.id ? p.color : 'var(--card)',
                color: priority === p.id ? '#fff' : 'var(--label2)',
                border: priority === p.id ? 'none' : '1px solid var(--separator)',
                borderRadius: 12,
                padding: '7px 0',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Add task */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input
            ref={inputRef}
            className="input-field"
            placeholder="Add a task..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            style={{ flex: 1 }}
          />
          <button
            className="btn-primary"
            onClick={addItem}
            disabled={adding || !input.trim()}
            style={{ width: 48, padding: 0, fontSize: 22, flexShrink: 0 }}
          >
            +
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--label3)', padding: 32 }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--label3)', padding: 32, fontSize: 15 }}>
            Nothing planned yet — add your first task above
          </div>
        ) : (
          <>
            {sorted.length > 0 && (
              <div className="card" style={{ marginBottom: 12 }}>
                {sorted.map((item, idx) => (
                  <div
                    key={item.id}
                    className="list-row"
                    style={{ borderBottom: idx < sorted.length - 1 ? '0.5px solid var(--separator)' : 'none', gap: 12 }}
                  >
                    <button
                      onClick={() => toggle(item.id)}
                      style={{
                        background: 'none',
                        border: `2px solid ${urgencyColor(item)}`,
                        borderRadius: '50%',
                        width: 22,
                        height: 22,
                        cursor: 'pointer',
                        flexShrink: 0,
                        padding: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: getPriority(item, priorities) === 'urgent' ? 700 : 400 }}>{item.title}</div>
                      {getPriority(item, priorities) === 'urgent' && (
                        <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600, marginTop: 1 }}>URGENT</div>
                      )}
                    </div>
                    <button
                      onClick={() => remove(item.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--label3)', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {done.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label3)', letterSpacing: 0.5, marginBottom: 8 }}>
                  DONE ({done.length})
                </div>
                <div className="card" style={{ opacity: 0.5 }}>
                  {done.map((item, idx) => (
                    <div
                      key={item.id}
                      className="list-row"
                      style={{ borderBottom: idx < done.length - 1 ? '0.5px solid var(--separator)' : 'none', gap: 12 }}
                    >
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--green)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span style={{ flex: 1, fontSize: 15, textDecoration: 'line-through', color: 'var(--label3)' }}>{item.title}</span>
                      <button
                        onClick={() => toggle(item.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--label3)', fontSize: 12, cursor: 'pointer', padding: '0 4px' }}
                      >undo</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
