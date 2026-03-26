import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FridgeData, FridgeItem, Meal, ScanResult } from '../api/client'

type Zone = 'fridge' | 'pantry' | 'condiments' | 'freezer'

const FOOD_EMOJIS: Record<string, string> = {
  chicken: '🍗', beef: '🥩', salmon: '🐟', fish: '🐠', shrimp: '🍤', egg: '🥚', eggs: '🥚',
  milk: '🥛', cheese: '🧀', yoghurt: '🥛', yogurt: '🥛', butter: '🧈',
  spinach: '🥬', lettuce: '🥬', kale: '🥬', broccoli: '🥦', carrot: '🥕', tomato: '🍅',
  pepper: '🫑', onion: '🧅', garlic: '🧄', avocado: '🥑', cucumber: '🥒',
  apple: '🍎', banana: '🍌', orange: '🍊', lemon: '🍋', berry: '🫐', strawberry: '🍓',
  rice: '🍚', pasta: '🍝', bread: '🍞', oat: '🌾', flour: '🌾', quinoa: '🌾',
  oil: '🫙', sauce: '🫙', mayo: '🫙', mustard: '🫙', ketchup: '🫙', soy: '🫙', sriracha: '🌶️',
  coffee: '☕', tea: '🍵', juice: '🧃', water: '💧', drink: '🧃',
  chocolate: '🍫', protein: '💪', bar: '🍫', turkey: '🦃', pork: '🥩', tuna: '🐟',
  potato: '🥔', sweet: '🍠', corn: '🌽', mushroom: '🍄', celery: '🥬',
}

function getEmoji(name: string): string {
  const lower = name.toLowerCase()
  for (const [key, emoji] of Object.entries(FOOD_EMOJIS)) {
    if (lower.includes(key)) return emoji
  }
  return '🥡'
}

function daysOld(added: string | null): number {
  if (!added) return 0
  try {
    // Backend format: "12 Mar" (day month)
    const d = new Date(`${added} ${new Date().getFullYear()}`)
    if (isNaN(d.getTime())) return 0
    return Math.floor((Date.now() - d.getTime()) / 86400000)
  } catch { return 0 }
}

function ItemChip({ item, onTap }: { item: FridgeItem; onTap: () => void }) {
  const age = daysOld(item.added)
  const warning = age > 3 && age <= 5
  const old = age > 5
  const borderColor = old ? 'var(--red)' : warning ? 'var(--orange)' : 'var(--gray4)'
  const bg = old ? '#FF3B3011' : warning ? '#FF950011' : 'var(--card)'

  return (
    <button
      onClick={onTap}
      style={{
        background: bg,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 20, padding: '6px 12px',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
        color: 'var(--label)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        WebkitTapHighlightColor: 'transparent',
        transition: 'opacity 0.1s',
      }}
    >
      <span style={{ fontSize: 15 }}>{getEmoji(item.name)}</span>
      <span>{item.name}</span>
      {old && <span style={{ fontSize: 10 }}>⚠️</span>}
      {age > 0 && !old && !warning && (
        <span style={{ fontSize: 10, color: 'var(--label3)' }}>{age}d</span>
      )}
    </button>
  )
}

// Zone configuration
const ZONES: { key: Zone; label: string; icon: string; bg: string; border: string }[] = [
  { key: 'fridge', label: 'Refrigerator', icon: '🌡️', bg: 'var(--card)', border: 'var(--separator)' },
  { key: 'freezer', label: 'Freezer', icon: '❄️', bg: 'var(--blue-light)', border: 'rgba(0,122,255,0.15)' },
  { key: 'pantry', label: 'Pantry', icon: '🫙', bg: 'var(--card)', border: 'var(--separator)' },
  { key: 'condiments', label: 'Condiments', icon: '🌶️', bg: 'var(--card)', border: 'var(--separator)' },
]

