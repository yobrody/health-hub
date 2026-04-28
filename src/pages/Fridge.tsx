import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FridgeData, FridgeItem, Meal, ScanResult, ScannedItem } from '../api/client'
import { showToast } from '../toast'

type Zone = 'fridge' | 'pantry' | 'condiments' | 'freezer'

// Estimated shelf life per zone (days)
const SHELF_LIFE: Record<Zone, number> = {
  fridge: 7, freezer: 90, pantry: 180, condiments: 365,
}

const FOOD_EMOJIS: Record<string, string> = {
  chicken: '\u{1F357}', beef: '\u{1F969}', salmon: '\u{1F41F}', fish: '\u{1F420}',
  shrimp: '\u{1F990}', egg: '\u{1F95A}', eggs: '\u{1F95A}', turkey: '\u{1F983}',
  pork: '\u{1F969}', tuna: '\u{1F41F}', ham: '\u{1F969}', bacon: '\u{1F953}',
  milk: '\u{1F95B}', cheese: '\u{1F9C0}', yoghurt: '\u{1F95B}', yogurt: '\u{1F95B}',
  butter: '\u{1F9C8}', cream: '\u{1F95B}',
  spinach: '\u{1F96C}', lettuce: '\u{1F96C}', kale: '\u{1F96C}',
  broccoli: '\u{1F966}', carrot: '\u{1F955}', tomato: '\u{1F345}',
  pepper: '\u{1FAD1}', onion: '\u{1F9C5}', garlic: '\u{1F9C4}',
  avocado: '\u{1F951}', cucumber: '\u{1F952}', potato: '\u{1F954}',
  corn: '\u{1F33D}', mushroom: '\u{1F344}',
  apple: '\u{1F34E}', banana: '\u{1F34C}', orange: '\u{1F34A}', lemon: '\u{1F34B}',
  berry: '\u{1FAD0}', strawberry: '\u{1F353}', grape: '\u{1F347}', mango: '\u{1F96D}',
  rice: '\u{1F35A}', pasta: '\u{1F35D}', bread: '\u{1F35E}', oat: '\u{1F33E}',
  flour: '\u{1F33E}', quinoa: '\u{1F33E}', cereal: '\u{1F963}', biscuit: '\u{1F36A}',
  cracker: '\u{1F36A}', nuts: '\u{1F95C}', peanut: '\u{1F95C}', hummus: '\u{1FAD9}',
  oil: '\u{1FAD9}', sauce: '\u{1FAD9}', mayo: '\u{1FAD9}', mustard: '\u{1FAD9}',
  ketchup: '\u{1FAD9}', soy: '\u{1FAD9}', sriracha: '\u{1F336}',
  coffee: '\u2615', tea: '\u{1F375}', juice: '\u{1F9C3}', water: '\u{1F4A7}',
  drink: '\u{1F964}', chocolate: '\u{1F36B}', protein: '\u{1F4AA}',
  sausage: '\u{1F32D}',
}
const STAPLES = ['eggs', 'milk', 'chicken', 'rice', 'yogurt', 'spinach', 'banana', 'oats']

function getEmoji(name: string): string {
  const lower = name.toLowerCase()
  for (const [key, emoji] of Object.entries(FOOD_EMOJIS)) {
    if (lower.includes(key)) return emoji
  }
  return '\u{1F6D2}'
}

function getFoodTint(name: string): string {
  const n = name.toLowerCase()
  if (['apple', 'banana', 'orange', 'berry', 'grape', 'mango'].some(k => n.includes(k))) return 'rgba(255,149,0,0.22)'
  if (['chicken', 'beef', 'salmon', 'fish', 'egg', 'turkey', 'pork'].some(k => n.includes(k))) return 'rgba(255,59,48,0.2)'
  if (['spinach', 'lettuce', 'broccoli', 'cucumber', 'avocado'].some(k => n.includes(k))) return 'rgba(52,199,89,0.22)'
  if (['milk', 'yogurt', 'cheese'].some(k => n.includes(k))) return 'rgba(10,132,255,0.22)'
  return 'rgba(175,82,222,0.18)'
}

async function detectBarcode(file: File): Promise<string | null> {
  if (!('BarcodeDetector' in window)) return null
  try {
    const BD = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (b: ImageBitmap) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
    const bitmap = await createImageBitmap(file)
    const barcodes = await detector.detect(bitmap)
    bitmap.close()
    if (!barcodes.length) return null
    return barcodes[0].rawValue
  } catch {
    return null
  }
}

