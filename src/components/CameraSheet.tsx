import { useRef, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { FridgeData, FoodAnalysisV2, FridgeItem, BarcodeLookupResult } from '../api/client'

type Stage = 'idle' | 'analyzing' | 'result' | 'barcode'

interface Props {
  open: boolean
  onClose: () => void
  fridgeData: FridgeData | null
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

async function detectBarcode(file: File): Promise<string | null> {
  if (!('BarcodeDetector' in window)) return null
  try {
    const BD = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (b: ImageBitmap) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
    const bitmap = await createImageBitmap(file)
    const barcodes = await detector.detect(bitmap)
    bitmap.close()
    if (!barcodes.length) return null
    return barcodes[0].rawValue
  } catch {
    return null
  }
}

function inferSection(name: string): 'fridge' | 'freezer' | 'pantry' | 'condiments' {
  const n = name.toLowerCase()
  if (['sauce', 'ketchup', 'mustard', 'mayo', 'vinegar', 'oil'].some(k => n.includes(k))) return 'condiments'
  if (['frozen', 'ice cream'].some(k => n.includes(k))) return 'freezer'
  if (['rice', 'pasta', 'oat', 'cereal', 'bread', 'nuts', 'flour'].some(k => n.includes(k))) return 'pantry'
  return 'fridge'
}

function saveDiaryEntry(datetime: string, thumbnail: string, foods: FoodAnalysisV2['foods']) {
  try {
    const existing: unknown[] = JSON.parse(localStorage.getItem('photo_diary') || '[]')
    const entry = { datetime, thumbnail, foods }
    localStorage.setItem('photo_diary', JSON.stringify([entry, ...existing].slice(0, 90)))
  } catch { /* localStorage quota or access denied */ }
}

// Upload thumbnail to R2 and update the diary entry in-place once done.
// Falls back silently — diary already has the base64 version.
async function uploadAndUpdateDiary(thumbnail: string, datetime: string) {
  try {
    const url = await api.uploadPhoto(thumbnail)
    const existing: Array<{ datetime: string; thumbnail: string }> = JSON.parse(localStorage.getItem('photo_diary') || '[]')
    const idx = existing.findIndex(e => e.datetime === datetime)
    if (idx !== -1) {
      existing[idx].thumbnail = url
      localStorage.setItem('photo_diary', JSON.stringify(existing))
    }
  } catch {
    // R2 not yet configured or network error — local base64 stays
  }
}

export default function CameraSheet({ open, onClose, fridgeData, onFridgeUpdated }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [analysis, setAnalysis] = useState<FoodAnalysisV2 | null>(null)
  const [checkedMatches, setCheckedMatches] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeLookupResult | null>(null)
  const [barcodeActioning, setBarcodeActioning] = useState(false)
  const foodInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStage('idle')
    setAnalysis(null)
    setCheckedMatches(new Set())
    setSaving(false)
    setBarcodeProduct(null)
    setBarcodeActioning(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleFoodPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (foodInputRef.current) foodInputRef.current.value = ''
    setStage('analyzing')
    try {
      const [result, thumbnail] = await Promise.all([
        api.analyzeFoodV2(file, fridgeData),
        compressThumbnail(file),
      ])
      setAnalysis(result)
      setCheckedMatches(new Set(result.fridge_matches.map((m: FridgeItem & { zone: string }) => m.name)))
      if (thumbnail && result.foods.length > 0) {
        const datetime = new Date().toISOString()
        saveDiaryEntry(datetime, thumbnail, result.foods)
        // Fire-and-forget: replace base64 with R2 URL in background
        uploadAndUpdateDiary(thumbnail, datetime)
      }
      setStage('result')
    } catch {
      showToast('Analysis failed — try again', 'err')
      setStage('idle')
    }
  }

  async function handleReceiptPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (receiptInputRef.current) receiptInputRef.current.value = ''
    setStage('analyzing')
    try {
      const result = await api.scanReceipt(file)
      if (result.items?.length) {
        await Promise.all(result.items.map(item =>
          api.addFridgeItem(item.name, item.section, { size: item.size, cost: item.cost })
        ))
        onFridgeUpdated()
        showToast(`Added ${result.items.length} items from receipt`)
      } else {
        showToast('No items found on receipt', 'info')
      }
      handleClose()
    } catch {
      showToast('Receipt scan failed', 'err')
      setStage('idle')
    }
  }

  async function handleBarcodePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (barcodeInputRef.current) barcodeInputRef.current.value = ''
    setStage('analyzing')
    try {
      const barcode = await detectBarcode(file)
      if (!barcode) {
        showToast('Barcode not detected — try a clearer photo', 'err')
        setStage('idle')
        return
      }
      const result = await api.lookupBarcode(barcode)
      if (!result) {
        showToast('No product found for that barcode', 'info')
        setStage('idle')
        return
      }
      setBarcodeProduct(result)
      setStage('barcode')
    } catch {
      showToast('Barcode scan failed — try again', 'err')
      setStage('idle')
    }
  }

  async function applyBarcodeChoice(choice: 'log' | 'fridge' | 'both') {
    if (!barcodeProduct?.name) return
    setBarcodeActioning(true)
    try {
      const section = inferSection(barcodeProduct.name)
      if (choice === 'fridge' || choice === 'both') {
        await api.addFridgeItem(barcodeProduct.name, section)
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
      }
      const msg = choice === 'both'
        ? `Logged & added to fridge: ${barcodeProduct.name}`
        : choice === 'fridge'
          ? `Added to fridge: ${barcodeProduct.name}`
          : `Logged: ${barcodeProduct.name}${barcodeProduct.kcal ? ` · ${barcodeProduct.kcal} kcal` : ''}`
      showToast(msg)
      handleClose()
    } catch {
      showToast('Action failed — try again', 'err')
    } finally {
      setBarcodeActioning(false)
    }
  }

  async function confirmLog() {
    if (!analysis || analysis.foods.length === 0) return
    setSaving(true)
    try {
      const totalKcal = analysis.foods.reduce((a, f) => a + f.kcal, 0)
      const totalProtein = Math.round(analysis.foods.reduce((a, f) => a + f.protein_g, 0))
      const description = analysis.foods.map(f => f.name).join(', ')
      const h = new Date().getHours()
      const meal = h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner'

      await api.addFood({ meal, description, kcal: totalKcal, protein_g: totalProtein })

      // Log usage + remove checked fridge items
      const matched = analysis.fridge_matches.filter(m => checkedMatches.has(m.name))
      if (matched.length) {
        await Promise.all([
          ...matched.map(m =>
            api.logFridgeUsage({ item_name: m.name, zone: m.zone || 'fridge', date_added: m.added ?? null }).catch(() => {})
          ),
          ...matched.map(m => api.removeFridgeItem(m.name).catch(() => {})),
        ])
        onFridgeUpdated()
      }

      showToast(`Logged ${totalKcal} kcal${matched.length ? ` · removed ${matched.length} from fridge` : ''}`)
      handleClose()
    } catch {
      showToast('Failed to save — try again', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const totalKcal = analysis?.foods.reduce((a, f) => a + f.kcal, 0) ?? 0
  const totalProtein = Math.round(analysis?.foods.reduce((a, f) => a + f.protein_g, 0) ?? 0)
  const hasBarcodeSupport = typeof window !== 'undefined' && 'BarcodeDetector' in window

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '22px 22px 0 0', width: '100%',
        padding: '16px 20px calc(32px + var(--safe-bottom))',
        animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Handle + header */}
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {stage === 'result' ? 'Food identified' : stage === 'barcode' ? 'Product found' : 'Camera'}
          </div>
          <button className="sheet-close" onClick={handleClose}>×</button>
        </div>

        {/* Hidden file inputs */}
        <input ref={foodInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFoodPhoto} />
        <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleReceiptPhoto} />
        <input ref={barcodeInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBarcodePhoto} />

        {/* Idle — mode picker */}
        {stage === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => foodInputRef.current?.click()}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', fontSize: 17, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <path d="M3 2l1.5 7H19.5L21 2"/><path d="M4.5 9l1 11h13l1-11"/>
              </svg>
              <div>
                <div>Log Food</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>Photo → AI identifies items + macros</div>
              </div>
            </button>

            <button
              onClick={() => receiptInputRef.current?.click()}
              style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', fontSize: 17, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <rect x="4" y="2" width="16" height="20" rx="2"/>
                <line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/>
              </svg>
              <div>
                <div>Scan Receipt</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>Add items directly to fridge</div>
              </div>
            </button>

            <button
              onClick={() => barcodeInputRef.current?.click()}
              disabled={!hasBarcodeSupport}
              style={{
                background: hasBarcodeSupport ? 'var(--purple)' : 'var(--gray4)',
                color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px',
                fontSize: 17, fontWeight: 700, cursor: hasBarcodeSupport ? 'pointer' : 'default',
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14,
                opacity: hasBarcodeSupport ? 1 : 0.5,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <rect x="1" y="4" width="4" height="16"/><rect x="7" y="4" width="2" height="16"/>
                <rect x="11" y="4" width="4" height="16"/><rect x="17" y="4" width="2" height="16"/>
                <rect x="21" y="4" width="2" height="16"/>
              </svg>
              <div>
                <div>Scan Barcode</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>
                  {hasBarcodeSupport ? 'Log food or add to fridge' : 'Not supported on this device'}
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Analyzing spinner */}
        {stage === 'analyzing' && (
          <div style={{ textAlign: 'center', padding: '36px 0' }}>
            <div style={{ width: 44, height: 44, border: '3px solid var(--gray4)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spinnerRot 0.65s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>Analysing photo…</div>
            <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 6 }}>AI is identifying food and checking your fridge</div>
          </div>
        )}

        {/* Barcode result */}
        {stage === 'barcode' && barcodeProduct && (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{barcodeProduct.name}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
              <button
                onClick={() => applyBarcodeChoice('log')}
                disabled={barcodeActioning}
                className="btn-primary"
              >
                {barcodeActioning ? <><span className="btn-spinner" /> Saving…</> : `Log ${barcodeProduct.kcal ? `${barcodeProduct.kcal} kcal` : 'to diary'}`}
              </button>
              <button
                onClick={() => applyBarcodeChoice('fridge')}
                disabled={barcodeActioning}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 14, fontSize: 17, fontWeight: 600, padding: '14px 24px', cursor: 'pointer', opacity: barcodeActioning ? 0.6 : 1 }}
              >
                Add to fridge
              </button>
              <button
                onClick={() => applyBarcodeChoice('both')}
                disabled={barcodeActioning}
                style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 14, fontSize: 17, fontWeight: 600, padding: '14px 24px', cursor: 'pointer', opacity: barcodeActioning ? 0.6 : 1 }}
              >
                Log + add to fridge
              </button>
              <button
                onClick={() => { setBarcodeProduct(null); setStage('idle') }}
                style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}
              >
                Scan again
              </button>
            </div>
          </>
        )}

        {/* Food photo result */}
        {stage === 'result' && analysis && (
          <>
            {/* Foods list */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Identified</div>
              <div className="card" style={{ padding: '0 16px' }}>
                {analysis.foods.length === 0 ? (
                  <div style={{ padding: '16px 0', fontSize: 14, color: 'var(--label2)' }}>No food detected — try another angle</div>
                ) : (
                  analysis.foods.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < analysis.foods.length - 1 ? '0.5px solid var(--separator)' : 'none' }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>{f.kcal} kcal</div>
                        <div style={{ fontSize: 12, color: 'var(--label2)' }}>{f.protein_g}g protein</div>
                      </div>
                    </div>
                  ))
                )}
                {analysis.foods.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '0.5px solid var(--separator)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Total</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)' }}>{totalKcal} kcal · {totalProtein}g protein</div>
                  </div>
                )}
              </div>
            </div>

            {/* Fridge cross-ref */}
            {analysis.fridge_matches.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Used from fridge?</div>
                <div style={{ fontSize: 12, color: 'var(--label3)', marginBottom: 8 }}>Tick to remove and log how long it lasted</div>
                <div className="card" style={{ padding: '0 16px' }}>
                  {analysis.fridge_matches.map((m, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: i < analysis.fridge_matches.length - 1 ? '0.5px solid var(--separator)' : 'none', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checkedMatches.has(m.name)}
                        onChange={e => {
                          const next = new Set(checkedMatches)
                          if (e.target.checked) next.add(m.name)
                          else next.delete(m.name)
                          setCheckedMatches(next)
                        }}
                        style={{ width: 20, height: 20, accentColor: 'var(--blue)', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--label3)' }}>
                          {m.zone}{m.added ? ` · added ${m.added}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={confirmLog}
              disabled={saving || analysis.foods.length === 0}
              className="btn-primary"
              style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: analysis.foods.length === 0 ? 0.45 : 1 }}
            >
              {saving ? <><span className="btn-spinner" /> Saving…</> : `Log ${totalKcal} kcal`}
            </button>
            <button
              onClick={() => { setStage('idle'); setAnalysis(null) }}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 16, fontWeight: 500, cursor: 'pointer', padding: '10px 0' }}
            >
              Retake photo
            </button>
          </>
        )}
      </div>
    </div>
  )
}
