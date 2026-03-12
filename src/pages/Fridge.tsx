import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FridgeData, FridgeItem, Meal } from '../api/client'

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
  chocolate: '🍫', protein: '💪', bar: '🍫',
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
    const d = new Date(`${added} ${new Date().getFullYear()}`)
    return Math.floor((Date.now() - d.getTime()) / 86400000)
  } catch { return 0 }
}

function ItemChip({ item, onRemove }: { item: FridgeItem; onRemove: () => void; zone?: Zone }) {
  const age = daysOld(item.added)
  const warning = age > 3 && age <= 5
  const old = age > 5
  const borderColor = old ? 'var(--red)' : warning ? 'var(--orange)' : 'transparent'
  const bg = old ? '#FF3B3011' : warning ? '#FF950011' : 'var(--card)'

  return (
    <button
      onClick={onRemove}
      style={{
        background: bg, border: `1.5px solid ${borderColor}`,
        borderRadius: 20, padding: '6px 12px',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
        transition: 'opacity 0.15s', color: 'var(--label)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <span>{getEmoji(item.name)}</span>
      <span>{item.name}</span>
      {old && <span style={{ color: 'var(--red)', fontSize: 11 }}>⚠️</span>}
    </button>
  )
}

// SVG Fridge Visualization
function FridgeVisual({ items, onRemove }: { items: FridgeData; onRemove: (name: string, zone: Zone) => void }) {
  const allFridge = items.fridge
  const allCondiments = items.condiments

  return (
    <div className="card" style={{ padding: 16, background: 'var(--card)' }}>
      {/* Fridge body */}
      <svg viewBox="0 0 280 400" style={{ width: '100%', height: 'auto', maxHeight: 360 }}>
        {/* Fridge body */}
        <rect x="20" y="10" width="240" height="380" rx="16" fill="#E8EAED" stroke="#D1D5DB" strokeWidth="1.5"/>
        {/* Fridge door seam */}
        <rect x="24" y="130" width="232" height="2" fill="#C1C7CD"/>
        {/* Top section label */}
        <text x="40" y="32" fontSize="10" fill="#6B7280" fontWeight="600">REFRIGERATOR</text>
        {/* Handle top */}
        <rect x="115" y="16" width="50" height="8" rx="4" fill="#9CA3AF"/>
        {/* Handle bottom */}
        <rect x="115" y="140" width="50" height="8" rx="4" fill="#9CA3AF"/>

        {/* Inner fridge area */}
        <rect x="30" y="40" width="220" height="80" rx="8" fill="#F9FAFB"/>
        {/* Shelf 1 */}
        <rect x="30" y="88" width="220" height="2" rx="1" fill="#E5E7EB"/>

        {/* Inner freezer */}
        <rect x="30" y="152" width="220" height="230" rx="8" fill="#EFF6FF"/>
        {/* Door shelf area */}
        <rect x="30" y="155" width="55" height="225" rx="6" fill="#DBEAFE"/>
        {/* Shelf dividers in freezer */}
        <rect x="90" y="225" width="160" height="1.5" rx="1" fill="#BFDBFE"/>
        <rect x="90" y="295" width="160" height="1.5" rx="1" fill="#BFDBFE"/>
        {/* Freezer label */}
        <text x="40" y="168" fontSize="9" fill="#3B82F6" fontWeight="600">FREEZER</text>
        <text x="38" y="177" fontSize="8" fill="#6B7280">/ PANTRY</text>
      </svg>

      {/* Overlay items on top of fridge graphic */}
      <div style={{ marginTop: -340, position: 'relative', zIndex: 2, padding: '0 36px' }}>
        {/* Top fridge items */}
        <div style={{ height: 70, display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'center', padding: '0 4px' }}>
          {allFridge.slice(0, 4).map((item, i) => (
            <ItemChip key={i} item={item} zone="fridge" onRemove={() => onRemove(item.name, 'fridge')} />
          ))}
        </div>

        {/* Spacer for shelves */}
        <div style={{ height: 120 }} />

        {/* Pantry/Freezer items */}
        <div style={{ display: 'flex', gap: 6, height: 210 }}>
          {/* Door (condiments) */}
          <div style={{ width: 52, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
            {allCondiments.slice(0, 4).map((item, i) => (
              <button
                key={i}
                onClick={() => onRemove(item.name, 'condiments')}
                style={{
                  background: 'var(--card)', border: 'none', borderRadius: 6,
                  padding: '3px 4px', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
                title={item.name}
              >
                {getEmoji(item.name)}
              </button>
            ))}
          </div>

          {/* Main freezer/pantry */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8 }}>
            {items.pantry.slice(0, 8).map((item, i) => (
              <ItemChip key={i} item={item} zone="pantry" onRemove={() => onRemove(item.name, 'pantry')} />
            ))}
          </div>
        </div>
      </div>
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
  const [removeModal, setRemoveModal] = useState<{ name: string; zone: Zone } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalItems = Object.values(data).flat().length

  useEffect(() => { api.getFridge().then(setData) }, [])

  async function getMeals() {
    setLoadingMeals(true)
    const res = await api.getMealSuggestions()
    setMeals(res.meals)
    setLoadingMeals(false)
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    try {
      await api.scanReceipt(file)
      const updated = await api.getFridge()
      setData(updated)
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function confirmRemove() {
    if (!removeModal) return
    await api.removeFridgeItem(removeModal.name)
    const updated = await api.getFridge()
    setData(updated)
    setRemoveModal(null)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName) return
    await api.addFridgeItem(addName, addZone)
    const updated = await api.getFridge()
    setData(updated)
    setAddName('')
    setShowAdd(false)
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Fridge</div>
            <div style={{ fontSize: 14, color: 'var(--label2)' }}>{totalItems} items</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: 'var(--green)', color: '#fff', border: 'none',
                borderRadius: 20, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
              }}
            >
              {scanning ? '…' : '📷 Scan'}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 20, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
              }}
            >+ Add</button>
          </div>
          <input
            ref={fileInputRef} type="file" accept="image/*" capture="environment"
            style={{ display: 'none' }} onChange={handleScan}
          />
        </div>

        {/* Fridge visualization */}
        <FridgeVisual items={data} onRemove={(name, zone) => setRemoveModal({ name, zone })} />

        {/* Fridge items list */}
        {data.fridge.length > 4 && (
          <>
            <div className="section-label">All fridge items</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {data.fridge.map((item, i) => (
                <ItemChip key={i} item={item} zone="fridge" onRemove={() => setRemoveModal({ name: item.name, zone: 'fridge' })} />
              ))}
            </div>
          </>
        )}

        {/* Meal suggestions */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-label" style={{ marginTop: 16 }}>What can I make?</div>
            <button
              onClick={getMeals}
              style={{
                background: 'none', border: 'none', color: 'var(--blue)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '0 4px'
              }}
            >{loadingMeals ? '…' : 'Suggest'}</button>
          </div>
          {meals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {meals.map((m, i) => (
                <div key={i} className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{m.name}</div>
                    <span className="badge badge-blue" style={{ marginLeft: 8, flexShrink: 0 }}>~{m.kcal_estimate} kcal</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 4 }}>
                    {m.ingredients.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Remove confirmation */}
      {removeModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setRemoveModal(null) }}
        >
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%' }}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Remove item?</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', marginBottom: 20 }}>{removeModal.name}</div>
            <button className="btn-destructive" onClick={confirmRemove} style={{ width: '100%', marginBottom: 12 }}>Remove</button>
            <button onClick={() => setRemoveModal(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--blue)', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add item sheet */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%' }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Add item</div>
            <form onSubmit={handleAdd}>
              <input
                className="input-field" style={{ marginBottom: 12 }}
                placeholder="Item name (e.g. Chicken breast)"
                value={addName} onChange={e => setAddName(e.target.value)} autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {(['fridge', 'pantry', 'condiments', 'freezer'] as Zone[]).map(z => (
                  <button key={z} type="button" onClick={() => setAddZone(z)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: addZone === z ? 'var(--blue)' : 'var(--gray5)',
                      color: addZone === z ? '#fff' : 'var(--label)',
                      fontSize: 12, fontWeight: 600, textTransform: 'capitalize'
                    }}
                  >{z}</button>
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={!addName} style={{ opacity: !addName ? 0.5 : 1 }}>Add</button>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  )
}
