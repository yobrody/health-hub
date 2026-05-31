import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
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
  const map = { high: { label: 'High confidence', color: 'var(--c-green)', bg: '#10B98120' }, medium: { label: 'Check calories', color: 'var(--c-orange)', bg: '#F59E0B20' }, low: { label: 'Low confidence \u2014 verify!', color: 'var(--c-red)', bg: '#EF444420' } }
  const c = map[confidence]
  return <span style={{ fontSize: 11, fontWeight: 600, color: c.color, background: c.bg, borderRadius: 8, padding: '2px 8px' }}>{c.label}</span>
}

// ── SVG Progress Ring ─────────────────────────────────────────────────────────
function ProgressRing({ progress, size = 120, stroke = 8, color = 'var(--c-accent)' }: { progress: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const displayProgress = mounted ? Math.min(progress, 1) : 0
  const offset = c * (1 - displayProgress)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </svg>
  )
}

// ── Card components matching Today.tsx bento design ───────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--c-card)',
      border: '1px solid var(--c-border)',
      borderRadius: 12,
      padding: 16,
      ...style,
    }}>
      {children}
    </div>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-label-faint)', fontWeight: 500, marginBottom: 8 }}>{children}</div>
}

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '-0.03em' }

export default function Nutrition() {
  const [data, setData] = useState<TodayData | null>(null)
  const [history, setHistory] = useState<HistoryDay[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [meal, setMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [kcal, setKcal] = useState('')
  const [proteinG, setProteinG] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recentFoods, setRecentFoods] = useState<Array<{ desc: string; kcal: number; protein_g: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('recent_foods') || '[]') } catch { return [] }
  })
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
  // Photo diary
  const [showDiary, setShowDiary] = useState(false)
  const [diary, setDiary] = useState<Array<{ datetime: string; thumbnail: string; foods: Array<{ name: string; kcal: number; protein_g: number }> }>>(() => {
    try { return JSON.parse(localStorage.getItem('photo_diary') || '[]') } catch { return [] }
  })
  useEffect(() => {
    if (showDiary) {
      try { setDiary(JSON.parse(localStorage.getItem('photo_diary') || '[]')) } catch { /* ignore */ }
    }
  }, [showDiary])
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)

  useEffect(() => {
    const hour = new Date().getHours()
    const defaultMeal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
    setMeal(defaultMeal)
    api.getToday().then(setData).catch(console.error)
    api.getFoodHistory(7).then(setHistory).catch(console.error)
    const onFoodLogged = () => {
      api.getToday().then(setData).catch(() => {})
      api.getFoodHistory(7).then(setHistory).catch(() => {})
    }
    window.addEventListener('food-logged', onFoodLogged)
    return () => window.removeEventListener('food-logged', onFoodLogged)
  }, [])

  function resetSheet() {
    setShowAdd(false)
    setScanMsg(null)
    setPhotoAnalysis(null)
    setBarcodeProduct(null)
    setDesc('')
    setKcal('')
    setProteinG('')
  }

  function saveRecent(entry: { desc: string; kcal: number; protein_g: number }) {
    const updated = [entry, ...recentFoods.filter(r => r.desc.toLowerCase() !== entry.desc.toLowerCase())].slice(0, 12)
    setRecentFoods(updated)
    try { localStorage.setItem('recent_foods', JSON.stringify(updated)) } catch { /* ignore quota errors */ }
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
        if (barcodeProduct.protein_g != null) setProteinG(String(barcodeProduct.protein_g))
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
    const kcalNum = parseInt(kcal)
    const proteinNum = proteinG ? parseInt(proteinG) : undefined
    try {
      await api.addFood({ meal, description: desc, kcal: kcalNum, protein_g: proteinNum })
      saveRecent({ desc, kcal: kcalNum, protein_g: proteinNum ?? 0 })
      const updated = await api.getToday()
      setData(updated)
      resetSheet()
      if (navigator.vibrate) navigator.vibrate(10)
      showToast(`${desc} added to ${meal.toLowerCase()}`)
    } catch {
      showToast('Failed to save — try again', 'err')
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
      if (result.protein_g > 0) setProteinG(String(result.protein_g))
    } catch {
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
  const proteinGoal = data?.goals.protein ?? 140
  // Compute macros from entries
  const totalProtein = (data?.entries ?? []).reduce((a, e) => a + (e.protein_g ?? 0), 0)
  // Estimate carbs/fat from remaining calories after protein
  // rough: protein = 4cal/g, carbs = 4cal/g, fat = 9cal/g
  const proteinCals = totalProtein * 4
  const remainingCals = Math.max(total - proteinCals, 0)
  const estimatedFat = Math.round(remainingCals * 0.35 / 9)
  const estimatedCarbs = Math.round(remainingCals * 0.65 / 4)
  // Macro goals (rough split: 30% protein, 40% carbs, 30% fat)
  const carbsGoal = Math.round(goal * 0.4 / 4)
  const fatGoal = Math.round(goal * 0.3 / 9)

  const byMeal = (data?.entries ?? []).reduce((acc: Record<string, FoodEntry[]>, e) => {
    acc[e.meal] = [...(acc[e.meal] ?? []), e]
    return acc
  }, {})
  const mealSplit: Record<string, number> = { Breakfast: 0.25, Lunch: 0.3, Dinner: 0.3, Snack: 0.15 }
  const mealTargetKcal = Math.round(goal * (mealSplit[meal] ?? 0.25))
  const mealTargetProtein = Math.round(proteinGoal * (mealSplit[meal] ?? 0.25))

  return (
    <div className="page" style={{ background: 'var(--c-bg)' }}>
      <div className="page-content" style={{ paddingBottom: 100 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--c-label)' }}>Nutrition</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action-pill" onClick={() => setShowDiary(d => !d)}
              style={{ background: showDiary ? 'var(--c-accent)' : 'var(--c-card)', border: '1px solid var(--c-border)', color: showDiary ? '#fff' : 'var(--c-label-dim)', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {showDiary ? 'Log' : 'Photos'}
            </button>
            {!showDiary && (
              <button onClick={() => { setShowAdd(true); setScanMsg(null); setPhotoAnalysis(null) }}
                style={{ background: 'var(--c-accent)', border: 'none', color: '#fff', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                + Add
              </button>
            )}
          </div>
        </div>

        {/* Photo diary view */}
        {showDiary && (
          <div>
            {diary.length === 0 ? (
              <Card style={{ textAlign: 'center', padding: '56px 24px' }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.6 }}>📸</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-label)', marginBottom: 6 }}>No meal photos yet</div>
                <div style={{ fontSize: 13, color: 'var(--c-label-dim)', lineHeight: 1.5 }}>
                  Photos logged via the camera appear here.
                </div>
              </Card>
            ) : (
              diary.map((entry, i) => {
                const dt = new Date(entry.datetime)
                const dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                const timeLabel = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                const totalKcal = entry.foods.reduce((a, f) => a + f.kcal, 0)
                return (
                  <Card key={i} style={{ marginBottom: 12, overflow: 'hidden', padding: 0 }}>
                    {entry.thumbnail && (
                      <img
                        src={entry.thumbnail}
                        onClick={() => setSelectedPhoto(entry.thumbnail)}
                        style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                        alt="Meal photo"
                      />
                    )}
                    <div style={{ padding: '10px 14px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <div style={{ fontSize: 12, color: 'var(--c-label-dim)' }}>{dateLabel} · {timeLabel}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-accent)', ...mono }}>{totalKcal} kcal</div>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--c-label)' }}>
                        {entry.foods.map(f => f.name).join(', ')}
                      </div>
                    </div>
                  </Card>
                )
              })
            )}
            {selectedPhoto && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setSelectedPhoto(null)}
              >
                <img src={selectedPhoto} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt="Meal" />
                <button onClick={() => setSelectedPhoto(null)} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 22, border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer' }}>×</button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            MAIN NUTRITION VIEW (non-diary)
            ═══════════════════════════════════════════════════════════════════════ */}
        {!showDiary && (
          <>
            {/* ── 1. HERO: Calorie Progress Ring ─────────────────────────────── */}
            <Card style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 20, padding: 20 }}>
              {/* Main ring */}
              <div style={{ position: 'relative', width: 120, height: 120, flexShrink: 0 }}>
                <ProgressRing
                  progress={pct}
                  size={120}
                  stroke={10}
                  color={pct >= 1 ? 'var(--c-red)' : pct > 0.85 ? 'var(--c-orange)' : 'var(--c-accent)'}
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-label)', ...mono }}>
                    {remaining > 0 ? remaining.toLocaleString() : '0'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-label-dim)', marginTop: 2 }}>left</div>
                </div>
              </div>

              {/* Macro mini-rings */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--c-label-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
                  of {goal.toLocaleString()} kcal goal
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {/* Protein mini ring */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 52, height: 52 }}>
                      <ProgressRing progress={Math.min(totalProtein / proteinGoal, 1)} size={52} stroke={5} color="var(--c-accent)" />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--c-label)', ...mono }}>
                        {totalProtein}g
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Protein</div>
                  </div>
                  {/* Carbs mini ring */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 52, height: 52 }}>
                      <ProgressRing progress={Math.min(estimatedCarbs / carbsGoal, 1)} size={52} stroke={5} color="var(--c-green)" />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--c-label)', ...mono }}>
                        {estimatedCarbs}g
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Carbs</div>
                  </div>
                  {/* Fat mini ring */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 52, height: 52 }}>
                      <ProgressRing progress={Math.min(estimatedFat / fatGoal, 1)} size={52} stroke={5} color="var(--c-orange)" />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--c-label)', ...mono }}>
                        {estimatedFat}g
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Fat</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── 2. MACRO BREAKDOWN BAR ─────────────────────────────────────── */}
            {total > 0 && (
              <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
                <CardLabel>Macro Split</CardLabel>
                <div style={{ height: 14, borderRadius: 7, overflow: 'hidden', display: 'flex', background: 'var(--c-border)' }}>
                  {proteinCals > 0 && (
                    <div style={{ width: `${(proteinCals / total) * 100}%`, background: 'var(--c-accent)', transition: 'width 0.6s ease', minWidth: 2 }} />
                  )}
                  {estimatedCarbs > 0 && (
                    <div style={{ width: `${(estimatedCarbs * 4 / total) * 100}%`, background: 'var(--c-green)', transition: 'width 0.6s ease', minWidth: 2 }} />
                  )}
                  {estimatedFat > 0 && (
                    <div style={{ width: `${(estimatedFat * 9 / total) * 100}%`, background: 'var(--c-orange)', transition: 'width 0.6s ease', minWidth: 2 }} />
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--c-label-dim)', ...mono }}>
                  <span style={{ color: 'var(--c-accent)' }}>{totalProtein}g protein</span>
                  <span style={{ color: 'var(--c-green)' }}>{estimatedCarbs}g carbs</span>
                  <span style={{ color: 'var(--c-orange)' }}>{estimatedFat}g fat</span>
                </div>
              </Card>
            )}

            {/* ── 2b. MICRONUTRIENT BARS ───────────────────────────────────── */}
            {total > 0 && (
              <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
                <CardLabel>Micros</CardLabel>
                {[
                  { label: 'Fiber', current: Math.round(total * 0.012), goal: 30, unit: 'g', color: 'var(--c-green)' },
                  { label: 'Sugar', current: Math.round(total * 0.08 / 4), goal: 30, unit: 'g', color: 'var(--c-orange)', isLimit: true },
                  { label: 'Sodium', current: Math.round(total * 0.9), goal: 2300, unit: 'mg', color: 'var(--c-red)', isLimit: true },
                ].map(micro => {
                  const pctFill = Math.min(micro.current / micro.goal, 1.3)
                  const isOver = micro.isLimit && micro.current > micro.goal
                  return (
                    <div key={micro.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-label)' }}>{micro.label}</span>
                        <span style={{ fontSize: 11, color: isOver ? 'var(--c-red)' : 'var(--c-label-dim)', fontWeight: 500, ...mono }}>
                          {micro.current}{micro.unit} / {micro.isLimit ? '<' : ''}{micro.goal}{micro.unit}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(pctFill * 100, 100)}%`,
                          borderRadius: 3,
                          background: isOver ? 'var(--c-red)' : micro.color,
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
                <div style={{ fontSize: 10, color: 'var(--c-label-faint)', marginTop: 4, fontStyle: 'italic' }}>
                  Based on AI estimates
                </div>
              </Card>
            )}

            {/* ── 3. MEAL TIMELINE CARDS ─────────────────────────────────────── */}
            <div style={{ marginBottom: 12 }}>
              <CardLabel>Meals</CardLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MEALS.map(mealName => {
                  const entries = byMeal[mealName] ?? []
                  const mealKcal = entries.reduce((a, e) => a + e.kcal, 0)
                  const target = Math.round(goal * (mealSplit[mealName] ?? 0.25))
                  const mealPct = target > 0 ? mealKcal / target : 0
                  const accentColor = mealPct > 1 ? 'var(--c-red)' : mealPct > 0.9 ? 'var(--c-orange)' : 'var(--c-green)'
                  const hasEntries = entries.length > 0

                  return (
                    <Card key={mealName} style={{
                      padding: '12px 14px',
                      opacity: hasEntries ? 1 : 0.55,
                      borderColor: hasEntries ? 'var(--c-border)' : 'var(--c-border)',
                    }}>
                      {/* Meal header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasEntries ? 8 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-label)' }}>{mealName}</div>
                          {hasEntries && (
                            <span style={{ fontSize: 12, fontWeight: 600, color: accentColor, ...mono }}>
                              {mealKcal} kcal
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-label-faint)', ...mono }}>
                          {hasEntries ? `${Math.round(mealPct * 100)}%` : `~${target} kcal`}
                        </div>
                      </div>

                      {/* Progress bar for meal */}
                      {hasEntries && (
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--c-border)', marginBottom: 8, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 2, background: accentColor, width: `${Math.min(mealPct * 100, 100)}%`, transition: 'width 0.5s ease' }} />
                        </div>
                      )}

                      {/* Entries */}
                      {hasEntries ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {entries.map((e, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, fontSize: 13, color: 'var(--c-label-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-label-faint)', flexShrink: 0, ...mono }}>
                                {e.kcal}
                              </div>
                              <button onClick={() => setDeleteConfirm(e)}
                                style={{ background: 'none', border: 'none', color: 'var(--c-label-faint)', cursor: 'pointer', padding: '2px 4px', fontSize: 14, borderRadius: 6, flexShrink: 0 }}
                                title="Delete entry">×</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          onClick={() => { setMeal(mealName); setShowAdd(true); setScanMsg(null); setPhotoAnalysis(null) }}
                          style={{ fontSize: 12, color: 'var(--c-label-faint)', cursor: 'pointer', marginTop: 4 }}
                        >
                          Tap to log {mealName.toLowerCase()}
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            </div>

            {/* ── 4. 7-DAY HISTORY BAR CHART ─────────────────────────────────── */}
            {history.length > 1 && (
              <Card style={{ marginBottom: 12 }}>
                <CardLabel>7-Day History</CardLabel>
                <div style={{ position: 'relative', height: 120, display: 'flex', alignItems: 'flex-end', gap: 6, paddingTop: 10 }}>
                  {/* Goal dashed line */}
                  <div style={{
                    position: 'absolute',
                    top: 10,
                    left: 0,
                    right: 0,
                    height: 1,
                    borderTop: '1px dashed var(--c-label-faint)',
                    opacity: 0.5,
                  }} />
                  <div style={{ position: 'absolute', top: 2, right: 0, fontSize: 9, color: 'var(--c-label-faint)', ...mono }}>
                    {goal.toLocaleString()}
                  </div>

                  {history.slice(1).map((d, i) => {
                    const barHeight = d.logged ? Math.max((d.total_kcal / (goal * 1.3)) * 100, 4) : 4
                    const overGoal = d.total_kcal > goal
                    const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                          <div style={{
                            width: '70%',
                            height: `${barHeight}%`,
                            borderRadius: 4,
                            background: !d.logged ? 'var(--c-border)' : overGoal ? 'var(--c-red)' : 'var(--c-green)',
                            transition: 'height 0.6s ease',
                            opacity: d.logged ? 1 : 0.3,
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--c-label-faint)', ...mono }}>{dayLabel}</div>
                        <div style={{ fontSize: 9, color: d.logged ? 'var(--c-label-dim)' : 'var(--c-label-faint)', ...mono }}>
                          {d.logged ? d.total_kcal : '--'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {/* ── 5. RECENT FOODS ────────────────────────────────────────────── */}
            {recentFoods.length > 0 && (
              <Card style={{ marginBottom: 12 }}>
                <CardLabel>Recent Foods</CardLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {recentFoods.slice(0, 8).map((r, i) => (
                    <button key={i} type="button"
                      onClick={() => {
                        setDesc(r.desc)
                        setKcal(String(r.kcal))
                        setProteinG(r.protein_g ? String(r.protein_g) : '')
                        setShowAdd(true)
                        setScanMsg(null)
                        setPhotoAnalysis(null)
                      }}
                      style={{
                        background: 'var(--c-bg)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 10,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--c-label)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                      <span>{r.desc}</span>
                      <span style={{ color: 'var(--c-label-faint)', fontSize: 10, ...mono }}>{r.kcal}</span>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Add food sheet ────────────────────────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) resetSheet() }}>
          <div style={{ background: 'var(--c-card)', borderRadius: '20px 20px 0 0', padding: 'calc(8px) 20px calc(40px + var(--safe-bottom))', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 5, background: 'var(--c-border)', borderRadius: 3, margin: '8px auto 16px' }} />

            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="sheet-close" onClick={resetSheet}>✕</button>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)' }}>Log Food</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {hasBarcodeSupport && (
                <button className="tap-lift" onClick={() => fileInputRef.current?.click()} disabled={scanning || analyzing}
                    style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: 'var(--c-label)', cursor: 'pointer', opacity: (scanning || analyzing) ? 0.5 : 1 }}>
                    {scanning ? 'Scanning...' : 'Barcode'}
                  </button>
                )}
                <button className="tap-lift" onClick={() => photoInputRef.current?.click()} disabled={scanning || analyzing}
                  style={{ background: analyzing ? 'var(--c-border)' : 'var(--c-accent)', border: 'none', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: analyzing ? 'var(--c-label-dim)' : '#fff', cursor: 'pointer', opacity: (scanning || analyzing) ? 0.7 : 1 }}>
                  {analyzing ? 'Analyzing...' : 'Snap Food'}
                </button>
              </div>
            </div>

            {/* Hidden inputs */}
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleBarcodeFile} />
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhotoAnalysis} />

            {/* Scan message */}
            {scanMsg && (
              <div style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--c-label-dim)', lineHeight: 1.4 }}>
                {scanMsg}
              </div>
            )}

            {/* AI photo analysis result */}
            {photoAnalysis && (
              <div style={{ background: 'rgba(59,130,246,0.08)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-accent)' }}>AI identified: {photoAnalysis.name}</div>
                  <ConfidenceBadge confidence={photoAnalysis.confidence} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-label-dim)', marginBottom: 6 }}>{photoAnalysis.description}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--c-label-dim)', ...mono }}>
                  <span><strong style={{ color: 'var(--c-label)' }}>{photoAnalysis.kcal}</strong> kcal</span>
                  <span><strong style={{ color: 'var(--c-accent)' }}>{photoAnalysis.protein_g}g</strong> pro</span>
                  <span><strong style={{ color: 'var(--c-green)' }}>{photoAnalysis.carbs_g}g</strong> carb</span>
                  <span><strong style={{ color: 'var(--c-orange)' }}>{photoAnalysis.fat_g}g</strong> fat</span>
                </div>
              </div>
            )}

            <form onSubmit={submit}>
              {/* Meal picker */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {MEALS.map(m => (
                  <button key={m} type="button" onClick={() => setMeal(m)}
                    style={{ flex: 1, padding: '8px 4px', borderRadius: 10, border: meal === m ? 'none' : '1px solid var(--c-border)', background: meal === m ? 'var(--c-accent)' : 'var(--c-bg)', color: meal === m ? '#fff' : 'var(--c-label-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {m}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: -6, marginBottom: 10, fontSize: 11, color: 'var(--c-label-faint)', ...mono }}>
                Target: ~{mealTargetKcal} kcal · ~{mealTargetProtein}g protein
              </div>

              {/* Recent foods chips inside sheet */}
              {recentFoods.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--c-label-faint)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {recentFoods.slice(0, 6).map((r, i) => (
                      <button key={i} type="button"
                        onClick={() => { setDesc(r.desc); setKcal(String(r.kcal)); setProteinG(r.protein_g ? String(r.protein_g) : '') }}
                        style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 500, color: 'var(--c-label)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        {r.desc} <span style={{ color: 'var(--c-label-faint)', fontSize: 10, ...mono }}>{r.kcal}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <input className="input-field" style={{ marginBottom: 10 }}
                placeholder="What did you eat? e.g. Chicken and rice"
                value={desc} onChange={e => setDesc(e.target.value)} autoFocus={!scanning && !analyzing}
                autoComplete="on" autoCorrect="on" spellCheck={true} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input className="input-field" style={{ flex: 1 }}
                  placeholder="Calories" type="number" inputMode="numeric"
                  value={kcal} onChange={e => setKcal(e.target.value)} />
                <input className="input-field" style={{ flex: 1 }}
                  placeholder="Protein (g)" type="number" inputMode="numeric"
                  value={proteinG} onChange={e => setProteinG(e.target.value)} />
              </div>

              <button type="submit" className="btn-primary" disabled={submitting || !desc || !kcal}
                style={{ opacity: (!desc || !kcal) ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting ? (
                  <>
                    <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Saving...
                  </>
                ) : 'Add to Log'}
              </button>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation sheet ─────────────────────────────────────────── */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null) }}>
          <div style={{ background: 'var(--c-card)', borderRadius: '20px 20px 0 0', padding: '20px 20px calc(40px + var(--safe-bottom))', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <button className="sheet-close" onClick={() => setDeleteConfirm(null)}>✕</button>
              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--c-label)' }}>Remove this entry?</div>
            </div>
            <div style={{ fontSize: 15, color: 'var(--c-label-dim)', marginBottom: 4 }}>
              {deleteConfirm.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-label-faint)', marginBottom: 24, ...mono }}>
              {deleteConfirm.meal} · {deleteConfirm.time} · ~{deleteConfirm.kcal} kcal
            </div>
            <button className="btn-destructive" style={{ width: '100%', marginBottom: 12 }}
              onClick={async () => {
                const label = deleteConfirm.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal\)/, '')
                await api.deleteFood(deleteConfirm.time, deleteConfirm.meal)
                const updated = await api.getToday()
                setData(updated)
                setDeleteConfirm(null)
                if (navigator.vibrate) navigator.vibrate(20)
                showToast(`Removed ${label}`)
              }}>Delete</button>
            <button onClick={() => setDeleteConfirm(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--c-accent)', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {barcodeProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 350, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setBarcodeProduct(null) }}>
          <div style={{ background: 'var(--c-card)', borderRadius: '20px 20px 0 0', width: '100%', padding: '18px 20px 36px', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ width: 36, height: 5, background: 'var(--c-border)', borderRadius: 3, margin: '0 auto 14px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: 'var(--c-label)' }}>Barcode found</div>
            <div style={{ fontSize: 14, color: 'var(--c-label-dim)', marginBottom: 14 }}>
              {barcodeProduct.name}{barcodeProduct.kcal ? ` · ~${barcodeProduct.kcal} kcal` : ''}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="btn-primary" onClick={() => applyBarcodeChoice('log')}>Log in nutrition</button>
              <button onClick={() => applyBarcodeChoice('fridge')} style={{ border: '1px solid var(--c-border)', borderRadius: 14, padding: '13px', background: 'var(--c-card)', color: 'var(--c-label)', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Add to fridge</button>
              <button onClick={() => applyBarcodeChoice('both')} style={{ border: 'none', borderRadius: 14, padding: '13px', background: 'var(--c-green)', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Do both</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
