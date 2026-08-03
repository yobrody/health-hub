import { useRef, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import { useSwipeDown } from '../hooks/useSwipeDown'
import { rememberFood } from '../lib/food-memory'
import type { FridgeData, SmartScanResult, BarcodeLookupResult, ScannedItem } from '../api/client'

type Stage = 'idle' | 'analyzing' | 'barcode-result' | 'receipt-result' | 'food-result'

interface Props {
  open: boolean
  onClose: () => void
  fridgeData?: FridgeData | null
  onFridgeUpdated: () => void
}

// Compress image to ~200px wide thumbnail for diary storage (~20-30KB)
async function compressThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 220 / img.width)
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.65))
      } catch { resolve('') }
      finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve('') }
    img.src = url
  })
}

function inferSection(name: string): 'fridge' | 'freezer' | 'pantry' | 'condiments' {
  const n = name.toLowerCase()
  if (['sauce', 'ketchup', 'mustard', 'mayo', 'vinegar', 'oil'].some(k => n.includes(k))) return 'condiments'
  if (['frozen', 'ice cream'].some(k => n.includes(k))) return 'freezer'
  if (['rice', 'pasta', 'oat', 'cereal', 'bread', 'nuts', 'flour'].some(k => n.includes(k))) return 'pantry'
  return 'fridge'
}

function saveDiaryEntry(datetime: string, thumbnail: string, foods: Array<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number | null }>) {
  try {
    const existing: unknown[] = JSON.parse(localStorage.getItem('photo_diary') || '[]')
    const entry = { datetime, thumbnail, foods }
    localStorage.setItem('photo_diary', JSON.stringify([entry, ...existing].slice(0, 90)))
  } catch { /* localStorage quota or access denied */ }
}

