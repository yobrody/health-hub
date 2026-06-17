import { useRef, useState } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import { useSwipeDown } from '../hooks/useSwipeDown'
import type { FridgeData, FoodAnalysisV2, BarcodeLookupResult } from '../api/client'

type Stage = 'idle' | 'mode-pick' | 'analyzing' | 'result' | 'barcode'

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
  // 1) Native BarcodeDetector — Chrome on Android + desktop. Much faster than
  // the JS decoder when available.
  if ('BarcodeDetector' in window) {
    try {
      const BD = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (b: ImageBitmap) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
      const bitmap = await createImageBitmap(file)
      const barcodes = await detector.detect(bitmap)
      bitmap.close()
      if (barcodes.length) return barcodes[0].rawValue
      // No barcode found in image — don't fall through, just return null.
      // (Falling through would double the latency on a clean miss.)
      return null
    } catch {
      // Native detector errored unexpectedly — fall through to JS fallback.
    }
  }
  // 2) JS fallback for iOS Safari + Firefox + older browsers. Code-split via
  // dynamic import so the ~80KB decoder doesn't bloat first paint for users
  // who never scan a barcode.
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    const url = URL.createObjectURL(file)
    try {
      const result = await reader.decodeFromImageUrl(url)
      return result.getText()
    } finally {
      URL.revokeObjectURL(url)
    }
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

type CameraMode = 'home' | 'out'

const LS_CAMERA_MODE_KEY = 'camera_mode_default'

function loadCameraMode(): CameraMode {
  try {
    const raw = localStorage.getItem(LS_CAMERA_MODE_KEY)
    if (raw === 'home' || raw === 'out') return raw
  } catch { /* ignore access errors */ }
  return 'home'
}

// Geolocation → reverse-geocode the nearest restaurant for "out" mode logs.
// Tries the device GPS, then asks OpenStreetMap Nominatim for the closest place.
// Returns null on any failure — the call site treats null as "no restaurant
// info" and just logs without it.
async function captureRestaurantContext(): Promise<{ name?: string; address?: string } | null> {
  try {
    if (!navigator.geolocation) return null
    const pos = await new Promise<GeolocationPosition | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 4000)
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(t); resolve(p) },
        () => { clearTimeout(t); resolve(null) },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
      )
    })
    if (!pos) return null
    const { latitude: lat, longitude: lon } = pos.coords
    // Nominatim's free reverse endpoint. No key needed; we identify via referer.
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json() as {
      name?: string
      display_name?: string
      address?: { restaurant?: string; cafe?: string; fast_food?: string; pub?: string; bar?: string; road?: string; suburb?: string; city?: string; postcode?: string }
    }
    const name = data.name
      || data.address?.restaurant
      || data.address?.cafe
      || data.address?.fast_food
      || data.address?.pub
      || data.address?.bar
    const addr = [data.address?.road, data.address?.suburb, data.address?.city].filter(Boolean).join(', ') || undefined
    if (!name && !addr) return null
    return { name, address: addr }
  } catch {
    return null
  }
}

// Refuse to log foods identified from a black/empty/very-low-info photo. We
// can't access raw pixels here cheaply, but we can guard against the obvious
// hallucination signal: model returned foods + low confidence + tiny grams,
// or returned foods + 0 kcal across the board. Real photos almost never hit
// this combination.
function looksLikeHallucination(analysis: FoodAnalysisV2): boolean {
  if (!analysis.foods.length) return false
  const totalKcal = analysis.foods.reduce((a, f) => a + (f.kcal || 0), 0)
  const totalGrams = analysis.foods.reduce((a, f) => a + (f.grams || 0), 0)
  if (totalKcal === 0) return true
  if (analysis.confidence === 'low' && totalGrams < 30) return true
  return false
}

