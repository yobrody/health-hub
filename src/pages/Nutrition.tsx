import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FoodEntry, TodayData, HistoryDay, FoodAnalysis, BarcodeLookupResult } from '../api/client'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']

// ── Barcode scanning (Chrome Android / desktop only) ─────────────────────────
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
  } catch (e) {
    console.error('Barcode scan failed:', e)
    return null
  }
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ confidence }: { confidence: FoodAnalysis['confidence'] }) {
  const map = { high: { label: 'High confidence', color: 'var(--green)', bg: '#34C75920' }, medium: { label: 'Check calories', color: 'var(--orange)', bg: '#FF950020' }, low: { label: 'Low confidence \u2014 verify!', color: 'var(--red)', bg: '#FF3B3020' } }
  const c = map[confidence]
  return <span style={{ fontSize: 11, fontWeight: 600, color: c.color, background: c.bg, borderRadius: 8, padding: '2px 8px' }}>{c.label}</span>
}

export default function Nutrition() {
  const [data, setData] = useState<TodayData | null>(null)
  const [history, setHistory] = useState<HistoryDay[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [kcal, setKcal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Barcode
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeLookupResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Food photo AI
  const [analyzing, setAnalyzing] = useState(false)
  const [photoAnalysis, setPhotoAnalysis] = useState<FoodAnalysis | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<FoodEntry | null>(null)

  const hour = new Date().getHours()
  const defaultMeal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'

  useEffect(() => {
    setMeal(defaultMeal)
    api.getToday().then(setData).catch(console.error)
    api.getFoodHistory(7).then(setHistory).catch(console.error)
  }, [])

  function resetSheet() {
    setShowAdd(false)
    setScanMsg(null)
    setPhotoAnalysis(null)
    setBarcodeProduct(null)
  }

  function inferSection(name: string): 'fridge' | 'freezer' | 'pantry' | 'condiments' {
    const n = name.toLowerCase()
    if (['sauce', 'ketchup', 'mustard', 'mayo', 'vinegar', 'oil'].some(k => n.includes(k))) return 'condiments'
    if (['frozen', 'ice cream'].some(k => n.includes(k))) return 'freezer'
    if (['rice', 'pasta', 'oat', 'cereal', 'bread', 'nuts', 'flour'].some(k => n.includes(k))) return 'pantry'
    return 'fridge'
  }

  async function applyBarcodeChoice(choice: 'log' | 'fridge' | 'both') {
    if (!barcodeProduct?.name) return
    try {
      if (choice === 'fridge' || choice === 'both') {
        await api.addFridgeItem(barcodeProduct.name, inferSection(barcodeProduct.name))
      }
      if (choice === 'log' || choice === 'both') {
        setDesc(barcodeProduct.name)
        if (barcodeProduct.kcal != null) setKcal(String(barcodeProduct.kcal))
      }
      setScanMsg(
        choice === 'both'
          ? `Added to fridge and ready to log: ${barcodeProduct.name}`
          : choice === 'fridge'
            ? `Added to fridge: ${barcodeProduct.name}`
            : `Ready to log: ${barcodeProduct.name}`,
      )
    } catch {
      setScanMsg('Could not apply selection - try again')
    } finally {
      setBarcodeProduct(null)
      setTimeout(() => setScanMsg(null), 4500)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!desc || !kcal) return
    setSubmitting(true)
    try {
      await api.addFood({ meal, description: desc, kcal: parseInt(kcal) })
      const updated = await api.getToday()
      setData(updated)
      setDesc(''); setKcal('')
      resetSheet()
      if (navigator.vibrate) navigator.vibrate(10)
    } catch (err) {
      console.error('Add food failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBarcodeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    setScanMsg('Scanning barcode\u2026')
    setPhotoAnalysis(null)
    try {
      const barcode = await detectBarcode(file)
      if (!barcode) {
        setScanMsg('Barcode not recognised \u2014 try a clearer photo')
        return
      }
      const result: BarcodeLookupResult | null = await api.lookupBarcode(barcode)
      if (result) {
        setBarcodeProduct(result)
        setScanMsg(result.kcal ? `Found: ${result.name} (~${result.kcal} kcal)` : `Found: ${result.name}`)
      } else {
        setScanMsg('No nutrition data found \u2014 enter calories manually')
      }
    } catch {
      setScanMsg('Scan failed \u2014 enter manually')
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setScanMsg(null), 5000)
    }
  }

  async function handlePhotoAnalysis(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAnalyzing(true)
    setScanMsg(null)
    setPhotoAnalysis(null)
    try {
      const result = await api.analyzeFood(file, desc)
      setPhotoAnalysis(result)
      if (result.name) setDesc(result.name)
      if (result.kcal > 0) setKcal(String(result.kcal))
    } catch (err) {
      setScanMsg('AI analysis failed \u2014 enter details manually')
      setTimeout(() => setScanMsg(null), 4000)
    } finally {
      setAnalyzing(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const hasBarcodeSupport = typeof window !== 'undefined' && 'BarcodeDetector' in window
  const total = data?.total_kcal ?? 0
  const goal = data?.goals.calories ?? 2200
  const pct = Math.min(total / goal, 1)
  const remaining = Math.max(goal - total, 0)
  const byMeal = (data?.entries ?? []).reduce((acc: Record<string, FoodEntry[]>, e) => {
    acc[e.meal] = [...(acc[e.meal] ?? []), e]
    return acc
  }, {})
  const mealSplit: Record<string, number> = { Breakfast: 0.25, Lunch: 0.3, Dinner: 0.3, Snack: 0.15 }
  const mealTargetKcal = Math.round(goal * (mealSplit[meal] ?? 0.25))
  const proteinGoal = data?.goals.protein ?? 140
  const mealTargetProtein = Math.round(proteinGoal * (mealSplit[meal] ?? 0.25))

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <div className="page-content">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Nutrition</div>
          <button className="action-pill" onClick={() => { setShowAdd(true); setScanMsg(null); setPhotoAnalysis(null) }}
            style={{ background: 'var(--blue)', color: '#fff' }}>
            + Add
          </button>
        </div>

        {/* Daily summary bar */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{total.toLocaleString()}</span>
              <span style={{ fontSize: 14, color: 'var(--label2)', marginLeft: 4 }}>kcal today</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, color: 'var(--label2)' }}>
                {remaining > 0 ? `${remaining.toLocaleString()} remaining` : '\u2713 Goal reached!'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--label3)' }}>of {goal.toLocaleString()} goal</div>
            </div>
          </div>
          <div style={{ height: 8, background: 'var(--gray5)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, background: pct > 1 ? 'var(--red)' : pct > 0.85 ? 'var(--orange)' : 'var(--blue)', width: `${pct * 100}%`, transition: 'width 0.6s ease, background 0.3s' }} />
          </div>
        </div>

        {/* Meal groups */}
        {Object.keys(byMeal).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--label2)', fontSize: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🍽️</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing logged yet</div>
            <div style={{ fontSize: 14 }}>Tap + Add to start tracking</div>
          </div>
        ) : (
          MEALS.filter(m => byMeal[m]?.length).map(mealName => (
            <div key={mealName} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="section-label" style={{ marginTop: 0 }}>{mealName}</div>
                <div style={{ fontSize: 13, color: 'var(--label2)', fontWeight: 600 }}>
                  ~{byMeal[mealName].reduce((a, e) => a + e.kcal, 0).toLocaleString()} kcal
                </div>
              </div>
              <div className="card">
                {byMeal[mealName].map((e, i) => (
                  <div key={i} className="list-row" style={{ gap: 10 }}>
                    <div style={{ width: 36, fontSize: 12, color: 'var(--label3)', fontWeight: 500, flexShrink: 0 }}>{e.time}</div>
                    <div style={{ flex: 1, fontSize: 15, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label2)', flexShrink: 0 }}>~{e.kcal}</div>
                    <button onClick={() => setDeleteConfirm(e)}
                      style={{ background: 'none', border: 'none', color: 'var(--label3)', cursor: 'pointer', padding: '4px 6px', fontSize: 16, borderRadius: 8, flexShrink: 0 }}
                      title="Delete entry">×</button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {/* 7-day history */}
        {history.length > 0 && (
          <>
            <div className="section-label">Last 7 days</div>
            <div className="card">
              {history.slice(1).map((d, i) => {
                const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
                return (
                  <div key={i} className="list-row">
                    <div style={{ width: 70, fontSize: 14, color: 'var(--label2)' }}>{dayLabel}</div>
                    <div style={{ flex: 1, height: 6, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
                      {d.logged && <div style={{ height: '100%', borderRadius: 3, background: d.total_kcal > goal ? 'var(--red)' : 'var(--blue)', width: `${Math.min(d.total_kcal / goal * 100, 100)}%` }} />}
                    </div>
                    <div style={{ width: 72, textAlign: 'right', fontSize: 14, fontWeight: 500, flexShrink: 0 }}>
                      {d.logged ? d.total_kcal.toLocaleString() : <span style={{ color: 'var(--label3)' }}>—</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Add food sheet ────────────────────────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) resetSheet() }}>
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '8px 20px 40px', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '8px auto 16px' }} />

            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Log Food</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Barcode (Chrome/Android only) */}
                {hasBarcodeSupport && (
                <button className="tap-lift" onClick={() => fileInputRef.current?.click()} disabled={scanning || analyzing}
                    style={{ background: 'var(--gray6)', border: 'none', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: 'var(--label)', cursor: 'pointer', opacity: (scanning || analyzing) ? 0.5 : 1 }}>
                    {scanning ? '⏳' : '📷 Barcode'}
                  </button>
                )}
                {/* Food photo AI */}
                <button className="tap-lift" onClick={() => photoInputRef.current?.click()} disabled={scanning || analyzing}
                  style={{ background: analyzing ? 'var(--gray5)' : 'var(--blue)', border: 'none', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: analyzing ? 'var(--label2)' : '#fff', cursor: 'pointer', opacity: (scanning || analyzing) ? 0.7 : 1 }}>
                  {analyzing ? '⏳ Analyzing…' : '🍽️ Snap Food'}
                </button>
              </div>
            </div>

            {/* Hidden inputs */}
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBarcodeFile} />
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhotoAnalysis} />

            {/* Scan message */}
            {scanMsg && (
              <div style={{ background: 'var(--gray6)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--label2)', lineHeight: 1.4 }}>
                {scanMsg}
              </div>
            )}

            {/* AI photo analysis result */}
            {photoAnalysis && (
              <div style={{ background: 'var(--blue-light)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, border: '1px solid rgba(0,122,255,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)' }}>🤖 AI identified: {photoAnalysis.name}</div>
                  <ConfidenceBadge confidence={photoAnalysis.confidence} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 4 }}>{photoAnalysis.description}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--label2)' }}>
                  <span>🔥 <strong style={{ color: 'var(--label)' }}>{photoAnalysis.kcal}</strong> kcal</span>
                  <span>💪 <strong style={{ color: 'var(--label)' }}>{photoAnalysis.protein_g}g</strong> protein</span>
                  <span>🌾 <strong style={{ color: 'var(--label)' }}>{photoAnalysis.carbs_g}g</strong> carbs</span>
                  <span>🥑 <strong style={{ color: 'var(--label)' }}>{photoAnalysis.fat_g}g</strong> fat</span>
                </div>
              </div>
            )}

            <form onSubmit={submit}>
              {/* Meal picker */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {MEALS.map(m => (
                  <button key={m} type="button" onClick={() => setMeal(m)}
                    style={{ flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none', background: meal === m ? 'var(--blue)' : 'var(--gray5)', color: meal === m ? '#fff' : 'var(--label)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {m}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: -6, marginBottom: 10, fontSize: 12, color: 'var(--label2)' }}>
                Target for {meal.toLowerCase()}: ~{mealTargetKcal} kcal · ~{mealTargetProtein}g protein
              </div>

              <input className="input-field" style={{ marginBottom: 10 }}
                placeholder="What did you eat? e.g. Chicken and rice"
                value={desc} onChange={e => setDesc(e.target.value)} autoFocus={!scanning && !analyzing} />
              <input className="input-field" style={{ marginBottom: 20 }}
                placeholder="Calories (e.g. 650)" type="number" inputMode="numeric"
                value={kcal} onChange={e => setKcal(e.target.value)} />

              <button type="submit" className="btn-primary" disabled={submitting || !desc || !kcal}
                style={{ opacity: (!desc || !kcal) ? 0.5 : 1 }}>
                {submitting ? 'Saving…' : 'Add to Log'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation sheet ─────────────────────────────────────────── */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null) }}>
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Remove this entry?</div>
            <div style={{ fontSize: 15, color: 'var(--label2)', marginBottom: 6 }}>
              {deleteConfirm.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--label3)', marginBottom: 24 }}>
              {deleteConfirm.meal} · {deleteConfirm.time} · ~{deleteConfirm.kcal} kcal
            </div>
            <button className="btn-destructive" style={{ width: '100%', marginBottom: 12 }}
              onClick={async () => {
                await api.deleteFood(deleteConfirm.time, deleteConfirm.meal)
                const updated = await api.getToday()
                setData(updated)
                setDeleteConfirm(null)
                if (navigator.vibrate) navigator.vibrate(20)
              }}>Delete</button>
            <button onClick={() => setDeleteConfirm(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--blue)', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

      {barcodeProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 350, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setBarcodeProduct(null) }}>
          <div style={{ background: 'var(--card)', borderRadius: '20px 20px 0 0', width: '100%', padding: '18px 20px 36px', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '0 auto 14px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Barcode found</div>
            <div style={{ fontSize: 14, color: 'var(--label2)', marginBottom: 14 }}>
              {barcodeProduct.name}{barcodeProduct.kcal ? ` • ~${barcodeProduct.kcal} kcal` : ''}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="btn-primary" onClick={() => applyBarcodeChoice('log')}>Log in nutrition</button>
              <button onClick={() => applyBarcodeChoice('fridge')} style={{ border: '1px solid var(--separator)', borderRadius: 14, padding: '13px', background: 'var(--card)', color: 'var(--label)', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Add to fridge</button>
              <button onClick={() => applyBarcodeChoice('both')} style={{ border: 'none', borderRadius: 14, padding: '13px', background: 'var(--green)', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Do both</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