export default function SmartScanner({ open, onClose, onFridgeUpdated, fridgeData }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sheetSwipe = useSwipeDown(handleClose) // swipe-down-to-dismiss (handleClose is hoisted)

  // Barcode result state
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeLookupResult | null>(null)
  const [barcodeCode, setBarcodeCode] = useState<string | null>(null)
  const [barcodeSource, setBarcodeSource] = useState<string>('open_food_facts')

  // Receipt result state
  const [receiptItems, setReceiptItems] = useState<ScannedItem[]>([])

  // Food result state
  const [foodResult, setFoodResult] = useState<SmartScanResult & { type: 'food' } | null>(null)
  const [thumbnail, setThumbnail] = useState('')

  // Editable food item state
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [recalculating, setRecalculating] = useState(false)
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({})
  const [updatedIndices, setUpdatedIndices] = useState<Set<number>>(new Set())
  const [addingItem, setAddingItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')

  function reset() {
    setStage('idle')
    setSaving(false)
    setBarcodeProduct(null)
    setBarcodeCode(null)
    setBarcodeSource('open_food_facts')
    setReceiptItems([])
    setFoodResult(null)
    setThumbnail('')
    setEditingIndex(null)
    setEditName('')
    setRecalculating(false)
    setItemNotes({})
    setUpdatedIndices(new Set())
    setAddingItem(false)
    setNewItemName('')
  }

  async function handleRecalculate(index: number, newName: string, originalName: string) {
    if (!foodResult || !newName.trim()) return
    setRecalculating(true)
    try {
      const result = await api.recalculateFood(newName.trim(), originalName)
      const newFoods = [...foodResult.foods]
      newFoods[index] = {
        name: result.name,
        kcal: result.kcal,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        grams: result.grams,
      }
      setFoodResult({ ...foodResult, foods: newFoods })
      if (result.note) {
        setItemNotes(prev => ({ ...prev, [index]: result.note }))
      }
      setUpdatedIndices(prev => new Set(prev).add(index))
      // Update diary entry with corrected data
      saveDiaryEntry(new Date().toISOString(), thumbnail, newFoods)
      setEditingIndex(null)
      setEditName('')
      showToast(`Updated: ${result.name}`)
    } catch {
      showToast('Recalculation failed -- try again', 'err')
    } finally {
      setRecalculating(false)
    }
  }

  async function handleAddItem() {
    if (!foodResult || !newItemName.trim()) return
    setRecalculating(true)
    try {
      const result = await api.recalculateFood(newItemName.trim(), '')
      const newFoods = [...foodResult.foods, {
        name: result.name,
        kcal: result.kcal,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        grams: result.grams,
      }]
      const newIndex = newFoods.length - 1
      setFoodResult({ ...foodResult, foods: newFoods })
      if (result.note) {
        setItemNotes(prev => ({ ...prev, [newIndex]: result.note }))
      }
      setUpdatedIndices(prev => new Set(prev).add(newIndex))
      saveDiaryEntry(new Date().toISOString(), thumbnail, newFoods)
      setAddingItem(false)
      setNewItemName('')
      showToast(`Added: ${result.name}`)
    } catch {
      showToast('Failed to add item -- try again', 'err')
    } finally {
      setRecalculating(false)
    }
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (inputRef.current) inputRef.current.value = ''
    setStage('analyzing')

    try {
      const [result, thumb] = await Promise.all([
        api.smartScan(file),
        compressThumbnail(file),
      ])
      setThumbnail(thumb)

      if (result.type === 'barcode') {
        if (!result.code) {
          showToast('Barcode detected but could not read the number', 'err')
          setStage('idle')
          return
        }
        // Look up the barcode via Open Food Facts (server-side, with AI fallback)
        try {
          const headers = new Headers({ 'Content-Type': 'application/json' })
          const KEY = import.meta.env.VITE_API_KEY || undefined
          if (KEY) headers.set('X-Health-Key', KEY as string)
          const BASE = import.meta.env.VITE_API_BASE || '/api'
          const barcodeRes = await fetch(`${BASE}/barcode/${encodeURIComponent(result.code)}`, { headers })
          if (!barcodeRes.ok) {
            showToast(`No product found for barcode ${result.code}`, 'info')
            setStage('idle')
            return
          }
          const serverProduct = await barcodeRes.json()
          const product: BarcodeLookupResult & { source?: string } = {
            name: serverProduct.name,
            brand: serverProduct.brand,
            serving_size: serverProduct.serving_size,
            image_url: serverProduct.image_url,
            kcal: serverProduct.per_100g?.kcal,
            protein_g: serverProduct.per_100g?.protein_g,
            carbs_g: serverProduct.per_100g?.carbs_g,
            fat_g: serverProduct.per_100g?.fat_g,
            per_100g: serverProduct.per_100g,
          }
          setBarcodeCode(result.code)
          setBarcodeProduct(product)
          setBarcodeSource(serverProduct.source || 'open_food_facts')
          setStage('barcode-result')
        } catch {
          showToast(`Barcode lookup failed for ${result.code}`, 'err')
          setStage('idle')
          return
        }

      } else if (result.type === 'receipt') {
        if (!result.items?.length) {
          showToast('No items found on receipt', 'info')
          setStage('idle')
          return
        }
        setReceiptItems(result.items)
        setStage('receipt-result')

      } else {
        // food
        if (!result.foods?.length) {
          showToast('No food detected -- try a clearer photo', 'info')
          setStage('idle')
          return
        }
        // Guard against hallucination from blank photos
        const totalKcal = result.foods.reduce((a, f) => a + (f.kcal || 0), 0)
        if (totalKcal === 0) {
          showToast("Couldn't identify food -- try a clearer photo", 'err')
          setStage('idle')
          return
        }
        setFoodResult(result as SmartScanResult & { type: 'food' })
        if (thumb && result.foods.length > 0) {
          saveDiaryEntry(new Date().toISOString(), thumb, result.foods)
        }
        setStage('food-result')
      }
    } catch {
      showToast('Scan failed -- try again', 'err')
      setStage('idle')
    }
  }

  // ── Barcode actions ──
  async function barcodeAction(choice: 'log' | 'fridge' | 'both') {
    if (!barcodeProduct?.name) return
    setSaving(true)
    try {
      const section = inferSection(barcodeProduct.name)
      if (choice === 'fridge' || choice === 'both') {
        await api.addFridgeItem(barcodeProduct.name, section, {
          photo_url: barcodeProduct.image_url ?? null,
        })
        onFridgeUpdated()
      }
      if (choice === 'log' || choice === 'both') {
        const h = new Date().getHours()
        const meal = h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner'
        await api.addFood({
          meal,
          description: barcodeProduct.name,
          kcal: barcodeProduct.kcal ?? 0,
          protein_g: barcodeProduct.protein_g,
        })
        window.dispatchEvent(new CustomEvent('food-logged'))
      }
      const msg = choice === 'both'
        ? `Logged & added to fridge: ${barcodeProduct.name}`
        : choice === 'fridge'
          ? `Added to fridge: ${barcodeProduct.name}`
          : `Logged: ${barcodeProduct.name}${barcodeProduct.kcal ? ` -- ${barcodeProduct.kcal} kcal` : ''}`
      showToast(msg)
      handleClose()
    } catch {
      showToast('Action failed -- try again', 'err')
    } finally {
      setSaving(false)
    }
  }

  // ── Receipt action ──
  async function addReceiptToFridge() {
    setSaving(true)
    try {
      await Promise.all(receiptItems.map(item =>
        api.addFridgeItem(item.name, item.section, {
          size: item.size,
          cost: item.cost,
          unit_size_g: item.unit_size_g ?? null,
          unit_count: item.unit_count ?? null,
        })
      ))
      onFridgeUpdated()
      showToast(`Added ${receiptItems.length} items from receipt`)
      // Fire-and-forget photo lookup for each new item
      void Promise.all(receiptItems.map(item =>
        api.lookupPhoto(item.name)
          .then(r => r.photo_url ? api.addFridgeItem(item.name, item.section, { photo_url: r.photo_url }) : null)
          .catch(() => {})
      )).then(() => onFridgeUpdated())
      handleClose()
    } catch {
      showToast('Failed to add items', 'err')
    } finally {
      setSaving(false)
    }
  }

  // ── Food log action ──
  async function logFood() {
    if (!foodResult || !foodResult.foods.length) return
    setSaving(true)
    try {
      const totalKcal = foodResult.foods.reduce((a, f) => a + f.kcal, 0)
      const totalProtein = Math.round(foodResult.foods.reduce((a, f) => a + f.protein_g, 0))
      const foodLine = foodResult.foods.map(f => f.name).join(', ')
      const h = new Date().getHours()
      const meal = h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner'

      await api.addFood({ meal, description: foodLine, kcal: totalKcal, protein_g: totalProtein })
      // Each identified food feeds the personal memory ("Your usual").
      foodResult.foods.forEach(f => rememberFood({ name: f.name, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g ?? undefined, fat_g: f.fat_g ?? undefined }))
      window.dispatchEvent(new CustomEvent('food-logged'))
      // Fridge cross-reference — ported from the retired CameraSheet (which was
      // unreachable, so scans never depleted inventory). Match identified foods
      // against fridge items; decrement stock + feed the learned shelf-life
      // model. Best-effort: never blocks the food log.
      let usedCount = 0
      if (fridgeData) {
        try {
          const zones = ['fridge', 'freezer', 'pantry', 'condiments'] as const
          const inventory = zones.flatMap(z => (fridgeData[z] || []).map(it => ({ ...it, zone: z })))
          const matched = new Map<string, { zone: string; added: string | null; grams: number | null }>()
          for (const f of foodResult.foods) {
            const fname = f.name.toLowerCase()
            const hit = inventory.find(it => {
              const iname = it.name.toLowerCase()
              return iname === fname || fname.includes(iname) || iname.includes(fname)
            })
            if (hit && !matched.has(hit.name)) {
              matched.set(hit.name, { zone: hit.zone, added: hit.added, grams: typeof f.grams === 'number' && f.grams > 0 ? f.grams : null })
            }
          }
          if (matched.size) {
            usedCount = matched.size
            void Promise.all([...matched.entries()].flatMap(([name, m]) => [
              api.logFridgeUsage({ item_name: name, zone: m.zone, date_added: m.added ?? null }).catch(() => {}),
              api.consumeFridgeItem(name, m.grams !== null ? { grams: m.grams } : { count: 1 }).catch(() => {}),
            ])).then(() => onFridgeUpdated())
          }
        } catch { /* cross-ref is best-effort */ }
      }
      showToast(`Logged ${totalKcal} kcal${usedCount ? ` · used ${usedCount} from fridge` : ''}`)
      handleClose()
    } catch {
      showToast('Failed to save -- try again', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const totalKcal = foodResult?.foods.reduce((a, f) => a + f.kcal, 0) ?? 0
  const totalProtein = Math.round(foodResult?.foods.reduce((a, f) => a + f.protein_g, 0) ?? 0)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        {...sheetSwipe.bind}
        style={{
          background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
          padding: '16px 20px calc(32px + var(--safe-bottom))',
          animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)',
          maxHeight: '90vh', overflowY: 'auto',
          ...sheetSwipe.style,
        }}
      >
        {/* Handle + header */}
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {stage === 'barcode-result' ? 'Product found'
              : stage === 'receipt-result' ? 'Receipt scanned'
              : stage === 'food-result' ? 'Food identified'
              : stage === 'analyzing' ? 'Scanning...'
              : 'Smart Scan'}
          </div>
          <button className="sheet-close" onClick={handleClose}>x</button>
        </div>

        {/* Hidden file input */}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />

        {/* ── Idle: single scan button ── */}
        {stage === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 15, color: 'var(--label2)', textAlign: 'center', marginBottom: 8, lineHeight: 1.5 }}>
              Point your camera at <strong>food</strong>, a <strong>barcode</strong>, or a <strong>receipt</strong> -- AI figures out what it is.
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 18,
                padding: '20px 40px', fontSize: 18, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              Take Photo
            </button>
          </div>
        )}

        {/* ── Analyzing spinner ── */}
        {stage === 'analyzing' && (
          <div style={{ textAlign: 'center', padding: '36px 0' }}>
            <div style={{ width: 44, height: 44, border: '3px solid var(--gray4)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spinnerRot 0.65s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>Analysing photo...</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 6 }}>AI is detecting what this is</div>
          </div>
        )}

        {/* ── Barcode result ── */}
        {stage === 'barcode-result' && barcodeProduct && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ background: 'rgba(175,82,222,0.12)', color: 'var(--purple)', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                Barcode detected
              </span>
              {barcodeCode && (
                <span style={{ background: 'var(--gray6)', borderRadius: 16, padding: '4px 10px', fontSize: 12, color: 'var(--label3)' }}>
                  {barcodeCode}
                </span>
              )}
              <span style={{
                background: barcodeSource === 'ai_estimate' ? 'rgba(255,159,10,0.12)' : 'rgba(52,199,89,0.12)',
                color: barcodeSource === 'ai_estimate' ? 'var(--orange)' : 'var(--green)',
                borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600,
              }}>
                {barcodeSource === 'ai_estimate' ? 'AI estimate' : 'Open Food Facts'}
              </span>
            </div>
            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {barcodeProduct.image_url && (
                  <img src={barcodeProduct.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', background: 'var(--gray5)' }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{barcodeProduct.name}</div>
                  {barcodeProduct.brand && <div style={{ fontSize: 13, color: 'var(--label2)' }}>{barcodeProduct.brand}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                {barcodeProduct.kcal != null && (
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue)' }}>{barcodeProduct.kcal} kcal</span>
                )}
                {barcodeProduct.protein_g != null && (
                  <span style={{ fontSize: 14, color: 'var(--label2)' }}>{barcodeProduct.protein_g}g protein</span>
                )}
                {barcodeProduct.carbs_g != null && (
                  <span style={{ fontSize: 14, color: 'var(--label2)' }}>{barcodeProduct.carbs_g}g carbs</span>
                )}
                {barcodeProduct.fat_g != null && (
                  <span style={{ fontSize: 14, color: 'var(--label2)' }}>{barcodeProduct.fat_g}g fat</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => barcodeAction('log')} disabled={saving} className="btn-primary">
                {saving ? <><span className="btn-spinner" /> Saving...</> : `Log ${barcodeProduct.kcal ? `${barcodeProduct.kcal} kcal` : 'to diary'}`}
              </button>
              <button
                onClick={() => barcodeAction('fridge')} disabled={saving}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 14, fontSize: 17, fontWeight: 600, padding: '14px 24px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
              >
                Add to fridge
              </button>
              <button
                onClick={() => barcodeAction('both')} disabled={saving}
                style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 14, fontSize: 17, fontWeight: 600, padding: '14px 24px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
              >
                Log + add to fridge
              </button>
              <button onClick={reset} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}>
                Scan again
              </button>
            </div>
          </>
        )}

        {/* ── Receipt result ── */}
        {stage === 'receipt-result' && receiptItems.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <span style={{ background: 'rgba(52,199,89,0.12)', color: 'var(--green)', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                Receipt detected
              </span>
              <span style={{ background: 'var(--gray6)', borderRadius: 16, padding: '4px 10px', fontSize: 12, color: 'var(--label3)' }}>
                {receiptItems.length} items
              </span>
            </div>
            <div className="card" style={{ padding: '0 16px', marginBottom: 20 }}>
              {receiptItems.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < receiptItems.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--label3)' }}>{item.section}{item.size ? ` -- ${item.size}` : ''}</div>
                  </div>
                  {item.cost != null && (
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green)' }}>
                      {typeof item.cost === 'number' ? `£${item.cost.toFixed(2)}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addReceiptToFridge} disabled={saving} className="btn-primary"
              style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {saving ? <><span className="btn-spinner" /> Adding...</> : `Add ${receiptItems.length} items to fridge`}
            </button>
            <button onClick={reset} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}>
              Scan again
            </button>
          </>
        )}

        {/* ── Food result ── */}
        {stage === 'food-result' && foodResult && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <span style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--blue)', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                Food detected
              </span>
              <span style={{ background: 'var(--gray6)', borderRadius: 16, padding: '4px 10px', fontSize: 12, color: 'var(--label3)' }}>
                {foodResult.confidence} confidence
              </span>
            </div>

            {/* Thumbnail preview */}
            {thumbnail && (
              <div style={{ marginBottom: 14 }}>
                <img src={thumbnail} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 14, background: 'var(--gray5)' }} />
              </div>
            )}

            <div className="card" style={{ padding: '0 16px', marginBottom: 16 }}>
              {foodResult.foods.map((f, i) => (
                <div key={i} style={{
                  padding: '12px 0',
                  borderBottom: i < foodResult.foods.length - 1 ? '0.5px solid var(--separator)' : 'none',
                  borderLeft: editingIndex === i ? '3px solid var(--blue)' : '3px solid transparent',
                  paddingLeft: editingIndex === i ? 8 : 0,
                  transition: 'all 0.2s ease',
                }}>
                  {editingIndex === i ? (
                    /* Editing mode */
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          autoCorrect="on"
                          spellCheck={true}
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') handleRecalculate(i, editName, f.name) }}
                          style={{
                            flex: 1, fontSize: 15, fontWeight: 600, padding: '8px 10px',
                            border: '2px solid var(--blue)', borderRadius: 10,
                            background: 'var(--gray6)', color: 'var(--label)',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleRecalculate(i, editName, f.name)}
                          disabled={recalculating || !editName.trim()}
                          style={{
                            flex: 1, background: 'var(--blue)', color: '#fff', border: 'none',
                            borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 600,
                            cursor: 'pointer', opacity: recalculating || !editName.trim() ? 0.5 : 1,
                            animation: !recalculating && editName.trim() ? 'subtlePulse 2s ease-in-out infinite' : 'none',
                          }}
                        >
                          {recalculating ? 'Recalculating...' : 'Recalculate'}
                        </button>
                        <button
                          onClick={() => { setEditingIndex(null); setEditName('') }}
                          style={{
                            background: 'var(--gray5)', color: 'var(--label2)', border: 'none',
                            borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display mode - tappable */
                    <div
                      onClick={() => { setEditingIndex(i); setEditName(f.name) }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    >
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                        {itemNotes[i] && (
                          <div style={{ fontSize: 11, color: 'var(--label3)', marginTop: 2, fontStyle: 'italic' }}>{itemNotes[i]}</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 15, fontWeight: 700, color: 'var(--blue)',
                          // "flash on recalculate" — the old code set the same
                          // scale(1) in both branches, so nothing ever showed.
                          background: updatedIndices.has(i) ? 'rgba(52,199,89,0.10)' : undefined,
                          borderRadius: 6,
                          transition: 'background 0.6s ease',
                        }}>{f.kcal} kcal</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)' }}>{f.protein_g}g P / {f.carbs_g}g C / {f.fat_g}g F</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Add item section */}
              {addingItem ? (
                <div style={{ padding: '12px 0', borderTop: '0.5px solid var(--separator)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input
                      type="text"
                      value={newItemName}
                      onChange={e => setNewItemName(e.target.value)}
                      placeholder="e.g. glass of orange juice"
                      autoCorrect="on"
                      spellCheck={true}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleAddItem() }}
                      style={{
                        flex: 1, fontSize: 15, fontWeight: 600, padding: '8px 10px',
                        border: '2px solid var(--green)', borderRadius: 10,
                        background: 'var(--gray6)', color: 'var(--label)',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleAddItem}
                      disabled={recalculating || !newItemName.trim()}
                      style={{
                        flex: 1, background: 'var(--green)', color: '#fff', border: 'none',
                        borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer', opacity: recalculating || !newItemName.trim() ? 0.5 : 1,
                      }}
                    >
                      {recalculating ? 'Adding...' : 'Add item'}
                    </button>
                    <button
                      onClick={() => { setAddingItem(false); setNewItemName('') }}
                      style={{
                        background: 'var(--gray5)', color: 'var(--label2)', border: 'none',
                        borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingItem(true)}
                  style={{
                    width: '100%', padding: '10px 0', border: 'none', background: 'none',
                    color: 'var(--blue)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    borderTop: '0.5px solid var(--separator)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6,
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add missing item
                </button>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '0.5px solid var(--separator)' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Total</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)' }}>{totalKcal} kcal / {totalProtein}g protein</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--label3)', textAlign: 'center', padding: '0 0 4px' }}>
                Tap any item to edit
              </div>
            </div>

            <button
              onClick={logFood} disabled={saving} className="btn-primary"
              style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {saving ? <><span className="btn-spinner" /> Saving...</> : `Log ${totalKcal} kcal`}
            </button>
            <button onClick={reset} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}>
              Retake photo
            </button>
          </>
        )}
      </div>
    </div>
  )
}