function FridgeVisual({ items, onRemove }: { items: FridgeData; onRemove: (name: string, zone: Zone) => void }) {
  const totalItems = Object.values(items).flat().length

  if (totalItems === 0) {
    return (
      <div className="card" style={{ padding: '36px 20px', textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🫙</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label2)', marginBottom: 4 }}>Fridge is empty</div>
        <div style={{ fontSize: 14, color: 'var(--label3)' }}>Tap + Add or 📷 Scan a receipt</div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {ZONES.map(zone => {
        const zoneItems = items[zone.key] ?? []
        if (zoneItems.length === 0) return null
        return (
          <div key={zone.key} style={{
            background: zone.bg, borderRadius: 14, marginBottom: 8,
            overflow: 'hidden', border: `1px solid ${zone.border}`,
          }}>
            <div style={{
              padding: '10px 14px 6px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>{zone.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {zone.label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--label3)', marginLeft: 2 }}>({zoneItems.length})</span>
            </div>
            <div style={{ padding: '4px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {zoneItems.map((item, i) => (
                <ItemChip key={i} item={item} onTap={() => onRemove(item.name, zone.key)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Fridge() {
  const [data, setData] = useState<FridgeData>({ fridge: [], pantry: [], condiments: [], freezer: [] })
  const [meals, setMeals] = useState<Meal[]>([])
  const [loadingMeals, setLoadingMeals] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addZone, setAddZone] = useState<Zone>('fridge')
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<string | null>(null)
  const [removeModal, setRemoveModal] = useState<{ name: string; zone: Zone } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalItems = Object.values(data).flat().length
  // Items past 5 days
  const oldItems = Object.values(data).flat().filter(i => daysOld(i.added) > 5).length

  useEffect(() => { api.getFridge().then(setData) }, [])

  async function getMeals() {
    setLoadingMeals(true)
    try {
      const res = await api.getMealSuggestions()
      setMeals(res.meals)
    } catch {
      setScanStatus('Could not load meal suggestions \u2014 try again later')
      setTimeout(() => setScanStatus(null), 4000)
    } finally {
      setLoadingMeals(false)
    }
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    setScanStatus('Scanning receipt with AI…')
    try {
      const result: ScanResult = await api.scanReceipt(file)
      const count = result.items_added ?? 0
      const items = result.items ?? []
      if (count > 0) {
        const preview = items.slice(0, 4).join(', ')
        const more = items.length > 4 ? ` +${items.length - 4} more` : ''
        setScanStatus(`\u2713 Added ${count} item${count !== 1 ? 's' : ''}: ${preview}${more}`)
      } else if (result.error) {
        setScanStatus(`Could not read receipt: ${result.error}`)
      } else {
        setScanStatus('No grocery items found \u2014 try a clearer photo')
      }
      const updated = await api.getFridge()
      setData(updated)
    } catch (err) {
      console.error('Receipt scan error:', err)
      setScanStatus('Receipt scan failed \u2014 check your connection and try again')
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setScanStatus(null), 6000)
    }
  }

  async function confirmRemove() {
    if (!removeModal) return
    await api.removeFridgeItem(removeModal.name)
    const updated = await api.getFridge()
    setData(updated)
    setRemoveModal(null)
    if (navigator.vibrate) navigator.vibrate(20)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName.trim()) return
    await api.addFridgeItem(addName.trim(), addZone)
    const updated = await api.getFridge()
    setData(updated)
    setAddName('')
    setShowAdd(false)
    if (navigator.vibrate) navigator.vibrate(10)
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Fridge</div>
            <div style={{ fontSize: 14, color: oldItems > 0 ? 'var(--orange)' : 'var(--label2)' }}>
              {totalItems} items{oldItems > 0 ? ` · ${oldItems} getting old ⚠️` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
              style={{
                background: scanning ? 'var(--gray4)' : 'var(--green)', color: '#fff', border: 'none',
                borderRadius: 20, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                opacity: scanning ? 0.7 : 1,
              }}
            >
              {scanning ? '…' : '📷 Receipt'}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 20, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
              }}
            >+ Add</button>
          </div>
        </div>

        {/* Hidden file input for receipt scanning */}
        <input
          ref={fileInputRef} type="file" accept="image/*"
          style={{ display: 'none' }} onChange={handleScan}
        />

        {/* Scan status toast */}
        {scanStatus && (
          <div style={{
            background: 'var(--card)', borderRadius: 12, padding: '10px 16px',
            marginBottom: 12, fontSize: 14, fontWeight: 500,
            border: '1px solid var(--separator)',
            color: scanStatus.startsWith('✓') ? 'var(--green)' : 'var(--label2)',
          }}>
            {scanStatus}
          </div>
        )}

        {/* Fridge visualization */}
        <FridgeVisual items={data} onRemove={(name, zone) => setRemoveModal({ name, zone })} />

        {/* What can I make */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: meals.length > 0 ? 12 : 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>What can I make?</div>
                <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2 }}>AI meal suggestions from your fridge</div>
              </div>
              <button
                onClick={getMeals}
                disabled={loadingMeals || totalItems === 0}
                style={{
                  background: 'var(--blue)', color: '#fff', border: 'none',
                  borderRadius: 16, padding: '8px 16px', fontSize: 14, fontWeight: 600,
                  cursor: totalItems === 0 ? 'default' : 'pointer',
                  opacity: (loadingMeals || totalItems === 0) ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >{loadingMeals ? '…' : 'Suggest'}</button>
            </div>

            {meals.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {meals.map((m, i) => (
                  <div key={i} style={{ background: 'var(--gray6)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                      <span className="badge badge-blue" style={{ marginLeft: 8, flexShrink: 0, fontSize: 11 }}>~{m.kcal_estimate} kcal</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--label2)' }}>
                      {m.ingredients.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Remove confirmation sheet */}
      {removeModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setRemoveModal(null) }}
        >
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Remove from fridge?</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', marginBottom: 24 }}>
              {getEmoji(removeModal.name)} {removeModal.name}
            </div>
            <button className="btn-destructive" onClick={confirmRemove} style={{ width: '100%', marginBottom: 12 }}>Remove</button>
            <button onClick={() => setRemoveModal(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--blue)', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 12 }}>Keep it</button>
          </div>
        </div>
      )}

      {/* Add item sheet */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Add to fridge</div>
            <form onSubmit={handleAdd}>
              <input
                className="input-field" style={{ marginBottom: 12 }}
                placeholder="Item name (e.g. Chicken breast)"
                value={addName} onChange={e => setAddName(e.target.value)} autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {(['fridge', 'freezer', 'pantry', 'condiments'] as Zone[]).map(z => (
                  <button key={z} type="button" onClick={() => setAddZone(z)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: addZone === z ? 'var(--blue)' : 'var(--gray5)',
                      color: addZone === z ? '#fff' : 'var(--label)',
                      fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                    }}
                  >{z}</button>
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={!addName.trim()} style={{ opacity: !addName.trim() ? 0.5 : 1 }}>
                Add to {addZone.charAt(0).toUpperCase() + addZone.slice(1)}
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  )
}
