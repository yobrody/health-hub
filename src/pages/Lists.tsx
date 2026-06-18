import { useEffect, useRef, useState } from 'react'
import { api, isQueuedError } from '../api/client'
import type { ListItemData } from '../api/client'
import { showToast } from '../toast'

const LIST_NAMES = [
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'errands',   label: 'Errands',   icon: '📋' },
  { id: 'shopping',  label: 'Shopping',  icon: '🛍️' },
]

export default function Lists() {
  // Initial sub-list: respect a one-shot hint set by the navigating page
  // (e.g. Today's Shopping tile sets 'lists_initial' to 'shopping' so we
  // open straight onto the right list rather than groceries by default).
  const initial = (() => {
    try {
      const v = sessionStorage.getItem('lists_initial')
      if (v) sessionStorage.removeItem('lists_initial')
      return v && LIST_NAMES.some(l => l.id === v) ? v : 'groceries'
    } catch { return 'groceries' }
  })()
  const [activeList, setActiveList] = useState(initial)
  const [items, setItems] = useState<ListItemData[]>([])
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function load(listName: string) {
    setLoading(true)
    api.getList(listName)
      .then(d => setItems(d.items))
      .catch(() => showToast('Failed to load list', 'err'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(activeList)
    const onSync = () => load(activeList) // queued adds replayed → refresh
    window.addEventListener('data-synced', onSync)
    return () => window.removeEventListener('data-synced', onSync)
  }, [activeList])

  async function addItem() {
    const text = input.trim()
    if (!text) return
    setInput('')
    setAdding(true)
    try {
      const { item } = await api.addListItem(activeList, text)
      setItems(prev => [...prev, item])
      if (navigator.vibrate) navigator.vibrate(8)
    } catch (e) {
      if (isQueuedError(e)) showToast('Saved offline — will sync', 'info')
      else showToast('Failed to add item', 'err')
    } finally {
      setAdding(false)
      inputRef.current?.focus()
    }
  }

  async function toggle(itemId: string) {
    try {
      const { item } = await api.toggleListItem(activeList, itemId)
      setItems(prev => prev.map(i => i.id === itemId ? item : i))
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      showToast('Failed to update item', 'err')
    }
  }

  async function remove(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId))
    try {
      await api.deleteListItem(activeList, itemId)
    } catch {
      showToast('Failed to delete item', 'err')
      load(activeList)
    }
  }

  async function clearDone() {
    const done = items.filter(i => i.checked)
    if (!done.length) return
    setItems(prev => prev.filter(i => !i.checked))
    try {
      await Promise.all(done.map(i => api.deleteListItem(activeList, i.id)))
    } catch {
      showToast('Failed to clear items', 'err')
      load(activeList)
    }
  }

  const unchecked = items.filter(i => !i.checked)
  const checked = items.filter(i => i.checked)

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Lists</div>

        {/* List selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 2 }}>
          {LIST_NAMES.map(l => (
            <button
              key={l.id}
              onClick={() => setActiveList(l.id)}
              style={{
                flexShrink: 0,
                background: activeList === l.id ? 'var(--blue)' : 'var(--card)',
                color: activeList === l.id ? '#fff' : 'var(--label)',
                border: activeList === l.id ? 'none' : '1px solid var(--separator)',
                borderRadius: 20,
                padding: '7px 14px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{l.icon}</span> {l.label}
            </button>
          ))}
        </div>

        {/* Add item */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            ref={inputRef}
            className="input-field"
            placeholder="Add item..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            style={{ flex: 1 }}
            autoComplete="on"
            autoCorrect="on"
            spellCheck={true}
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

        {/* Items */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--label3)', padding: 32 }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--label3)', padding: 32, fontSize: 15 }}>
            Nothing on the list yet — type one in above
          </div>
        ) : (
          <>
            {unchecked.length > 0 && (
              <div className="card" style={{ marginBottom: 12 }}>
                {unchecked.map((item, idx) => (
                  <div
                    key={item.id}
                    className="list-row"
                    style={{ borderBottom: idx < unchecked.length - 1 ? '0.5px solid var(--separator)' : 'none' }}
                  >
                    <button
                      onClick={() => toggle(item.id)}
                      style={{ background: 'none', border: '2px solid var(--blue)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', flexShrink: 0, padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    />
                    <span style={{ flex: 1, fontSize: 16 }}>{item.text}</span>
                    <button
                      onClick={() => remove(item.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--label3)', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {checked.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label3)', letterSpacing: 0.5 }}>
                    DONE ({checked.length})
                  </span>
                  <button
                    onClick={clearDone}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                  >
                    Clear
                  </button>
                </div>
                <div className="card" style={{ opacity: 0.6 }}>
                  {checked.map((item, idx) => (
                    <div
                      key={item.id}
                      className="list-row"
                      style={{ borderBottom: idx < checked.length - 1 ? '0.5px solid var(--separator)' : 'none' }}
                    >
                      <button
                        onClick={() => toggle(item.id)}
                        style={{ background: 'var(--green)', border: '2px solid var(--green)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span style={{ flex: 1, fontSize: 16, textDecoration: 'line-through', color: 'var(--label3)' }}>{item.text}</span>
                      <button
                        onClick={() => remove(item.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--label3)', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >×</button>
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