function inferSection(name: string): Zone {
  const n = name.toLowerCase()
  if (['sauce', 'ketchup', 'mustard', 'mayo', 'vinegar', 'oil'].some(k => n.includes(k))) return 'condiments'
  if (['frozen', 'ice cream'].some(k => n.includes(k))) return 'freezer'
  if (['rice', 'pasta', 'oat', 'cereal', 'bread', 'nuts', 'flour'].some(k => n.includes(k))) return 'pantry'
  return 'fridge'
}

function daysOld(added: string | null): number {
  if (!added) return 0
  try {
    const d = new Date(`${added} ${new Date().getFullYear()}`)
    if (isNaN(d.getTime())) return 0
    return Math.floor((Date.now() - d.getTime()) / 86400000)
  } catch { return 0 }
}

const ZONE_CONFIG = {
  fridge: {
    label: 'Refrigerator', icon: '\u{1F9CA}',
    gradient: 'linear-gradient(135deg,#E8F4FF 0%,#F0F9FF 100%)',
    accent: '#007AFF', border: 'rgba(0,122,255,0.14)', text: '#0062CC',
  },
  freezer: {
    label: 'Freezer', icon: '\u2744\uFE0F',
    gradient: 'linear-gradient(135deg,#EBE8FF 0%,#F2EEFF 100%)',
    accent: '#5856D6', border: 'rgba(88,86,214,0.14)', text: '#4240A8',
  },
  pantry: {
    label: 'Pantry', icon: '\u{1FAD9}',
    gradient: 'linear-gradient(135deg,#FFF8EE 0%,#FFFAEF 100%)',
    accent: '#FF9500', border: 'rgba(255,149,0,0.14)', text: '#B86B00',
  },
  condiments: {
    label: 'Condiments', icon: '\u{1F336}\uFE0F',
    gradient: 'linear-gradient(135deg,#FFF0F0 0%,#FFF4EE 100%)',
    accent: '#FF3B30', border: 'rgba(255,59,48,0.14)', text: '#C5261C',
  },
}

function freshnessColor(age: number, zone: Zone): string {
  const pct = age / SHELF_LIFE[zone]
  if (pct >= 0.75) return 'var(--red)'
  if (pct >= 0.45) return 'var(--orange)'
  return 'var(--green)'
}

