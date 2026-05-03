import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FridgeData, FridgeItem, Meal, MealDetail, ScanResult, ScannedItem, ShelfLifeMap } from '../api/client'
import { showToast } from '../toast'

type Zone = 'fridge' | 'pantry' | 'condiments' | 'freezer'

// Estimated shelf life per zone (days)
const SHELF_LIFE: Record<Zone, number> = {
  fridge: 7, freezer: 90, pantry: 180, condiments: 365,
}

// Food emoji map. Substring match (longer keys first via the order in this
// object \u2014 getEmoji walks Object.entries top-down). When a real-world receipt
// surfaces an item that misses everything here, it falls back to \ud83c\udf71 \u2014 that's
// the visual cue to come back and add a key. Recently filled gaps the user
// hit on prod: honey, protein pudding/bar/shake, peanut butter, jam, etc.
const FOOD_EMOJIS: Record<string, string> = {
  // Multi-word entries first so substring matches don't fire on a more
  // generic key (e.g. "protein pudding" before bare "protein").
  'protein pudding': '\u{1F36E}', 'protein bar': '\u{1F36B}', 'protein shake': '\u{1F95B}',
  'protein powder': '\u{1F4AA}', 'peanut butter': '\u{1F95C}', 'almond butter': '\u{1F95C}',
  'olive oil': '\u{1FAD9}', 'coconut oil': '\u{1FAD8}', 'sour cream': '\u{1F95B}',
  'greek yogurt': '\u{1F95B}', 'cottage cheese': '\u{1F9C0}', 'cream cheese': '\u{1F9C0}',
  'orange juice': '\u{1F9C3}', 'apple juice': '\u{1F9C3}', 'sparkling water': '\u{1F4A7}',
  'ice cream': '\u{1F368}', 'ice lolly': '\u{1F36A}', 'baked beans': '\u{1FAD8}',
  'sweet potato': '\u{1F360}', 'red pepper': '\u{1FAD1}', 'bell pepper': '\u{1FAD1}',
  'spring onion': '\u{1F9C5}', 'green bean': '\u{1F95C}',
  'soy sauce': '\u{1FAD9}', 'fish sauce': '\u{1FAD9}', 'hot sauce': '\u{1F336}',
  'maple syrup': '\u{1F36F}', 'tomato sauce': '\u{1F345}',
  'kombucha': '\u{1F375}', 'energy drink': '\u{1F95B}',

  // Single-word entries
  chicken: '\u{1F357}', beef: '\u{1F969}', salmon: '\u{1F41F}', fish: '\u{1F420}',
  shrimp: '\u{1F990}', prawn: '\u{1F990}', egg: '\u{1F95A}', eggs: '\u{1F95A}',
  turkey: '\u{1F983}', pork: '\u{1F969}', tuna: '\u{1F41F}', ham: '\u{1F969}',
  bacon: '\u{1F953}', steak: '\u{1F969}', lamb: '\u{1F969}', mince: '\u{1F969}',
  milk: '\u{1F95B}', cheese: '\u{1F9C0}', yoghurt: '\u{1F95B}', yogurt: '\u{1F95B}',
  butter: '\u{1F9C8}', cream: '\u{1F95B}', tofu: '\u{1F9C8}',
  spinach: '\u{1F96C}', lettuce: '\u{1F96C}', kale: '\u{1F96C}', cabbage: '\u{1F96C}',
  rocket: '\u{1F96C}', salad: '\u{1F957}',
  broccoli: '\u{1F966}', cauliflower: '\u{1F966}', carrot: '\u{1F955}', tomato: '\u{1F345}',
  pepper: '\u{1FAD1}', onion: '\u{1F9C5}', garlic: '\u{1F9C4}', ginger: '\u{1F9C4}',
  avocado: '\u{1F951}', cucumber: '\u{1F952}', courgette: '\u{1F952}', zucchini: '\u{1F952}',
  potato: '\u{1F954}', aubergine: '\u{1F346}', eggplant: '\u{1F346}',
  corn: '\u{1F33D}', mushroom: '\u{1F344}', celery: '\u{1F33F}', leek: '\u{1F33F}',
  apple: '\u{1F34E}', banana: '\u{1F34C}', orange: '\u{1F34A}', lemon: '\u{1F34B}',
  lime: '\u{1F34B}', kiwi: '\u{1F95D}', pineapple: '\u{1F34D}', peach: '\u{1F351}',
  pear: '\u{1F350}', watermelon: '\u{1F349}', melon: '\u{1F348}', cherries: '\u{1F352}',
  cherry: '\u{1F352}', plum: '\u{1F352}',
  berry: '\u{1FAD0}', blueberry: '\u{1FAD0}', raspberry: '\u{1FAD0}', strawberry: '\u{1F353}',
  grape: '\u{1F347}', mango: '\u{1F96D}', coconut: '\u{1F965}',
  rice: '\u{1F35A}', pasta: '\u{1F35D}', noodle: '\u{1F35C}', bread: '\u{1F35E}',
  bagel: '\u{1F96F}', toast: '\u{1F35E}', wrap: '\u{1F32F}', tortilla: '\u{1F32E}',
  oat: '\u{1F33E}', oats: '\u{1F33E}', flour: '\u{1F33E}', quinoa: '\u{1F33E}',
  granola: '\u{1F33E}', muesli: '\u{1F33E}', cereal: '\u{1F963}',
  biscuit: '\u{1F36A}', cookie: '\u{1F36A}', cracker: '\u{1F36A}', cake: '\u{1F370}',
  nuts: '\u{1F95C}', peanut: '\u{1F95C}', almond: '\u{1F95C}', cashew: '\u{1F95C}',
  walnut: '\u{1F95C}', pistachio: '\u{1F95C}',
  hummus: '\u{1FAD9}', dip: '\u{1FAD9}', salsa: '\u{1FAD9}', guacamole: '\u{1F951}',
  oil: '\u{1FAD9}', vinegar: '\u{1FAD9}', sauce: '\u{1FAD9}', mayo: '\u{1FAD9}',
  mustard: '\u{1FAD9}', ketchup: '\u{1FAD9}', pesto: '\u{1FAD9}', soy: '\u{1FAD9}',
  sriracha: '\u{1F336}', chilli: '\u{1F336}', spice: '\u{1F9C2}', salt: '\u{1F9C2}',
  honey: '\u{1F36F}', jam: '\u{1F36F}', marmalade: '\u{1F36F}', syrup: '\u{1F36F}',
  sugar: '\u{1F9C2}', sweetener: '\u{1F9C2}', stevia: '\u{1F33F}',
  coffee: '\u2615', espresso: '\u2615', tea: '\u{1F375}', matcha: '\u{1F375}',
  juice: '\u{1F9C3}', smoothie: '\u{1F964}', water: '\u{1F4A7}',
  beer: '\u{1F37A}', wine: '\u{1F377}', soda: '\u{1F964}', cola: '\u{1F964}',
  drink: '\u{1F964}',
  chocolate: '\u{1F36B}', candy: '\u{1F36C}', sweet: '\u{1F36C}',
  protein: '\u{1F4AA}', supplement: '\u{1F48A}', vitamin: '\u{1F48A}',
  sausage: '\u{1F32D}', burger: '\u{1F354}', pizza: '\u{1F355}', sushi: '\u{1F363}',
  jerky: '\u{1F969}', pudding: '\u{1F36E}', dessert: '\u{1F36E}',
  pickle: '\u{1F952}', olive: '\u{1FAD2}', lentil: '\u{1FAD8}', bean: '\u{1FAD8}',
  chickpea: '\u{1FAD8}', tinned: '\u{1F96B}', canned: '\u{1F96B}',
  frozen: '\u{1F9CA}',
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

// Each zone gets an atmospheric "interior" feel \u2014 not just labelled cards.
// Layered backgrounds: a base gradient (the back wall), a top highlight band
// (light from above), and a faint shelf-line stripe (rgba lines at intervals)
// painted via repeating-linear-gradient. Inner box-shadow adds depth so the
// zone feels recessed instead of flat.
type ZoneStyle = {
  label: string
  icon: string
  gradient: string
  accent: string
  border: string
  text: string
  // CSS shadows applied to the zone container's outer shell.
  shellShadow: string
  // Background-image for the items area: shelf stripe + top highlight.
  shelvesBg: string
}
// Calmed-down zone styling \u2014 keeps the at-a-glance "this is the fridge / this
// is the pantry" cue via a thin coloured top stripe, but drops the painted
// gradient backgrounds + faux shelf lines that read as cluttered. Cards now
// sit on the regular --card surface with one accent line. Same metaphor,
// quieter execution.
const ZONE_CONFIG: Record<Zone, ZoneStyle> = {
  fridge: {
    label: 'Fridge', icon: '',
    gradient: 'var(--card)',
    accent: '#5A8FBF', border: 'var(--separator)', text: 'var(--label)',
    shellShadow: '0 1px 0 var(--separator), 0 4px 14px rgba(0,0,0,0.04)',
    shelvesBg: 'none',
  },
  freezer: {
    label: 'Freezer', icon: '',
    gradient: 'var(--card)',
    accent: '#7A7CB5', border: 'var(--separator)', text: 'var(--label)',
    shellShadow: '0 1px 0 var(--separator), 0 4px 14px rgba(0,0,0,0.04)',
    shelvesBg: 'none',
  },
  pantry: {
    label: 'Pantry', icon: '',
    gradient: 'var(--card)',
    accent: '#A0823C', border: 'var(--separator)', text: 'var(--label)',
    shellShadow: '0 1px 0 var(--separator), 0 4px 14px rgba(0,0,0,0.04)',
    shelvesBg: 'none',
  },
  condiments: {
    label: 'Condiments', icon: '',
    gradient: 'var(--card)',
    accent: '#A05A5A', border: 'var(--separator)', text: 'var(--label)',
    shellShadow: '0 1px 0 var(--separator), 0 4px 14px rgba(0,0,0,0.04)',
    shelvesBg: 'none',
  },
}

function freshnessColor(age: number, shelfDays: number): string {
  const pct = age / shelfDays
  if (pct >= 0.75) return 'var(--red)'
  if (pct >= 0.45) return 'var(--orange)'
  return 'var(--green)'
}

function quantityBarColor(pct: number): string {
  if (pct >= 0.5) return 'var(--green)'
  if (pct >= 0.2) return 'var(--orange)'
  return 'var(--red)'
}

function formatGrams(g: number): string {
  // 1500 → "1.5kg"; 800 → "800g"; 0 → "0g"
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10000 ? 0 : 1).replace(/\.0$/, '')}kg`
  return `${Math.round(g)}g`
}

function ItemCard({
  item, zone, onTap, learnedDays,
}: {
  item: FridgeItem
  zone: Zone
  onTap: () => void
  learnedDays?: { avg_days: number; sample_count: number }
}) {
  const age = daysOld(item.added)
  const shelfDays = learnedDays?.avg_days ?? SHELF_LIFE[zone]
  const pct = Math.min(age / shelfDays, 1)
  const fColor = freshnessColor(age, shelfDays)
  const cfg = ZONE_CONFIG[zone]
  const isOld = pct >= 0.85
  const isWarn = pct >= 0.55 && !isOld
  const tint = getFoodTint(item.name)
  // Track image-load failures so we can swap to the emoji fallback without
  // re-rendering the whole tree. A single bad photo URL shouldn't break the
  // grid; the emoji is always available.
  const [imgFailed, setImgFailed] = useState(false)
  const showPhoto = !!item.photo_url && !imgFailed

  return (
    <button className="tap-lift" onClick={onTap} style={{
      background: isOld ? 'rgba(255,59,48,0.07)' : isWarn ? 'rgba(255,149,0,0.07)' : 'var(--gray6)',
      border: `1px solid ${isOld ? 'rgba(255,59,48,0.22)' : isWarn ? 'rgba(255,149,0,0.22)' : 'transparent'}`,
      borderRadius: 12, padding: '10px 6px 8px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      cursor: 'pointer', textAlign: 'center', width: '100%', minWidth: 0,
      WebkitTapHighlightColor: 'transparent', position: 'relative',
    }}>
      {isOld && <div style={{ position:'absolute', top:-6, right:-6, background:'var(--red)', color:'#fff', borderRadius:6, fontSize:9, fontWeight:700, padding:'1px 5px' }}>OLD</div>}
      {isWarn && !isOld && <div style={{ position:'absolute', top:-6, right:-6, background:'var(--orange)', color:'#fff', borderRadius:6, fontSize:9, fontWeight:700, padding:'1px 5px' }}>SOON</div>}
      {showPhoto ? (
        // Real product photo from Open Food Facts. Square 56px slot keeps the
        // grid uniform whatever the source aspect ratio. Subtle border so the
        // photo doesn't bleed into the card on light theme.
        <div style={{
          width: 56, height: 56, borderRadius: 12, overflow: 'hidden',
          background: tint,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src={item.photo_url ?? undefined}
            alt={item.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ) : (
        <span style={{
          fontSize: 26, lineHeight: 1.1, padding: '2px 4px',
          background: tint, borderRadius: 10,
        }}>{getEmoji(item.name)}</span>
      )}
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label)', lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
        {item.name}
      </span>
      {/* Quantity health-bar — only shown when the item carries server-side
          quantity tracking (set on receipt scan via unit_size_g/unit_count).
          Bar fills based on remaining vs full pack. Replaces the old
          ±1 localStorage counter the user disliked. */}
      {(() => {
        const hasGrams = typeof item.quantity_g === 'number' && typeof item.unit_size_g === 'number' && item.unit_size_g > 0
        const hasCount = typeof item.quantity_count === 'number' && typeof item.unit_count === 'number' && item.unit_count > 0
        if (!hasGrams && !hasCount) return null
        const remaining = hasGrams ? (item.quantity_g as number) : (item.quantity_count as number)
        const total = hasGrams ? (item.unit_size_g as number) : (item.unit_count as number)
        const qPct = Math.max(0, Math.min(1, total > 0 ? remaining / total : 0))
        const barColor = quantityBarColor(qPct)
        const remainingLabel = hasGrams ? formatGrams(remaining) : `${remaining}`
        const totalLabel = hasGrams ? formatGrams(total) : `${total}`
        return (
          <div style={{ width: '100%', marginTop: 4 }}>
            <div style={{ height: 5, background: 'var(--gray5)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${qPct * 100}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s, background 0.3s' }} />
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: barColor, marginTop: 2, display: 'flex', justifyContent: 'center', gap: 3 }}>
              <span>{remainingLabel}</span>
              <span style={{ color: 'var(--label3)', fontWeight: 400 }}>/ {totalLabel}</span>
            </div>
          </div>
        )
      })()}
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
          <div style={{ fontSize: 10, color: fColor, fontWeight: 600, marginTop: 2, display: 'flex', justifyContent: 'center', gap: 4 }}>
            <span>{age}d</span>
            {learnedDays && (
              <span style={{ color: 'var(--label3)', fontWeight: 400 }}>/ {learnedDays.avg_days}d avg</span>
            )}
          </div>
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

function ZoneSection({ zone, items, onRemove, learnedShelfLife }: {
  zone: Zone
  items: FridgeItem[]
  onRemove: (name: string, zone: Zone) => void
  learnedShelfLife: ShelfLifeMap
}) {
  const cfg = ZONE_CONFIG[zone]
  const totalCost = items.reduce((s, i) => s + (i.cost ?? 0), 0)
  const oldCount = items.filter(i => daysOld(i.added) > 5).length
  const warnCount = items.filter(i => { const a = daysOld(i.added); return a > 3 && a <= 5 }).length

  return (
    <div style={{
      background: cfg.gradient,
      borderRadius: 16,
      border: `1px solid ${cfg.border}`,
      marginBottom: 12,
      overflow: 'hidden',
      boxShadow: cfg.shellShadow,
    }}>
      {/* Thin accent stripe — the only colour cue per zone. */}
      <div style={{ height: 3, background: cfg.accent, opacity: 0.85 }} />
      <div style={{
        padding: '10px 14px 8px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label)', letterSpacing: '-0.1px' }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--label3)', fontWeight: 500 }}>{items.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(oldCount + warnCount) > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700,
              color: oldCount > 0 ? 'var(--red)' : 'var(--orange)' }}>
              {oldCount + warnCount} expiring
            </span>
          )}
          {totalCost > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label2)' }}>
              {'£'}{totalCost.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <div style={{
        padding: '4px 10px 12px',
        display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8,
      }}>
        {items.map((item, i) => (
          <ItemCard
            key={i}
            item={item}
            zone={zone}
            onTap={() => onRemove(item.name, zone)}
            learnedDays={learnedShelfLife[item.name]}
          />
        ))}
      </div>
    </div>
  )
}

export default function Fridge() {
  const [data, setData] = useState<FridgeData>({ fridge: [], pantry: [], condiments: [], freezer: [] })
  const [learnedShelfLife, setLearnedShelfLife] = useState<ShelfLifeMap>({})
  const [meals, setMeals] = useState<Meal[]>([])
  const [loadingMeals, setLoadingMeals] = useState(false)
  const [showMeals, setShowMeals] = useState(false)
  // Tap-to-expand meal recipe state. mealDetails caches results so re-tapping
  // a card doesn't re-pay the model token cost. expandedMealIdx === null when
  // collapsed; the index corresponds to position in the meals[] array.
  const [expandedMealIdx, setExpandedMealIdx] = useState<number | null>(null)
  const [mealDetails, setMealDetails] = useState<Record<string, MealDetail | 'loading' | 'error'>>({})
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

  useEffect(() => {
    api.getFridge().then(d => {
      setData(d)
      const names = (['fridge','freezer','pantry','condiments'] as Zone[])
        .flatMap(z => d[z].map((it: FridgeItem) => it.name))
      if (names.length) api.getShelfLife(names).then(setLearnedShelfLife).catch(() => {})
    })
  }, [])
  useEffect(() => {
    try { localStorage.setItem('grocery_done', JSON.stringify(groceryDone)) } catch { /* ignore quota errors */ }
  }, [groceryDone])
  // Note: legacy `fridge_qty` localStorage is no longer used. Quantity is now
  // server-side via item.quantity_g / quantity_count and the camera Home flow
  // decrements via /fridge/item/{name}/consume.

  const smartGrocery = [
    ...alertItems.map(i => i.name),
    ...STAPLES.filter(staple => !allItems.some(i => i.name.toLowerCase().includes(staple))),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 10)

  // Adds expiring items + recommended staples to the persistent shopping list.
  // Uses the global toast (always visible at the bottom) instead of the inline
  // scanStatus banner that the user reported as "doesn't work" \u2014 the banner
  // was below the fold on long fridge views, so taps appeared to do nothing.
  async function shareShoppingList() {
    const candidates = [
      ...alertItems.map(i => i.name),
      ...STAPLES.filter(staple => !allItems.some(i => i.name.toLowerCase().includes(staple))),
    ].filter((v, i, a) => a.indexOf(v) === i)

    if (candidates.length === 0) {
      showToast('Fridge is well stocked \u2014 nothing to add', 'info')
      return
    }

    try {
      const existing = await api.getList('shopping').catch(() => ({ items: [] as { text: string }[] }))
      const have = new Set(existing.items.map(i => i.text.toLowerCase().trim()))
      const fresh = candidates.filter(name => !have.has(name.toLowerCase().trim()))
      if (fresh.length === 0) {
        showToast('Already on your shopping list', 'info')
        return
      }
      await Promise.allSettled(fresh.map(name => api.addListItem('shopping', name)))
      showToast(`Added ${fresh.length} to shopping list`)
      if (navigator.vibrate) navigator.vibrate(15)
    } catch {
      showToast('Failed to update shopping list', 'err')
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
          await api.addFridgeItem(item.name, item.section, {
            size: item.size,
            cost: item.cost,
            store: storeName,
            unit_size_g: item.unit_size_g ?? null,
            unit_count: item.unit_count ?? null,
          })
          added++
        } catch { /* skip item on individual add failure */ }
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
      // Pass the OFF photo through so the card has a real product image
      // immediately. lookupBarcode now returns image_url alongside name.
      await api.addFridgeItem(product.name, section, {
        photo_url: product.image_url ?? null,
      })
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
    // Background photo lookup. Resolves into KV server-side; we re-fetch the
    // fridge once the lookup returns so the new card swaps from emoji → photo
    // without a reload. Failure is silent — emoji fallback is fine.
    void api.lookupPhoto(name).then(r => {
      if (r.photo_url) {
        return api.addFridgeItem(name, addZone, { photo_url: r.photo_url })
          .then(() => api.getFridge())
          .then(setData)
      }
    }).catch(() => {})
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
              learnedShelfLife={learnedShelfLife}
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
            {meals.map((m, i) => {
              const isExpanded = expandedMealIdx === i
              const detail = mealDetails[m.name]
              const detailLoaded = detail && detail !== 'loading' && detail !== 'error'
              const onTapMeal = () => {
                if (isExpanded) { setExpandedMealIdx(null); return }
                setExpandedMealIdx(i)
                if (mealDetails[m.name] && mealDetails[m.name] !== 'error') return
                setMealDetails(prev => ({ ...prev, [m.name]: 'loading' }))
                api.getMealDetail(m.name, m.ingredients)
                  .then(d => setMealDetails(prev => ({ ...prev, [m.name]: d })))
                  .catch(() => setMealDetails(prev => ({ ...prev, [m.name]: 'error' })))
              }
              return (
                <div key={i} style={{ background: 'var(--card)', borderRadius: 16, padding: '14px 16px', marginBottom: 10, cursor: 'pointer' }} onClick={onTapMeal}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
                      {m.name}
                      <span style={{ fontSize: 13, color: 'var(--label3)', fontWeight: 400, marginLeft: 6 }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
                    </div>
                    <span className="badge badge-blue" style={{ fontSize: 11, marginLeft: 8, flexShrink: 0 }}>~{m.kcal_estimate} kcal</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label2)' }}>{m.ingredients.join(' \u00B7 ')}</div>

                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--separator)' }} onClick={e => e.stopPropagation()}>
                      {detail === 'loading' && (
                        <div style={{ fontSize: 13, color: 'var(--label2)' }}>\u23F3 Generating recipe\u2026</div>
                      )}
                      {detail === 'error' && (
                        <div style={{ fontSize: 13, color: 'var(--red)' }}>Couldn't generate recipe \u2014 tap to retry</div>
                      )}
                      {detailLoaded && (
                        <>
                          {/* Macros row \u2014 real per-serving numbers from /ai/meal-detail. */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
                            {[
                              { label: 'kcal',    value: detail.kcal,                color: 'var(--blue)' },
                              { label: 'protein', value: `${detail.protein_g}g`,     color: 'var(--orange)' },
                              { label: 'carbs',   value: `${detail.carbs_g}g`,       color: 'var(--green)' },
                              { label: 'fat',     value: `${detail.fat_g}g`,         color: 'var(--purple)' },
                            ].map(stat => (
                              <div key={stat.label} style={{ background: 'var(--gray6)', borderRadius: 10, padding: '6px 4px', textAlign: 'center' }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                                <div style={{ fontSize: 10, color: 'var(--label3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{stat.label}</div>
                              </div>
                            ))}
                          </div>

                          {(detail.prep_minutes != null || detail.cook_minutes != null || detail.servings != null) && (
                            <div style={{ fontSize: 12, color: 'var(--label2)', marginBottom: 10 }}>
                              {detail.prep_minutes != null && <>{'\u23F1 '}{detail.prep_minutes}m prep</>}
                              {detail.prep_minutes != null && detail.cook_minutes != null && ' \u00B7 '}
                              {detail.cook_minutes != null && <>{'\u{1F373} '}{detail.cook_minutes}m cook</>}
                              {(detail.prep_minutes != null || detail.cook_minutes != null) && detail.servings != null && ' \u00B7 '}
                              {detail.servings != null && <>{detail.servings} serving{detail.servings === 1 ? '' : 's'}</>}
                            </div>
                          )}

                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Steps</div>
                          <ol style={{ paddingLeft: 20, margin: 0 }}>
                            {detail.steps.map((step, si) => (
                              <li key={si} style={{ fontSize: 13, color: 'var(--label)', marginBottom: 6, lineHeight: 1.45 }}>{step}</li>
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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
