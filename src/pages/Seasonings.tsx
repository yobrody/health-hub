import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { FridgeItem } from '../api/client'
import { showToast } from '../toast'

// Seasonings & condiments — a deliberately LIGHT surface over the fridge's
// `condiments` zone. No freshness/health bars (seasonings last ~forever): just
// a simple grid, add-via-photo (or type), and tap-to-delete. Brody has many
// seasonings and wanted a fast add/remove without the appliance UI.

export default function Seasonings() {
  const [items, setItems] = useState<FridgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [pendingPhoto, setPendingPhoto] = useState<{ name: string; dataUrl: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function load() {
    api.getFridge()
      .then(d => setItems(d.condiments ?? []))
      .catch(() => showToast('Could not load seasonings', 'err'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function addItem(name: string, photoDataUrl?: string) {
    const clean = name.trim()
    if (!clean) return
    try {
      await api.addFridgeItem(clean, 'condiments', photoDataUrl ? undefined : undefined)
      showToast(`Added ${clean}`)
      // Background: resolve a product photo so the tile isn't just an emoji.
      void api.enrichItem({ name: clean }).catch(() => {})
      setTypedName('')
      setPendingPhoto(null)
      load()
    } catch {
      showToast('Could not add — try again', 'err')
    }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) e.target.value = ''
    if (!file) return
    setAdding(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      // Identify the seasoning from the photo — prefill an editable name so a
      // misread is a one-tap fix, not a wrong silent add.
      let guessed = ''
      try {
        const r = await api.analyzeFood(file, 'a single seasoning, spice or condiment — name only')
        guessed = (r.name || '').split(',')[0].trim()
      } catch { /* offline / AI busy — user types the name */ }
      setPendingPhoto({ name: guessed, dataUrl })
    } finally {
      setAdding(false)
    }
  }

  async function del(name: string) {
    setConfirmDelete(null)
    try {
      await api.removeFridgeItem(name)
      setItems(prev => prev.filter(i => i.name !== name))
      showToast(`Removed ${name}`)
    } catch {
      showToast('Could not remove — try again', 'err')
    }
  }

  return (
    <div className="page" style={{ background: 'var(--c-bg, var(--bg))' }}>
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>Seasonings</div>
          <div style={{ fontSize: 13, color: 'var(--c-label-dim, var(--label2))' }}>{items.length}</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-label-dim, var(--label2))', marginBottom: 16 }}>
          Spices &amp; condiments — snap or type to add, tap to remove.
        </div>

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="input-field"
            style={{ flex: 1, padding: '12px 14px', fontSize: 16 }}
            placeholder="Add a seasoning (e.g. paprika)"
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem(typedName) }}
          />
          <button onClick={() => addItem(typedName)} disabled={!typedName.trim()}
            style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 12, padding: '0 16px', fontSize: 15, fontWeight: 600, opacity: typedName.trim() ? 1 : 0.5, cursor: 'pointer' }}>Add</button>
          <button onClick={() => fileRef.current?.click()} disabled={adding} aria-label="Add by photo"
            style={{ background: 'var(--c-card, var(--card))', border: '1px solid var(--separator)', borderRadius: 12, padding: '0 14px', fontSize: 18, cursor: 'pointer' }}>{adding ? '…' : '📷'}</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--c-label-faint, var(--label3))' }}>Loading…</div>}

        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--c-label-dim, var(--label2))', background: 'var(--c-card, var(--card))', borderRadius: 16, border: '1px solid var(--separator)' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🧂</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No seasonings yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Snap a spice jar or type a name above.</div>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {items.map(it => {
              const photo = (it as { photo_url?: string | null }).photo_url
              return (
                <button key={it.name} onClick={() => setConfirmDelete(it.name)}
                  style={{ background: 'var(--c-card, var(--card))', border: '1px solid var(--separator)', borderRadius: 14, padding: '12px 8px', cursor: 'pointer', textAlign: 'center', position: 'relative' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 10, margin: '0 auto 8px', background: 'var(--gray5, var(--c-bg))', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {photo
                      ? <img src={photo} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      : <span style={{ fontSize: 24 }}>🧂</span>}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-label, var(--label))' }}>{it.name}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Photo-add confirm — editable name so a misidentification is a quick fix */}
      {pendingPhoto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setPendingPhoto(null) }}>
          <div style={{ background: 'var(--c-card, var(--card))', borderRadius: '22px 22px 0 0', width: '100%', padding: '20px 20px calc(32px + var(--safe-bottom))' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4, var(--separator))', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
              <img src={pendingPhoto.dataUrl} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--c-label-dim, var(--label2))', marginBottom: 4 }}>Name this seasoning</div>
                <input className="input-field" style={{ width: '100%', padding: '10px 12px', fontSize: 16 }}
                  value={pendingPhoto.name} autoFocus
                  onChange={e => setPendingPhoto(p => p ? { ...p, name: e.target.value } : p)}
                  placeholder="e.g. smoked paprika" />
              </div>
            </div>
            <button onClick={() => addItem(pendingPhoto.name, pendingPhoto.dataUrl)} disabled={!pendingPhoto.name.trim()}
              style={{ width: '100%', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 14, padding: '13px', fontSize: 16, fontWeight: 700, opacity: pendingPhoto.name.trim() ? 1 : 0.5, cursor: 'pointer' }}>Add seasoning</button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null) }}>
          <div style={{ background: 'var(--c-card, var(--card))', borderRadius: '22px 22px 0 0', width: '100%', padding: '24px 20px calc(32px + var(--safe-bottom))' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4, var(--separator))', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, textAlign: 'center', color: 'var(--c-label, var(--label))' }}>Remove {confirmDelete}?</div>
            <button className="btn-destructive" style={{ width: '100%', marginBottom: 10 }} onClick={() => del(confirmDelete)}>Remove</button>
            <button onClick={() => setConfirmDelete(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--c-accent, var(--blue))', fontSize: 16, fontWeight: 600, padding: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