function ItemCard({
  item, zone, qty, onTap, onInc, onDec,
}: {
  item: FridgeItem
  zone: Zone
  qty: number
  onTap: () => void
  onInc: () => void
  onDec: () => void
}) {
  const age = daysOld(item.added)
  const pct = Math.min(age / SHELF_LIFE[zone], 1)
  const fColor = freshnessColor(age, zone)
  const cfg = ZONE_CONFIG[zone]
  const isOld = age > 5
  const isWarn = age > 3 && age <= 5
  const tint = getFoodTint(item.name)

  return (
    <button className="tap-lift" onClick={onTap} style={{
      background: isOld ? '#FFF0EE' : isWarn ? '#FFFAEE' : 'var(--card)',
      border: `1.5px solid ${isOld ? 'rgba(255,59,48,0.22)' : isWarn ? 'rgba(255,149,0,0.2)' : cfg.border}`,
      borderRadius: 16, padding: '10px 8px 8px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      cursor: 'pointer', textAlign: 'center', width: '100%', minWidth: 0,
      boxShadow: '0 4px 10px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
      WebkitTapHighlightColor: 'transparent', position: 'relative',
    }}>
      {isOld && <div style={{ position:'absolute', top:-7, right:-7, background:'var(--red)', color:'#fff', borderRadius:8, fontSize:9, fontWeight:700, padding:'2px 5px' }}>OLD</div>}
      {isWarn && !isOld && <div style={{ position:'absolute', top:-7, right:-7, background:'var(--orange)', color:'#fff', borderRadius:8, fontSize:9, fontWeight:700, padding:'2px 5px' }}>SOON</div>}
      <span style={{
        fontSize: 26, lineHeight: 1.1, padding: '2px 6px', borderRadius: 12,
        background: `linear-gradient(180deg, rgba(255,255,255,0.95), ${tint})`,
        boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.08)',
      }}>{getEmoji(item.name)}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label)', lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
        {item.name}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <button onClick={(e) => { e.stopPropagation(); onDec() }} style={{ border: 'none', background: 'var(--gray5)', color: 'var(--label)', width: 20, height: 20, borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>−</button>
        <span style={{ fontSize: 11, fontWeight: 700, minWidth: 16 }}>{qty}</span>
        <button onClick={(e) => { e.stopPropagation(); onInc() }} style={{ border: 'none', background: 'var(--blue)', color: '#fff', width: 20, height: 20, borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>+</button>
      </div>
      {(item.size || item.cost != null) && (
        <span style={{ fontSize: 10, color: 'var(--label2)', fontWeight: 500, lineHeight: 1.2 }}>
          {[item.size, item.cost != null ? `\u00A3${item.cost.toFixed(2)}` : null].filter(Boolean).join(' \u00B7 ')}
        </span>
      )}
      {age > 0 && (
        <div style={{ width: '100%', marginTop: 3 }}>
          <div style={{ height: 3, background: 'var(--gray5)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct * 100}%`, background: fColor, borderRadius: 2, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 10, color: fColor, fontWeight: 600, marginTop: 2 }}>{age}d</div>
        </div>
      )}
      {item.store && (
        <span style={{ fontSize: 9, fontWeight: 700, color: cfg.text, background: `${cfg.accent}18`,
          borderRadius: 6, padding: '1px 5px', maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.store.split(',')[0]}
        </span>
      )}
    </button>
  )
}

function ZoneSection({ zone, items, onRemove, getQty, onQty }: {
  zone: Zone
  items: FridgeItem[]
  onRemove: (name: string, zone: Zone) => void
  getQty: (name: string) => number
  onQty: (name: string, delta: number) => void
}) {
  const cfg = ZONE_CONFIG[zone]
  const totalCost = items.reduce((s, i) => s + (i.cost ?? 0), 0)
  const oldCount = items.filter(i => daysOld(i.added) > 5).length
  const warnCount = items.filter(i => { const a = daysOld(i.added); return a > 3 && a <= 5 }).length

  return (
    <div style={{ background: cfg.gradient, borderRadius: 18, border: `1.5px solid ${cfg.border}`, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>{cfg.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: cfg.text, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 11, color: cfg.text, opacity: 0.55, fontWeight: 600 }}>({items.length})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(oldCount + warnCount) > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700,
              color: oldCount > 0 ? 'var(--red)' : 'var(--orange)',
              background: oldCount > 0 ? '#FF3B3020' : '#FF950020',
              borderRadius: 8, padding: '2px 7px' }}>
              {oldCount + warnCount} expiring
            </span>
          )}
          {totalCost > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: cfg.text }}>
              {'£'}{totalCost.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: '4px 10px 12px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {items.map((item, i) => (
          <ItemCard
            key={i}
            item={item}
            zone={zone}
            qty={getQty(item.name)}
            onTap={() => onRemove(item.name, zone)}
            onInc={() => onQty(item.name, 1)}
            onDec={() => onQty(item.name, -1)}
          />
        ))}
      </div>
    </div>
  )
}