export default function CameraSheet({ open, onClose, fridgeData, onFridgeUpdated }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const sheetSwipe = useSwipeDown(handleClose) // swipe-down-to-dismiss (handleClose is hoisted)
  const [mode, setMode] = useState<CameraMode>(loadCameraMode)
  const [analysis, setAnalysis] = useState<FoodAnalysisV2 | null>(null)
  const [checkedMatches, setCheckedMatches] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [restaurantContext, setRestaurantContext] = useState<{ name?: string; address?: string } | null>(null)
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeLookupResult | null>(null)
  const [barcodeActioning, setBarcodeActioning] = useState(false)
  // Free-text note the user can add on the analysis preview screen — gets
  // appended to the food log description so context like "double portion",
  // "no rice", "tasted off so I only ate half" survives in the diary.
  // Cleared on every reset() / new analysis so it doesn't bleed across logs.
  const [note, setNote] = useState('')
  const foodInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  function chooseMode(next: CameraMode) {
    setMode(next)
    try { localStorage.setItem(LS_CAMERA_MODE_KEY, next) } catch { /* ignore quota errors */ }
    // For Out mode we kick off restaurant detection now (background) so the
    // result page already has it when the photo comes back. Home doesn't need it.
    if (next === 'out') {
      captureRestaurantContext().then(setRestaurantContext).catch(() => {})
    } else {
      setRestaurantContext(null)
    }
    // Trigger camera immediately after mode pick — one tap closer to logging.
    setTimeout(() => foodInputRef.current?.click(), 60)
  }

  function reset() {
    setStage('idle')
    setAnalysis(null)
    setCheckedMatches(new Set())
    setSaving(false)
    setRestaurantContext(null)
    setBarcodeProduct(null)
    setBarcodeActioning(false)
    setNote('')
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
        api.analyzeFoodV2(file, fridgeData, '', mode),
        compressThumbnail(file),
      ])
      // Refuse to silently log a hallucinated meal from a blank/black photo.
      // The user said: "took a photo of a black screen and it identified the
      // food as chicken katsu curry". This is the guard.
      if (looksLikeHallucination(result)) {
        showToast("Couldn't identify food — try a clearer photo", 'err')
        setStage('idle')
        return
      }
      if (result.foods.length === 0) {
        showToast('No food detected — try another angle', 'info')
        setStage('idle')
        return
      }
      setAnalysis(result)
      // Default-check all matches the AI returned (out mode returns none anyway).
      setCheckedMatches(new Set(result.fridge_matches.map(m => m.name)))
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
          api.addFridgeItem(item.name, item.section, {
            size: item.size,
            cost: item.cost,
            // Forward parsed unit fields so /fridge/item seeds quantity_g
            // and the photo-log Home flow can decrement against it later.
            unit_size_g: item.unit_size_g ?? null,
            unit_count: item.unit_count ?? null,
          })
        ))
        onFridgeUpdated()
        showToast(`Added ${result.items.length} items from receipt`)
        // Fire-and-forget photo lookup for each new item. Resolved URLs are
        // written into KV server-side, so the next /fridge GET picks them up.
        // Cached results are instant; misses are bounded by OFF's 6s budget.
        void Promise.all(result.items.map(item =>
          api.lookupPhoto(item.name)
            .then(r => r.photo_url ? api.addFridgeItem(item.name, item.section, { photo_url: r.photo_url }) : null)
            .catch(() => {})
        )).then(() => onFridgeUpdated())
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
        // Pass the OFF photo through so the item gets a real product image
        // immediately on the next /fridge GET — no follow-up lookup needed.
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
      const foodLine = analysis.foods.map(f => f.name).join(', ')
      // Out-mode logs include the restaurant if we got it. Pattern is:
      //   "Chicken katsu curry, miso soup @ Wagamama"
      // so it surfaces naturally in the today log + history.
      const baseDescription = mode === 'out' && restaurantContext?.name
        ? `${foodLine} @ ${restaurantContext.name}`
        : foodLine
      // Append the user's free-text note in parens so the diary keeps the
      // context next to the AI's identification ("Pasta (double portion, no
      // cheese)" rather than two separate fields).
      const trimmedNote = note.trim().slice(0, 200)
      const description = trimmedNote ? `${baseDescription} (${trimmedNote})` : baseDescription
      const h = new Date().getHours()
      const meal = h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner'

      await api.addFood({ meal, description, kcal: totalKcal, protein_g: totalProtein })
      // Tell Today (and any other listener) to refresh totals — without this
      // the calorie ring stays stale until the next page-load even though
      // the row's been written. Bug surfaced 2026-05-07: photo logs went
      // through but Today never re-fetched.
      window.dispatchEvent(new CustomEvent('food-logged'))

      // Out mode never touches fridge inventory — the meal wasn't sourced from there.
      let matchedCount = 0
      if (mode === 'home') {
        const matched = analysis.fridge_matches.filter(m => checkedMatches.has(m.name))
        if (matched.length) {
          matchedCount = matched.length
          // Log shelf-life usage for every match (informs learned shelf-life model),
          // and decrement quantity. Items whose quantity_g hits 0 stay in the fridge
          // as "empty" markers — explicit removal is a separate UI action.
          await Promise.all([
            ...matched.map(m =>
              api
                .logFridgeUsage({ item_name: m.name, zone: m.zone || 'fridge', date_added: m.added ?? null })
                .catch(() => {})
            ),
            ...matched.map(m => {
              const grams = typeof m.grams_used === 'number' && m.grams_used > 0 ? m.grams_used : null
              if (grams !== null) {
                return api.consumeFridgeItem(m.name, { grams }).catch(() => {})
              }
              // No per-item grams from the model → fall back to legacy "remove on use"
              // behaviour so the UI keeps moving when the AI under-specifies.
              return api.removeFridgeItem(m.name).catch(() => {})
            }),
          ])
          onFridgeUpdated()
        }
      }

      const fridgeNote = mode === 'home' && matchedCount
        ? ` · used ${matchedCount} from fridge`
        : mode === 'out'
          ? restaurantContext?.name ? ` · ${restaurantContext.name}` : ' · eating out'
          : ''
      showToast(`Logged ${totalKcal} kcal${fridgeNote}`)
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
            {stage === 'result' ? 'Food identified' : stage === 'barcode' ? 'Product found' : 'Camera'}
          </div>
          <button className="sheet-close" onClick={handleClose}>×</button>
        </div>

        {/* Hidden file inputs */}
        <input ref={foodInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFoodPhoto} />
        <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleReceiptPhoto} />
        <input ref={barcodeInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBarcodePhoto} />

        {/* Idle — three actions. Home/Out lives only inside Log Food now,
            because that's the only flow it actually changes (receipt + barcode
            don't decrement fridge inventory based on it). */}
        {stage === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => setStage('mode-pick')}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', fontSize: 17, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <path d="M3 2l1.5 7H19.5L21 2"/><path d="M4.5 9l1 11h13l1-11"/>
              </svg>
              <div>
                <div>Log Food</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.82, marginTop: 2 }}>Take a photo, AI estimates kcal + macros</div>
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
              style={{
                background: 'var(--purple)',
                color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px',
                fontSize: 17, fontWeight: 700, cursor: 'pointer',
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14,
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
                  Add a packaged item to the fridge
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Mode pick — only inside the Log Food flow. Tapping a tile chooses
            the mode, kicks off restaurant geolocation if Out, and immediately
            opens the camera. The whole step takes one tap. */}
        {stage === 'mode-pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 2 }}>
              Where are you eating?
            </div>
            <button
              onClick={() => chooseMode('home')}
              style={{ background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 16, padding: '16px 18px', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label)' }}>At home</div>
              <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 3 }}>
                AI checks your fridge → depletes matching items as you eat them.
              </div>
            </button>
            <button
              onClick={() => chooseMode('out')}
              style={{ background: 'var(--card)', border: '1px solid var(--separator)', borderRadius: 16, padding: '16px 18px', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label)' }}>Eating out</div>
              <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 3 }}>
                Just logs calories. We'll tag the restaurant from your location.
              </div>
            </button>
            <button
              onClick={() => setStage('idle')}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--label2)', fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '6px 0' }}
            >
              Cancel
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
            {/* Mode + restaurant chip — quick context recap, also makes it clear
                where the AI thinks you are. Tap the restaurant name to clear it
                if Nominatim guessed a neighbouring building. */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ background: 'var(--gray6)', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--label2)' }}>
                {mode === 'home' ? 'At home' : 'Eating out'}
              </span>
              {mode === 'out' && restaurantContext?.name && (
                <button
                  onClick={() => setRestaurantContext(null)}
                  style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--blue)', border: 'none', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  title="Tap to clear if this is wrong"
                >
                  {restaurantContext.name} ×
                </button>
              )}
              {mode === 'out' && !restaurantContext?.name && (
                <span style={{ color: 'var(--label3)', fontSize: 12 }}>
                  No location — log untagged
                </span>
              )}
            </div>

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

            {/* Free-text note — for things the photo can't capture: portion
                size, "skipped the rice", "shared with someone", how it tasted.
                Appended to the diary description in parens; doesn't auto-
                adjust the kcal estimate (intentional — the photo is the
                authoritative input, the note just preserves context). */}
            {analysis.foods.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Add details (optional)
                </div>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 200))}
                  placeholder="e.g. double portion, no rice, shared with Lucy"
                  rows={2}
                  maxLength={200}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'var(--bg2)',
                    border: '0.5px solid var(--separator)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    color: 'var(--label)',
                    resize: 'none',
                    outline: 'none',
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--label3)', marginTop: 4, textAlign: 'right' }}>
                  {note.length}/200
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
