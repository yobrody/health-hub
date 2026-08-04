import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { NUTRITION_TARGETS } from '../program'

// Friendly label + unit + sort order for any captured nutrient key. Keeps the
// "All nutrients" panel readable and ordered (macros → fats → minerals → vits).
const NUTRIENT_META: Record<string, { label: string; unit: string; order: number }> = {
  saturated_fat_g: { label: 'Saturated fat', unit: 'g', order: 10 },
  trans_fat_g: { label: 'Trans fat', unit: 'g', order: 11 },
  cholesterol_mg: { label: 'Cholesterol', unit: 'mg', order: 12 },
  fiber_g: { label: 'Fiber', unit: 'g', order: 20 },
  sugar_g: { label: 'Sugar', unit: 'g', order: 21 },
  salt_g: { label: 'Salt', unit: 'g', order: 30 },
  sodium_mg: { label: 'Sodium', unit: 'mg', order: 31 },
  potassium_mg: { label: 'Potassium', unit: 'mg', order: 40 },
  calcium_mg: { label: 'Calcium', unit: 'mg', order: 41 },
  iron_mg: { label: 'Iron', unit: 'mg', order: 42 },
  magnesium_mg: { label: 'Magnesium', unit: 'mg', order: 43 },
  zinc_mg: { label: 'Zinc', unit: 'mg', order: 44 },
  vitamin_c_mg: { label: 'Vitamin C', unit: 'mg', order: 50 },
  vitamin_d_ug: { label: 'Vitamin D', unit: 'µg', order: 51 },
  vitamin_a_ug: { label: 'Vitamin A', unit: 'µg', order: 52 },
}
function buildNutrientMap(obj: Record<string, number | undefined | null>): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && v > 0) out[k] = v
  return Object.keys(out).length ? out : undefined
}
function nutrientMeta(key: string): { label: string; unit: string; order: number } {
  if (NUTRIENT_META[key]) return NUTRIENT_META[key]
  // Fallback: derive a label + unit from the key suffix.
  const unit = key.endsWith('_mg') ? 'mg' : key.endsWith('_ug') ? 'µg' : key.endsWith('_g') ? 'g' : ''
  const label = key.replace(/_(g|mg|ug)$/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
  return { label, unit, order: 99 }
}

import { analyseDiet } from '../lib/nutrition-gaps'
import type { FoodLogRow } from '../api/client'
import { api } from '../api/client'
import { showToast } from '../toast'
import { useSwipeDown } from '../hooks/useSwipeDown'
import Skeleton from '../components/Skeleton'
import { rememberFood } from '../lib/food-memory'
import { checkFoodPlausibility } from '../lib/food-plausibility'
// Lazy so recharts (~100KB gz) only downloads when the trend chart renders,
// keeping it off the initial load.
const CalorieTrendChart = lazy(() => import('../components/CalorieTrendChart'))
import type { FoodEntry, TodayData, HistoryDay, FoodAnalysis, BarcodeLookupResult, FoodSearchProduct, RecipeResult, SmartFoodResult } from '../api/client'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']

// ── Smart-estimate clarifying chips ──────────────────────────────────────────
// Cooking fat / portion adjustments the user can tap to re-estimate. null = use
// the estimator's base assumption. Each maps to a free-text suffix appended to
// the description, since the estimator honours cooking method / portion stated
// in plain English.
type FatChip = null | 'oil' | 'butter'
type PortionChip = null | 'small' | 'medium' | 'large'
const FAT_CHIPS: { key: Exclude<FatChip, null>; label: string; suffix: string }[] = [
  { key: 'oil', label: 'Oil', suffix: ', cooked in 1 tbsp sunflower oil' },
  { key: 'butter', label: 'Butter', suffix: ', cooked in butter' },
]
const PORTION_CHIPS: { key: Exclude<PortionChip, null>; label: string; suffix: string }[] = [
  { key: 'small', label: 'Small', suffix: ', small portion' },
  { key: 'medium', label: 'Medium', suffix: ', medium portion' },
  { key: 'large', label: 'Large', suffix: ', large portion' },
]
// Build the augmented description from the user's base text + active chips.
function buildSmartDesc(base: string, fat: FatChip, portion: PortionChip): string {
  let d = base.trim()
  if (fat) d += FAT_CHIPS.find(c => c.key === fat)!.suffix
  if (portion) d += PORTION_CHIPS.find(c => c.key === portion)!.suffix
  return d
}

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
  const [loading, setLoading] = useState(true)
  const sheetSwipe = useSwipeDown(resetSheet) // swipe-down-to-dismiss (resetSheet is hoisted)
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
  // Extended macros (from AI analysis)
  const [carbsG, setCarbsG] = useState<number | undefined>()
  const [fatG, setFatG] = useState<number | undefined>()
  const [fiberG, setFiberG] = useState<number | undefined>()
  const [sugarG, setSugarG] = useState<number | undefined>()
  const [sodiumMg, setSodiumMg] = useState<number | undefined>()
  // Full micro/macro map captured from a barcode / DB search / smart estimate,
  // carried through to the log so every nutrient the source gave is preserved.
  const [entryNutrients, setEntryNutrients] = useState<Record<string, number> | undefined>()
  const [showAllNutrients, setShowAllNutrients] = useState(false)
  // Fortnight of per-item history, for dietary pattern checks.
  const [foodLog, setFoodLog] = useState<FoodLogRow[]>([])
  const [confidence, setConfidence] = useState<string | undefined>()
  // Smart estimate (POST /food/smart) — natural-language nutrition estimate with
  // clarifying chips. smartBase holds the user's original description so chip
  // toggles re-estimate from a clean base rather than compounding suffixes.
  const [smartResult, setSmartResult] = useState<SmartFoodResult | null>(null)
  const [smartBase, setSmartBase] = useState('')
  const [smartLoading, setSmartLoading] = useState(false)
  const [fatChip, setFatChip] = useState<FatChip>(null)
  const [portionChip, setPortionChip] = useState<PortionChip>(null)
  // Food database search
  const [searchResults, setSearchResults] = useState<FoodSearchProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [searchSource, setSearchSource] = useState<'verified' | 'ai' | null>(null)
  // Expandable food detail
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null) // "meal-index" key
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
  // Recipe calculator
  const [showRecipe, setShowRecipe] = useState(false)
  const [recipeIngredients, setRecipeIngredients] = useState('')
  const [recipeServings, setRecipeServings] = useState('1')
  const [recipeResult, setRecipeResult] = useState<RecipeResult | null>(null)
  const [recipeLoading, setRecipeLoading] = useState(false)

  useEffect(() => {
    const hour = new Date().getHours()
    const defaultMeal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
    setMeal(defaultMeal)
    api.getToday().then(setData).catch(console.error).finally(() => setLoading(false))
    api.getFoodLog(14).then(r => setFoodLog(r.entries ?? [])).catch(() => setFoodLog([]))
    api.getFoodHistory(14).then(setHistory).catch(console.error)
    const onFoodLogged = () => {
      api.getToday().then(setData).catch(() => {})
      api.getFoodHistory(14).then(setHistory).catch(() => {})
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
    setCarbsG(undefined)
    setFatG(undefined)
    setFiberG(undefined)
    setSugarG(undefined)
    setSodiumMg(undefined)
    setEntryNutrients(undefined)
    setConfidence(undefined)
    setSmartResult(null)
    setSmartBase('')
    setSmartLoading(false)
    setFatChip(null)
    setPortionChip(null)
    setSearchResults([])
    setSearchSource(null)
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
      await api.addFood({ meal, description: desc, kcal: kcalNum, protein_g: proteinNum, carbs_g: carbsG, fat_g: fatG, fiber_g: fiberG, sugar_g: sugarG, sodium_mg: sodiumMg, confidence, nutrients: entryNutrients })
      saveRecent({ desc, kcal: kcalNum, protein_g: proteinNum ?? 0 })
      rememberFood({ name: desc, kcal: kcalNum, protein_g: proteinNum, carbs_g: carbsG, fat_g: fatG })
      const updated = await api.getToday()
      setData(updated)
      api.getFoodHistory(14).then(h => setHistory(h)).catch(() => {})
      window.dispatchEvent(new CustomEvent('food-logged'))
      resetSheet()
      if (navigator.vibrate) navigator.vibrate(10)
      showToast(`${desc} added to ${meal.toLowerCase()}`)
    } catch {
      showToast('Failed to save — try again', 'err')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFoodSearch() {
    if (!desc.trim()) return
    setSearching(true)
    setSearchResults([])
    try {
      const res = await api.searchFood(desc.trim())
      setSearchResults(res.results)
    } catch {
      showToast('Search failed — try again', 'err')
    } finally {
      setSearching(false)
    }
  }

  function applySearchResult(product: FoodSearchProduct) {
    const n = product.per_100g
    setDesc(product.brand ? `${product.name} (${product.brand})` : product.name)
    setKcal(String(n.kcal))
    setProteinG(String(n.protein_g))
    setCarbsG(n.carbs_g)
    setFatG(n.fat_g)
    setFiberG(n.fiber_g)
    setSugarG(n.sugar_g)
    setSodiumMg(n.sodium_mg)
    // Carry every micro the database product supplied into the log.
    setEntryNutrients(buildNutrientMap({
      saturated_fat_g: (n as { saturated_fat_g?: number }).saturated_fat_g,
      fiber_g: n.fiber_g, sugar_g: n.sugar_g, salt_g: n.salt_g, sodium_mg: n.sodium_mg,
    }))
    setConfidence('high')
    setSearchSource('verified')
    setSearchResults([])
  }

  // Run the natural-language smart estimate. `nextFat`/`nextPortion` let chip
  // taps re-estimate in the same call; defaults reuse current chip state. The
  // base description is captured once so chip suffixes never compound.
  async function runSmartEstimate(nextFat: FatChip = fatChip, nextPortion: PortionChip = portionChip) {
    const base = (smartResult ? smartBase : desc).trim()
    if (!base) return
    setSmartBase(base)
    setSmartLoading(true)
    try {
      const r = await api.smartFoodLog(buildSmartDesc(base, nextFat, nextPortion))
      setSmartResult(r)
      setSearchSource(null)
      // Populate the form so the existing submit button logs the estimate.
      if (r.description) setDesc(r.description)
      if (r.kcal > 0) setKcal(String(r.kcal))
      if (r.protein_g > 0) setProteinG(String(r.protein_g))
      setCarbsG(r.carbs_g)
      setFatG(r.fat_g)
      setFiberG(r.fiber_g)
      setSugarG(r.sugar_g)
      setSodiumMg(r.sodium_mg)
      setEntryNutrients(buildNutrientMap({ fiber_g: r.fiber_g, sugar_g: r.sugar_g, sodium_mg: r.sodium_mg }))
      setConfidence(r.confidence)
      if (navigator.vibrate) navigator.vibrate(8)
    } catch {
      showToast('Smart estimate failed — try again', 'err')
    } finally {
      setSmartLoading(false)
    }
  }

  // Toggle a chip (tapping the active one clears it) and re-estimate.
  function toggleFatChip(key: Exclude<FatChip, null>) {
    const next: FatChip = fatChip === key ? null : key
    setFatChip(next)
    runSmartEstimate(next, portionChip)
  }
  function togglePortionChip(key: Exclude<PortionChip, null>) {
    const next: PortionChip = portionChip === key ? null : key
    setPortionChip(next)
    runSmartEstimate(fatChip, next)
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
      if (result.carbs_g > 0) setCarbsG(result.carbs_g)
      if (result.fat_g > 0) setFatG(result.fat_g)
      setConfidence(result.confidence)
      // Packaged product without a readable label → these macros are a GUESS.
      // Don't let the user log wrong numbers blind: prompt them to snap the label.
      if (result.needs_label || (result.source === 'estimate' && result.confidence === 'low')) {
        setScanMsg('\u{1F4CB} Looks packaged — these macros are an estimate. Snap the nutrition label and I’ll read the exact numbers.')
        setTimeout(() => setScanMsg(null), 7000)
      } else if (result.source === 'label') {
        setScanMsg('✓ Read straight from the nutrition label')
        setTimeout(() => setScanMsg(null), 3500)
      }
    } catch {
      setScanMsg('AI analysis failed \u2014 enter details manually')
      setTimeout(() => setScanMsg(null), 4000)
    } finally {
      setAnalyzing(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const hasBarcodeSupport = typeof window !== 'undefined' && 'BarcodeDetector' in window
  // First-paint skeletons for the hero ring numbers while /today is in flight.
  const showSkeleton = loading && !data
  const total = data?.total_kcal ?? 0
  const goal = data?.goals.calories ?? 2200
  const pct = Math.min(total / goal, 1)
  const remaining = Math.max(goal - total, 0)
  const proteinGoal = data?.goals.protein ?? 140
  // Compute macros from entries — prefer REAL stored macros per item, and
  // fall back to a calorie-based estimate only for legacy items missing data.
  const ents = data?.entries ?? []
  const totalProtein = ents.reduce((a, e) => a + (e.protein_g ?? 0), 0)
  let realCarbs = 0, realFat = 0, totalFiber = 0, totalSugar = 0, totalSodium = 0
  let macrosEstimated = false  // at least one item had no real carbs/fat
  let hasRealMacros = false    // at least one item carried real carbs/fat
  for (const e of ents) {
    const hasReal = e.carbs_g != null || e.fat_g != null
    if (hasReal) {
      realCarbs += e.carbs_g ?? 0
      realFat += e.fat_g ?? 0
      totalFiber += e.fiber_g ?? 0
      totalSugar += e.sugar_g ?? 0
      totalSodium += e.sodium_mg ?? 0
      hasRealMacros = true
    } else {
      // estimate this single item from its own calories after protein
      const eRemaining = Math.max((e.kcal ?? 0) - (e.protein_g ?? 0) * 4, 0)
      realFat += Math.round(eRemaining * 0.35 / 9)
      realCarbs += Math.round(eRemaining * 0.65 / 4)
      macrosEstimated = true
    }
  }
  // Full micronutrient aggregation — sum every entry's `nutrients` map plus the
  // core stored micros, so the panel can show ALL nutrients that were captured
  // (saturated fat, salt, calcium, iron, potassium, vitamin C, …). Nothing is
  // fabricated: a nutrient appears only if at least one logged item carried it.
  const nutrientTotals: Record<string, number> = {}
  for (const e of ents) {
    for (const [k, v] of Object.entries(e.nutrients ?? {})) {
      if (typeof v === 'number' && v === v) nutrientTotals[k] = (nutrientTotals[k] ?? 0) + v
    }
  }

  // Back-compat aliases used throughout the view (now real where available)
  const estimatedCarbs = Math.round(realCarbs)
  const estimatedFat = Math.round(realFat)
  const proteinCals = totalProtein * 4
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
                    {showSkeleton ? <Skeleton w={52} h={22} /> : <span className="hh-reveal">{remaining > 0 ? remaining.toLocaleString() : '0'}</span>}
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
                        {showSkeleton ? <Skeleton w={22} h={11} /> : <span className="hh-reveal">{`${totalProtein}g`}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Protein</div>
                  </div>
                  {/* Carbs mini ring */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 52, height: 52 }}>
                      <ProgressRing progress={Math.min(estimatedCarbs / carbsGoal, 1)} size={52} stroke={5} color="var(--c-green)" />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--c-label)', ...mono }}>
                        {showSkeleton ? <Skeleton w={22} h={11} /> : <span className="hh-reveal">{`${estimatedCarbs}g`}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Carbs</div>
                  </div>
                  {/* Fat mini ring */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 52, height: 52 }}>
                      <ProgressRing progress={Math.min(estimatedFat / fatGoal, 1)} size={52} stroke={5} color="var(--c-orange)" />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--c-label)', ...mono }}>
                        {showSkeleton ? <Skeleton w={22} h={11} /> : <span className="hh-reveal">{`${estimatedFat}g`}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-label-dim)', marginTop: 3 }}>Fat</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── 1b. CALORIE TREND ──────────────────────────────────────────── */}
            <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
              <CardLabel>Last 14 days</CardLabel>
              <div style={{ marginTop: 8 }}>
                <Suspense fallback={<Skeleton w="100%" h={180} />}>
                  <CalorieTrendChart history={history} goal={goal} days={14} />
                </Suspense>
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
                {(hasRealMacros || macrosEstimated) && (
                  <div style={{ fontSize: 10, color: 'var(--c-label-faint)', marginTop: 6, fontStyle: 'italic' }}>
                    {hasRealMacros && !macrosEstimated
                      ? 'Carbs & fat from logged items'
                      : hasRealMacros
                        ? 'Mostly tracked · some items estimated'
                        : 'All three inferred from calories alone — not measured'}
                  </div>
                )}
              </Card>
            )}

            {/* ── 2b. MICRONUTRIENT BARS ───────────────────────────────────── */}
            {total > 0 && (
              <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
                <CardLabel>Fibre, sugar &amp; salt</CardLabel>
                {[
                  { label: 'Fiber', current: hasRealMacros ? Math.round(totalFiber) : Math.round(total * 0.012), goal: NUTRITION_TARGETS.fibreG, unit: 'g', color: 'var(--c-green)' },
                  { label: 'Sugar', current: totalSugar > 0 ? Math.round(totalSugar) : Math.round(total * 0.08 / 4), goal: NUTRITION_TARGETS.freeSugarsMaxG, unit: 'g', color: 'var(--c-orange)', isLimit: true },
                  { label: 'Sodium', current: totalSodium > 0 ? Math.round(totalSodium) : Math.round(total * 0.9), goal: NUTRITION_TARGETS.sodiumMaxMg, unit: 'mg', color: 'var(--c-red)', isLimit: true },
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
                  {hasRealMacros
                    ? (totalSugar > 0 && totalSodium > 0 ? 'From logged item data' : 'Fiber tracked · sugar & sodium estimated')
                    : 'All three inferred from calories alone — not measured'}
                </div>
              </Card>
            )}

            {/* ── 2c. ALL NUTRIENTS ─── every micro/macro captured from barcodes,
                 DB searches and smart estimates, summed for the day. Only shows
                 nutrients that were actually measured (nothing fabricated). ── */}
            {Object.keys(nutrientTotals).length > 0 && (
              <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
                <button onClick={() => setShowAllNutrients(v => !v)}
                  style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CardLabel>All nutrients today</CardLabel>
                  <span style={{ fontSize: 13, color: 'var(--c-label-dim)' }}>{showAllNutrients ? 'Hide' : `${Object.keys(nutrientTotals).length} tracked ▾`}</span>
                </button>
                {showAllNutrients && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginTop: 12 }}>
                    {Object.entries(nutrientTotals)
                      .sort((a, b) => nutrientMeta(a[0]).order - nutrientMeta(b[0]).order)
                      .map(([k, v]) => {
                        const m = nutrientMeta(k)
                        return (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--c-border)', paddingBottom: 4 }}>
                            <span style={{ fontSize: 12, color: 'var(--c-label)' }}>{m.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-label-dim)', ...mono }}>
                              {v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}{m.unit}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )}
                {showAllNutrients && (
                  <div style={{ fontSize: 10, color: 'var(--c-label-faint)', marginTop: 10, fontStyle: 'italic' }}>
                    Only nutrients your logged items actually carried — barcode &amp; database items have the most. Log via barcode or database search for full micros.
                  </div>
                )}
              </Card>
            )}

            {(() => {
              const flags = analyseDiet(foodLog, 14)
              if (flags.length === 0) return null
              return (
                <Card style={{ marginBottom: 12, padding: '14px 16px' }}>
                  <CardLabel>Diet pattern &middot; last 14 days</CardLabel>
                  {flags.map((f, i) => (
                    <div key={i} style={{ marginTop: i === 0 ? 8 : 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: f.kind === 'gap' ? 'var(--c-orange)' : f.kind === 'ok' ? 'var(--c-green)' : 'var(--c-label)' }}>
                        {f.headline}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--c-label-dim)', lineHeight: 1.45, marginTop: 2 }}>{f.detail}</div>
                    </div>
                  ))}
                </Card>
              )
            })()}

            {/* 3. MEAL TIMELINE CARDS ─────────────────────────────────────── */}
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
                          {entries.map((e, i) => {
                            const entryKey = `${mealName}-${i}`
                            const isExpanded = expandedEntry === entryKey
                            const label = e.items.split('\n')[0].replace(/^- /, '').replace(/ \(~\d+ kcal(, ~\d+ g protein)?\)/, '')
                            const hasCarbs = e.carbs_g != null && e.carbs_g > 0
                            const hasFat = e.fat_g != null && e.fat_g > 0
                            const hasProtein = e.protein_g != null && e.protein_g > 0
                            const totalMacroG = (e.protein_g ?? 0) + (e.carbs_g ?? 0) + (e.fat_g ?? 0)
                            return (
                              <div key={i}>
                                <div
                                  onClick={() => setExpandedEntry(isExpanded ? null : entryKey)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0', WebkitTapHighlightColor: 'transparent' }}
                                >
                                  <div style={{ flex: 1, fontSize: 13, color: 'var(--c-label-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {label}
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-label-faint)', flexShrink: 0, ...mono }}>
                                    {e.kcal}
                                  </div>
                                  <div style={{ fontSize: 10, color: 'var(--c-label-faint)', flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                                    ▾
                                  </div>
                                </div>
                                {/* Expanded detail view */}
                                <div style={{
                                  maxHeight: isExpanded ? 300 : 0,
                                  overflow: 'hidden',
                                  transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
                                  opacity: isExpanded ? 1 : 0,
                                }}>
                                  <div style={{ padding: '8px 0 4px', borderTop: '1px solid var(--c-border)' }}>
                                    {/* Full description */}
                                    <div style={{ fontSize: 12, color: 'var(--c-label)', marginBottom: 8 }}>{label}</div>

                                    {/* Macro breakdown bar */}
                                    {totalMacroG > 0 && (
                                      <div style={{ marginBottom: 8 }}>
                                        <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', background: 'var(--c-border)' }}>
                                          {hasProtein && (
                                            <div style={{ width: `${((e.protein_g ?? 0) / totalMacroG) * 100}%`, background: 'var(--c-accent)', minWidth: 2 }} />
                                          )}
                                          {hasCarbs && (
                                            <div style={{ width: `${((e.carbs_g ?? 0) / totalMacroG) * 100}%`, background: 'var(--c-green)', minWidth: 2 }} />
                                          )}
                                          {hasFat && (
                                            <div style={{ width: `${((e.fat_g ?? 0) / totalMacroG) * 100}%`, background: 'var(--c-orange)', minWidth: 2 }} />
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {/* Macro values */}
                                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--c-label-dim)', marginBottom: 6, flexWrap: 'wrap', ...mono }}>
                                      <span><strong style={{ color: 'var(--c-accent)' }}>{hasProtein ? `${e.protein_g}g` : '--'}</strong> protein</span>
                                      <span><strong style={{ color: 'var(--c-green)' }}>{hasCarbs ? `${e.carbs_g}g` : '--'}</strong> carbs</span>
                                      <span><strong style={{ color: 'var(--c-orange)' }}>{hasFat ? `${e.fat_g}g` : '--'}</strong> fat</span>
                                    </div>

                                    {/* Micros row */}
                                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--c-label-faint)', marginBottom: 8, flexWrap: 'wrap', ...mono }}>
                                      <span>Fiber: {e.fiber_g != null ? `${e.fiber_g}g` : '--'}</span>
                                      <span>Sugar: {e.sugar_g != null ? `${e.sugar_g}g` : '--'}</span>
                                      <span>Sodium: {e.sodium_mg != null ? `${e.sodium_mg}mg` : '--'}</span>
                                    </div>

                                    {/* Time + confidence */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <span style={{ fontSize: 11, color: 'var(--c-label-faint)', ...mono }}>Logged {e.time}</span>
                                      {e.confidence && <ConfidenceBadge confidence={e.confidence as 'high' | 'medium' | 'low'} />}
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display: 'flex', gap: 8 }}>
                                      <button
                                        onClick={(ev) => { ev.stopPropagation(); setDeleteConfirm(e) }}
                                        style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--c-red)', background: 'none', color: 'var(--c-red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                                      >Delete</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
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
                <CardLabel>14-Day History</CardLabel>
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
                        // Clear any extended macros left over from a previous
                        // smart estimate / barcode for a DIFFERENT food.
                        setCarbsG(undefined); setFatG(undefined); setFiberG(undefined)
                        setSugarG(undefined); setSodiumMg(undefined); setConfidence(undefined)
                        setSmartResult(null); setSearchSource(null)
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
          <div {...sheetSwipe.bind} style={{ background: 'var(--c-card)', borderRadius: '20px 20px 0 0', padding: 'calc(8px) 20px calc(40px + var(--safe-bottom))', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '92vh', overflowY: 'auto', ...sheetSwipe.style }}>
            <div style={{ width: 36, height: 5, background: 'var(--c-border)', borderRadius: 3, margin: '8px auto 16px' }} />

            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="sheet-close" onClick={resetSheet}>✕</button>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)' }}>Log Food</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="tap-lift" onClick={() => { resetSheet(); setShowRecipe(true) }}
                  style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: 'var(--c-label)', cursor: 'pointer' }}>
                  Recipe
                </button>
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

            {/* Capture guidance — teaches the accurate path. For packaged food the
                nutrition label gives exact numbers; for a plated meal, snap the food. */}
            {!scanMsg && !photoAnalysis && !barcodeProduct && (
              <div style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: 'var(--c-label-dim)', lineHeight: 1.55 }}>
                <div>📋 <strong style={{ color: 'var(--c-label)' }}>Packaged?</strong> Snap the <strong style={{ color: 'var(--c-label)' }}>nutrition label</strong> — exact numbers, every time.</div>
                <div style={{ marginTop: 3 }}>🍽️ <strong style={{ color: 'var(--c-label)' }}>A plated meal?</strong> Snap the food for a best-effort estimate.</div>
              </div>
            )}

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
                value={desc} onChange={e => { setDesc(e.target.value); setSearchSource(null); setSmartResult(null); setFatChip(null); setPortionChip(null); setCarbsG(undefined); setFatG(undefined); setFiberG(undefined); setSugarG(undefined); setSodiumMg(undefined); setConfidence(undefined) }} autoFocus={!scanning && !analyzing}
                autoComplete="on" autoCorrect="on" spellCheck={true} />

              {/* Search database button + source badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={handleFoodSearch} disabled={searching || !desc.trim()}
                  style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: 'var(--c-label)', cursor: 'pointer', opacity: (!desc.trim() || searching) ? 0.5 : 1 }}>
                  {searching ? 'Searching...' : 'Search Database'}
                </button>
                <button type="button" onClick={() => runSmartEstimate()} disabled={smartLoading || !desc.trim()}
                  style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: 'var(--c-label)', cursor: 'pointer', opacity: (!desc.trim() || smartLoading) ? 0.5 : 1 }}>
                  {smartLoading && !smartResult ? 'Estimating...' : 'Smart Estimate'}
                </button>
                {searchSource === 'verified' && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-green)', background: '#10B98120', borderRadius: 8, padding: '2px 8px' }}>Verified</span>
                )}
                {(confidence && searchSource !== 'verified') && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-orange)', background: '#F59E0B20', borderRadius: 8, padding: '2px 8px' }}>AI estimate</span>
                )}
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div style={{ marginBottom: 12, maxHeight: 260, overflowY: 'auto', borderRadius: 12, border: '1px solid var(--c-border)' }}>
                  {searchResults.map((product, i) => (
                    <div key={i} onClick={() => applySearchResult(product)}
                      style={{ display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: i < searchResults.length - 1 ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg)' }}>
                      {product.image_url && (
                        <img src={product.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {product.name}
                        </div>
                        {product.brand && (
                          <div style={{ fontSize: 11, color: 'var(--c-label-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.brand}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 10, color: 'var(--c-label-faint)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--c-label)' }}>{product.per_100g.kcal} kcal</span>
                          <span>P {product.per_100g.protein_g}g</span>
                          <span>C {product.per_100g.carbs_g}g</span>
                          <span>F {product.per_100g.fat_g}g</span>
                          <span style={{ color: 'var(--c-green)', fontWeight: 600 }}>per 100g</span>
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-green)', background: '#10B98118', borderRadius: 6, padding: '2px 6px', alignSelf: 'center', flexShrink: 0 }}>Verified</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Smart estimate panel — surfaces the estimator's assumptions and
                  offers clarifying chips that re-estimate in place. */}
              {smartResult && (() => {
                const conf = (smartResult.confidence ?? 'medium') as 'high' | 'medium' | 'low'
                const pill = {
                  high: { label: 'High', color: 'var(--c-green)', bg: '#10B98120' },
                  medium: { label: 'Medium', color: 'var(--c-orange)', bg: '#F59E0B20' },
                  low: { label: 'Low', color: 'var(--c-red)', bg: '#EF444420' },
                }[conf]
                const chipBtn = (active: boolean): React.CSSProperties => ({
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: smartLoading ? 'default' : 'pointer',
                  border: active ? 'none' : '1px solid var(--c-border)',
                  background: active ? 'var(--c-accent)' : 'var(--c-bg)',
                  color: active ? '#fff' : 'var(--c-label-dim)',
                  opacity: smartLoading ? 0.6 : 1,
                  WebkitTapHighlightColor: 'transparent',
                })
                return (
                  <div style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-label)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {smartResult.portion_detail || smartResult.matched_product || 'Smart estimate'}
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: pill.color, background: pill.bg, borderRadius: 8, padding: '2px 8px' }}>{pill.label}</span>
                    </div>
                    {smartResult.confidence_reason && (
                      <div style={{ fontSize: 12, color: 'var(--c-label-dim)', lineHeight: 1.4, marginBottom: 10 }}>{smartResult.confidence_reason}</div>
                    )}

                    {/* Cooked in: chips */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-label-faint)', marginRight: 2 }}>Cooked in:</span>
                      <button type="button" disabled={smartLoading} onClick={() => { setFatChip(null); runSmartEstimate(null, portionChip) }} style={chipBtn(fatChip === null)}>None</button>
                      {FAT_CHIPS.map(c => (
                        <button key={c.key} type="button" disabled={smartLoading} onClick={() => toggleFatChip(c.key)} style={chipBtn(fatChip === c.key)}>{c.label}</button>
                      ))}
                    </div>

                    {/* Portion: chips */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-label-faint)', marginRight: 2 }}>Portion:</span>
                      {PORTION_CHIPS.map(c => (
                        <button key={c.key} type="button" disabled={smartLoading} onClick={() => togglePortionChip(c.key)} style={chipBtn(portionChip === c.key)}>{c.label}</button>
                      ))}
                    </div>

                    {smartLoading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-label-faint)', marginTop: 8, ...mono }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        Re-estimating…
                      </div>
                    )}
                    {!smartLoading && (conf === 'low' || conf === 'medium') && (
                      <div style={{ fontSize: 11, color: 'var(--c-label-faint)', marginTop: 8, lineHeight: 1.4 }}>
                        Rough estimate — adjust above before logging.
                      </div>
                    )}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input className="input-field" style={{ flex: 1 }}
                  placeholder="Calories" type="number" inputMode="numeric"
                  value={kcal} onChange={e => setKcal(e.target.value)} />
                <input className="input-field" style={{ flex: 1 }}
                  placeholder="Protein (g)" type="number" inputMode="numeric"
                  value={proteinG} onChange={e => setProteinG(e.target.value)} />
              </div>

              {/* Sanity guard — flags implausible estimates (e.g. an AI
                  hallucinating "3 eggs" as 702 kcal / 54g protein) so the user
                  looks before logging. Non-blocking. */}
              {(() => {
                const kcalNum = parseFloat(kcal)
                if (!Number.isFinite(kcalNum) || kcalNum <= 0) return null
                const proteinNum = proteinG ? parseFloat(proteinG) : undefined
                const { ok, warnings } = checkFoodPlausibility({
                  kcal: kcalNum,
                  protein_g: Number.isFinite(proteinNum as number) ? proteinNum : undefined,
                  carbs_g: carbsG,
                  fat_g: fatG,
                  description: desc,
                })
                if (ok) return null
                return (
                  <div style={{ background: '#F59E0B14', border: '1px solid var(--c-orange)', borderRadius: 12, padding: '10px 12px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--c-orange)', marginBottom: warnings.length ? 6 : 0 }}>
                      <span>⚠️</span> Double-check this estimate
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--c-label-dim)', lineHeight: 1.45 }}>
                      {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )
              })()}

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
                await api.deleteFood(deleteConfirm.time, deleteConfirm.meal, { date: data?.date, description: label })
                const updated = await api.getToday()
                setData(updated)
                api.getFoodHistory(14).then(h => setHistory(h)).catch(() => {})
                window.dispatchEvent(new CustomEvent('food-logged'))
                setDeleteConfirm(null)
                if (navigator.vibrate) navigator.vibrate(20)
                showToast(`Removed ${label}`)
              }}>Delete</button>
            <button onClick={() => setDeleteConfirm(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--c-accent)', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Recipe calculator sheet ─────────────────────────────────────────── */}
      {showRecipe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowRecipe(false); setRecipeResult(null) } }}>
          <div style={{ background: 'var(--c-card)', borderRadius: '20px 20px 0 0', padding: '8px 20px calc(40px + var(--safe-bottom))', width: '100%', animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 5, background: 'var(--c-border)', borderRadius: 3, margin: '8px auto 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="sheet-close" onClick={() => { setShowRecipe(false); setRecipeResult(null) }}>✕</button>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)' }}>Recipe Calculator</div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginBottom: 10 }}>
              One ingredient per line (e.g. "200g chicken breast", "1 cup rice")
            </div>
            <textarea
              value={recipeIngredients}
              onChange={e => setRecipeIngredients(e.target.value)}
              placeholder={"200g chicken breast\n1 cup rice\n1 tbsp olive oil\n100g broccoli"}
              rows={6}
              style={{ width: '100%', background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 14px', fontSize: 14, color: 'var(--c-label)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
              autoComplete="on" autoCorrect="on" spellCheck={true}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 14, alignItems: 'center' }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-label)' }}>Servings</label>
              <input
                type="number" inputMode="numeric" min="1" max="20"
                value={recipeServings}
                onChange={e => setRecipeServings(e.target.value)}
                style={{ width: 60, background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '8px 12px', fontSize: 14, color: 'var(--c-label)', textAlign: 'center', outline: 'none' }}
              />
            </div>
            <button
              onClick={async () => {
                const lines = recipeIngredients.split('\n').map(l => l.trim()).filter(Boolean)
                if (!lines.length) return
                setRecipeLoading(true)
                try {
                  const result = await api.calculateRecipe(lines, parseInt(recipeServings) || 1)
                  setRecipeResult(result)
                } catch {
                  showToast('Recipe calculation failed', 'err')
                } finally {
                  setRecipeLoading(false)
                }
              }}
              disabled={recipeLoading || !recipeIngredients.trim()}
              className="btn-primary"
              style={{ width: '100%', opacity: (!recipeIngredients.trim() || recipeLoading) ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
              {recipeLoading ? (
                <>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Calculating...
                </>
              ) : 'Calculate'}
            </button>

            {recipeResult && (
              <div>
                {/* Per serving macros */}
                <Card style={{ marginBottom: 10 }}>
                  <CardLabel>Per serving ({recipeResult.servings} serving{recipeResult.servings > 1 ? 's' : ''})</CardLabel>
                  <div style={{ display: 'flex', gap: 14, fontSize: 13, ...mono }}>
                    <span><strong style={{ color: 'var(--c-label)', fontSize: 18 }}>{recipeResult.per_serving.kcal}</strong> kcal</span>
                    <span><strong style={{ color: 'var(--c-accent)' }}>{recipeResult.per_serving.protein_g}g</strong> pro</span>
                    <span><strong style={{ color: 'var(--c-green)' }}>{recipeResult.per_serving.carbs_g}g</strong> carb</span>
                    <span><strong style={{ color: 'var(--c-orange)' }}>{recipeResult.per_serving.fat_g}g</strong> fat</span>
                  </div>
                  {recipeResult.per_serving.fiber_g > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--c-label-dim)', marginTop: 4 }}>Fiber: {recipeResult.per_serving.fiber_g}g</div>
                  )}
                </Card>

                {/* Total macros */}
                <Card style={{ marginBottom: 10 }}>
                  <CardLabel>Recipe total</CardLabel>
                  <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--c-label-dim)', ...mono }}>
                    <span>{recipeResult.recipe_total.kcal} kcal</span>
                    <span>{recipeResult.recipe_total.protein_g}g pro</span>
                    <span>{recipeResult.recipe_total.carbs_g}g carb</span>
                    <span>{recipeResult.recipe_total.fat_g}g fat</span>
                  </div>
                </Card>

                {/* Ingredient breakdown */}
                {recipeResult.ingredients && recipeResult.ingredients.length > 0 && (
                  <Card style={{ marginBottom: 10 }}>
                    <CardLabel>Ingredients breakdown</CardLabel>
                    {recipeResult.ingredients.map((ing, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < recipeResult.ingredients.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                        <span style={{ fontSize: 13, color: 'var(--c-label)' }}>{ing.name} <span style={{ color: 'var(--c-label-faint)', fontSize: 11 }}>{ing.amount}</span></span>
                        <span style={{ fontSize: 12, color: 'var(--c-label-dim)', ...mono }}>{ing.kcal} kcal · {ing.protein_g}g pro</span>
                      </div>
                    ))}
                  </Card>
                )}

                {/* Confidence */}
                {recipeResult.confidence && (
                  <div style={{ textAlign: 'center', marginBottom: 10 }}>
                    <ConfidenceBadge confidence={recipeResult.confidence} />
                  </div>
                )}

                {/* Log one serving */}
                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  onClick={async () => {
                    const ps = recipeResult.per_serving
                    const hour = new Date().getHours()
                    const m = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
                    const ingredientLines = recipeIngredients.split('\n').filter(l => l.trim()).slice(0, 3).join(', ')
                    try {
                      await api.addFood({
                        meal: m,
                        description: `Recipe (1/${recipeResult.servings}): ${ingredientLines}`,
                        kcal: ps.kcal,
                        protein_g: ps.protein_g,
                        carbs_g: ps.carbs_g,
                        fat_g: ps.fat_g,
                        fiber_g: ps.fiber_g,
                        confidence: recipeResult.confidence,
                      })
                      const updated = await api.getToday()
                      setData(updated)
                      setShowRecipe(false)
                      setRecipeResult(null)
                      setRecipeIngredients('')
                      setRecipeServings('1')
                      showToast(`Logged 1 serving (${ps.kcal} kcal)`)
                      window.dispatchEvent(new Event('food-logged'))
                    } catch {
                      showToast('Failed to log serving', 'err')
                    }
                  }}>
                  Log one serving ({recipeResult.per_serving.kcal} kcal)
                </button>
              </div>
            )}
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