export default function Fridge() {
  const [data, setData] = useState<FridgeData>({ fridge: [], pantry: [], condiments: [], freezer: [] })
  const [meals, setMeals] = useState<Meal[]>([])
  const [loadingMeals, setLoadingMeals] = useState(false)
  const [showMeals, setShowMeals] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addZone, setAddZone] = useState<Zone>('fridge')
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<string | null>(null)
  const [barcodeScanning, setBarcodeScanning] = useState(false)
  const [removeModal, setRemoveModal] = useState<{ name: string; zone: Zone } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  const allItems = Object.values(data).flat()
  const totalItems = allItems.length
  const totalSpend = allItems.reduce((s, i) => s + (i.cost ?? 0), 0)
  const oldItems = allItems.filter(i => daysOld(i.added) > 5)
  const warnItems = allItems.filter(i => { const a = daysOld(i.added); return a > 3 && a <= 5 })
  const alertItems = [...oldItems, ...warnItems]
  const [groceryDone, setGroceryDone] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('grocery_done') || '[]') } catch { return [] }
  })
  const [qtyMap, setQtyMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('fridge_qty') || '{}') } catch { return {} }
  })

  useEffect(() => { api.getFridge().then(setData) }, [])
  useEffect(() => {
    try { localStorage.setItem('grocery_done', JSON.stringify(groceryDone)) } catch {}
  }, [groceryDone])
  useEffect(() => {
    try { localStorage.setItem('fridge_qty', JSON.stringify(qtyMap)) } catch {}
  }, [qtyMap])

  function qtyKey(name: string) { return name.trim().toLowerCase() }
  function getQty(name: string) { return Math.max(1, qtyMap[qtyKey(name)] ?? 1) }
  function onQty(name: string, delta: number) {
    setQtyMap(prev => {
      const key = qtyKey(name)
      const next = Math.max(0, (prev[key] ?? 1) + delta)
      return { ...prev, [key]: next }
    })
  }

  const smartGrocery = [
    ...alertItems.map(i => i.name),
    ...STAPLES.filter(staple => !allItems.some(i => i.name.toLowerCase().includes(staple))),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 10)

  function shareShoppingList() {
    const expiringLines = alertItems.map(i => `\u2022 ${i.name} (${daysOld(i.added)}d old \u2014 replace)`)
    const text = expiringLines.length > 0
      ? `\u{1F6D2} Shopping List\n\nNeeds replacing:\n${expiringLines.join('\n')}`
      : '\u{1F6D2} Shopping List\n\nFridge is well stocked! Nothing to replace yet.'
    if (navigator.share) {
      navigator.share({ title: 'Shopping List', text }).catch(() => {})
    } else {
      navigator.clipboard.writeText(text).then(() => {
        setScanStatus('\u2713 Shopping list copied to clipboard!')
        setTimeout(() => setScanStatus(null), 3000)
      })
    }
  }

  async function getMeals() {
    setLoadingMeals(true)
    setShowMeals(true)
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
    setScanStatus('Reading receipt\u2026')
    try {
      const result: ScanResult = await api.scanReceipt(file)
      if (result.error) {
        setScanStatus(`Could not read receipt \u2014 ${result.error}`)
        setTimeout(() => setScanStatus(null), 6000)
        return
      }
      const detected: ScannedItem[] = result.items ?? []
      if (detected.length === 0) {
        setScanStatus('No food items found \u2014 try a clearer photo')
        setTimeout(() => setScanStatus(null), 5000)
        return
      }
      const storeLabel = result.store?.name ? ` from ${result.store.name}` : ''
      setScanStatus(`Adding ${detected.length} item${detected.length !== 1 ? 's' : ''}${storeLabel}\u2026`)
      const storeName = result.store
        ? [result.store.name, result.store.location].filter(Boolean).join(', ')
        : null
      let added = 0
      await Promise.allSettled(detected.map(async item => {
        try {
          await api.addFridgeItem(item.name, item.section, { size: item.size, cost: item.cost, store: storeName })
          added++
        } catch {}
      }))
      const preview = detected.slice(0, 3).map(i => i.name).join(', ')
      const more = detected.length > 3 ? ` +${detected.length - 3} more` : ''
      setScanStatus(`\u2713 Added ${added} items${storeLabel}: ${preview}${more}`)
      const updated = await api.getFridge()
      setData(updated)
    } catch (err) {
      console.error('Receipt scan error:', err)
      setScanStatus('Scan failed \u2014 check your connection and try again')
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setScanStatus(null), 7000)
    }
  }

  async function handleBarcodeScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBarcodeScanning(true)
    setScanStatus('Scanning barcode...')
    try {
      const code = await detectBarcode(file)
      if (!code) {
        setScanStatus('No barcode found - try a clearer shot')
        return
      }
      const product = await api.lookupBarcode(code)
      if (!product?.name) {
        setScanStatus('Barcode found, but product not matched')
        return
      }
      const section = inferSection(product.name)
      await api.addFridgeItem(product.name, section)
      const updated = await api.getFridge()
      setData(updated)
      setScanStatus(`✓ Added ${product.name} to ${ZONE_CONFIG[section].label}`)
    } catch {
      setScanStatus('Barcode add failed - try again')
    } finally {
      setBarcodeScanning(false)
      if (barcodeInputRef.current) barcodeInputRef.current.value = ''
      setTimeout(() => setScanStatus(null), 4500)
    }
  }

  async function confirmRemove() {
    if (!removeModal) return
    const name = removeModal.name
    await api.removeFridgeItem(name)
    const updated = await api.getFridge()
    setData(updated)
    setRemoveModal(null)
    if (navigator.vibrate) navigator.vibrate(20)
    showToast(`Removed ${name}`)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName.trim()) return
    const name = addName.trim()
    await api.addFridgeItem(name, addZone)
    const updated = await api.getFridge()
    setData(updated)
    setAddName('')
    setShowAdd(false)
    if (navigator.vibrate) navigator.vibrate(10)
    showToast(`Added ${name} to ${ZONE_CONFIG[addZone].label}`)
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px' }}>
              🧊 Fridge
            </div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{totalItems} items</span>
              {totalSpend > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{'£'}{totalSpend.toFixed(2)} stocked</span>}
              {alertItems.length > 0 && (
                <span style={{ color: oldItems.length > 0 ? 'var(--red)' : 'var(--orange)', fontWeight: 600 }}>
                  \u26A0\uFE0F {alertItems.length} expiring
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => barcodeInputRef.current?.click()} disabled={barcodeScanning}
              style={{ background: barcodeScanning ? 'var(--gray5)' : 'var(--purple)', color: '#fff',
                border: 'none', borderRadius: 20, padding: '8px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: barcodeScanning ? 0.7 : 1 }}>
              {barcodeScanning ? <span className="btn-spinner" /> : '🏷️ Barcode'}
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={scanning}
              style={{ background: scanning ? 'var(--gray5)' : 'var(--green)', color: scanning ? 'var(--label2)' : '#fff',
                border: 'none', borderRadius: 20, padding: '8px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: scanning ? 0.7 : 1 }}>
              {scanning ? '\u23F3' : '\u{1F4F7} Scan'}
            </button>
            <button onClick={() => setShowAdd(true)}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Add
            </button>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScan} />
        <input ref={barcodeInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBarcodeScan} />

        {/* ── Scan toast ── */}
        {scanStatus && (
          <div style={{
            background: scanStatus.startsWith('\u2713') ? '#34C75912' : 'var(--card)',
            border: `1px solid ${scanStatus.startsWith('\u2713') ? 'rgba(52,199,89,0.2)' : 'var(--separator)'}`,
            borderRadius: 12, padding: '10px 16px', marginBottom: 12, fontSize: 14, fontWeight: 500,
            color: scanStatus.startsWith('\u2713') ? 'var(--green)' : 'var(--label2)',
          }}>{scanStatus}</div>
        )}

        {/* ── Expiry alert strip ── */}
        {alertItems.length > 0 && (
          <div style={{
            background: oldItems.length > 0 ? '#FF3B300E' : '#FF95000E',
            border: `1px solid ${oldItems.length > 0 ? 'rgba(255,59,48,0.18)' : 'rgba(255,149,0,0.18)'}`,
            borderRadius: 14, padding: '11px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>{oldItems.length > 0 ? '\u{1F6A8}' : '\u26A0\uFE0F'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: oldItems.length > 0 ? 'var(--red)' : 'var(--orange)' }}>
                {oldItems.length > 0 ? 'Past their best' : 'Eat soon'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {alertItems.slice(0, 4).map(i => i.name).join(' \u00B7 ')}
                {alertItems.length > 4 ? ` +${alertItems.length - 4}` : ''}
              </div>
            </div>
            <button onClick={shareShoppingList} style={{
              background: 'none', border: '1.5px solid var(--blue)', color: 'var(--blue)',
              borderRadius: 12, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}>📋 List</button>
          </div>
        )}

        {/* ── Empty state ── */}
        {totalItems === 0 && (
          <div style={{ textAlign: 'center', padding: '52px 24px' }}>
            <div style={{ fontSize: 64, marginBottom: 14 }}>🛒</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>Fridge is empty</div>
            <div style={{ fontSize: 14, color: 'var(--label2)', lineHeight: 1.6 }}>
              Scan a receipt to add everything at once,<br />or tap + Add to add items manually.
            </div>
          </div>
        )}

        {/* ── Zone sections ── */}
        {(['fridge', 'freezer', 'pantry', 'condiments'] as Zone[]).map(zone => {
          const items = data[zone] ?? []
          if (items.length === 0) return null
          return (
            <ZoneSection
              key={zone}
              zone={zone}
              items={items}
              onRemove={(name, z) => setRemoveModal({ name, zone: z })}
              getQty={getQty}
              onQty={onQty}
            />
          )
        })}

        {/* ── Bottom action row ── */}
        {totalItems > 0 && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={shareShoppingList} style={{
              flex: 1, background: 'var(--card)', border: '1.5px solid var(--separator)',
              borderRadius: 16, padding: '13px 8px', fontSize: 13, fontWeight: 600,
              color: 'var(--label)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>📋 Shopping List</button>
            <button onClick={getMeals} disabled={loadingMeals} style={{
              flex: 1, background: 'var(--blue)', border: 'none',
              borderRadius: 16, padding: '13px 8px', fontSize: 13, fontWeight: 600,
              color: '#fff', cursor: 'pointer', opacity: loadingMeals ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>{loadingMeals ? '\u23F3' : '\u{1F37D}\uFE0F What can I make?'}</button>
          </div>
        )}

        {/* ── Smart grocery list ── */}
        {smartGrocery.length > 0 && (
          <>
            <div className="section-label">Smart grocery list</div>
            <div className="card" style={{ marginBottom: 10 }}>
              {smartGrocery.map((item, idx) => {
                const done = groceryDone.includes(item)
                return (
                  <button
                    key={idx}
                    className="list-row"
                    onClick={() => setGroceryDone(d => done ? d.filter(x => x !== item) : [...d, item])}
                    style={{ width: '100%', border: 'none', textAlign: 'left', cursor: 'pointer', gap: 10 }}
                  >
                    <span style={{ fontSize: 18 }}>{done ? '✅' : '🛒'}</span>
                    <span style={{ flex: 1, fontSize: 15, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}>{item}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ── Meal suggestions ── */}
        {showMeals && meals.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="section-label" style={{ margin: 0 }}>Meal Ideas</div>
              <button onClick={() => setShowMeals(false)} style={{ background: 'none', border: 'none', color: 'var(--label3)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            {meals.map((m, i) => (
              <div key={i} style={{ background: 'var(--card)', borderRadius: 16, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{m.name}</div>
                  <span className="badge badge-blue" style={{ fontSize: 11, marginLeft: 8, flexShrink: 0 }}>~{m.kcal_estimate} kcal</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--label2)' }}>{m.ingredients.join(' \u00B7 ')}</div>
              </div>
            ))}
          </div>
        )}
        {showMeals && loadingMeals && (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--label2)', fontSize: 14 }}>
            \u23F3 Finding meal ideas from your fridge\u2026
          </div>
        )}
      </div>

      {/* ── Remove sheet ── */}
      {removeModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setRemoveModal(null) }}>
          <div style={{ background:'var(--card)', borderRadius:'20px 20px 0 0', padding:'20px 20px 44px', width:'100%', animation:'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', position:'relative' }}>
            <button className="sheet-close" onClick={() => setRemoveModal(null)} style={{ position:'absolute', top:16, right:16 }}>×</button>
            <div style={{ width:36, height:5, background:'var(--gray4)', borderRadius:3, margin:'0 auto 18px' }} />
            <div style={{ fontSize:17, fontWeight:600, marginBottom:4 }}>Remove from fridge?</div>
            <div style={{ fontSize:15, color:'var(--label2)', marginBottom:24 }}>
              {getEmoji(removeModal.name)} {removeModal.name}
            </div>
            <button className="btn-destructive" onClick={confirmRemove} style={{ width:'100%', marginBottom:12 }}>Remove</button>
            <button onClick={() => setRemoveModal(null)} style={{ width:'100%', background:'none', border:'none', color:'var(--blue)', fontSize:17, fontWeight:600, cursor:'pointer', padding:12 }}>Keep it</button>
          </div>
        </div>
      )}

      {/* ── Add item sheet ── */}
      {showAdd && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:200, display:'flex', alignItems:'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}>
          <div style={{ background:'var(--card)', borderRadius:'20px 20px 0 0', padding:'20px 20px 44px', width:'100%', animation:'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', position:'relative' }}>
            <button className="sheet-close" onClick={() => setShowAdd(false)} style={{ position:'absolute', top:16, right:16 }}>×</button>
            <div style={{ width:36, height:5, background:'var(--gray4)', borderRadius:3, margin:'0 auto 16px' }} />
            <div style={{ fontSize:20, fontWeight:700, marginBottom:16 }}>Add to fridge</div>
            <form onSubmit={handleAdd}>
              <input className="input-field" style={{ marginBottom:12 }}
                placeholder="Item name (e.g. Chicken breast)"
                value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
              <div style={{ display:'flex', gap:8, marginBottom:20 }}>
                {(['fridge','freezer','pantry','condiments'] as Zone[]).map(z => (
                  <button key={z} type="button" onClick={() => setAddZone(z)}
                    style={{ flex:1, padding:'8px 2px', borderRadius:10, border:'none', cursor:'pointer',
                      background: addZone === z ? ZONE_CONFIG[z].accent : 'var(--gray5)',
                      color: addZone === z ? '#fff' : 'var(--label)',
                      fontSize:11, fontWeight:700 }}>
                    {ZONE_CONFIG[z].icon}
                  </button>
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={!addName.trim()} style={{ opacity: !addName.trim() ? 0.5 : 1 }}>
                Add to {ZONE_CONFIG[addZone].label}
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }`}</style>
    </div>
  )
}
