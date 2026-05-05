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

// Parallel map -> Iconify Noto Color icon names. Substring-matched in the same
// order as FOOD_EMOJIS so behavior is identical: longer keys (multi-word) hit
// first to prevent "protein pudding" matching bare "protein". Empty string =
// no good Noto match -> falls back to a bento-box generic.
//
// Naming follows Iconify's noto namespace (Google Noto Color Emoji). Browse:
//   https://icon-sets.iconify.design/noto/
const FOOD_ICONS: Record<string, string> = {
  // Multi-word entries first (must mirror FOOD_EMOJIS order)
  'protein pudding': 'custard',           'protein bar': 'chocolate-bar',     'protein shake': 'glass-of-milk',
  'protein powder': 'flexed-biceps',      'peanut butter': 'peanuts',         'almond butter': 'peanuts',
  'olive oil': 'olive',                   'coconut oil': 'coconut',           'sour cream': 'glass-of-milk',
  'greek yogurt': 'glass-of-milk',        'cottage cheese': 'cheese-wedge',   'cream cheese': 'cheese-wedge',
  'orange juice': 'cup-with-straw',       'apple juice': 'cup-with-straw',    'sparkling water': 'cup-with-straw',
  'ice cream': 'ice-cream',               'ice lolly': 'ice-cream',           'baked beans': 'pot-of-food',
  'sweet potato': 'sweet-potato',         'red pepper': 'bell-pepper',        'bell pepper': 'bell-pepper',
  'spring onion': 'onion',                'green bean': 'broccoli',
  'soy sauce': 'soy-sauce',               'fish sauce': 'soy-sauce',          'hot sauce': 'hot-pepper',
  'maple syrup': 'honey-pot',             'tomato sauce': 'tomato',
  'kombucha': 'teacup-without-handle',    'energy drink': 'beverage-box',
  'protein meals': 'pot-of-food',         'protein meal': 'pot-of-food',
  'protein rice': 'cooked-rice',          'tenderstem broccoli': 'broccoli',
  'pineapple slice': 'pineapple',
  'chicken thigh': 'poultry-leg',         'chicken breast': 'poultry-leg',

  // Single-word entries
  chicken: 'poultry-leg', beef: 'cut-of-meat', salmon: 'fish', fish: 'fish',
  shrimp: 'fried-shrimp', prawn: 'fried-shrimp', egg: 'egg', eggs: 'egg',
  turkey: 'turkey',       pork: 'cut-of-meat', tuna: 'fish',  ham: 'cut-of-meat',
  bacon: 'bacon',         steak: 'cut-of-meat', lamb: 'cut-of-meat', mince: 'cut-of-meat',
  milk: 'glass-of-milk',  cheese: 'cheese-wedge', yoghurt: 'glass-of-milk', yogurt: 'glass-of-milk',
  butter: 'butter',       cream: 'glass-of-milk', tofu: 'cheese-wedge',
  spinach: 'leafy-green', lettuce: 'leafy-green', kale: 'leafy-green', cabbage: 'leafy-green',
  rocket: 'leafy-green',  salad: 'green-salad',
  broccoli: 'broccoli',   cauliflower: 'broccoli', carrot: 'carrot', tomato: 'tomato',
  pepper: 'bell-pepper',  onion: 'onion', garlic: 'garlic', ginger: 'garlic',
  avocado: 'avocado',     cucumber: 'cucumber', courgette: 'cucumber', zucchini: 'cucumber',
  potato: 'potato',       aubergine: 'eggplant', eggplant: 'eggplant',
  corn: 'ear-of-corn',    mushroom: 'mushroom', celery: 'leafy-green', leek: 'leafy-green',
  apple: 'red-apple',     banana: 'banana', orange: 'tangerine', lemon: 'lemon',
  lime: 'lemon',          kiwi: 'kiwi-fruit', pineapple: 'pineapple', peach: 'peach',
  pear: 'pear',           watermelon: 'watermelon', melon: 'melon', cherries: 'cherries',
  cherry: 'cherries',     plum: 'cherries',
  berry: 'strawberry',    blueberry: 'blueberries', raspberry: 'strawberry', strawberry: 'strawberry',
  grape: 'grapes',        mango: 'mango', coconut: 'coconut',
  rice: 'cooked-rice',    pasta: 'spaghetti', noodle: 'spaghetti', bread: 'bread',
  bagel: 'bagel',         toast: 'bread', wrap: 'flatbread', tortilla: 'flatbread',
  oat: 'cooked-rice',     oats: 'cooked-rice', flour: 'cooked-rice', quinoa: 'cooked-rice',
  granola: 'cooked-rice', muesli: 'cooked-rice', cereal: 'bowl-with-spoon',
  biscuit: 'cookie',      cookie: 'cookie', cracker: 'cookie', cake: 'shortcake',
  nuts: 'peanuts',        peanut: 'peanuts', almond: 'peanuts', cashew: 'peanuts',
  walnut: 'peanuts',      pistachio: 'peanuts',
  hummus: 'pot-of-food',  dip: 'pot-of-food', salsa: 'pot-of-food', guacamole: 'avocado',
  oil: 'olive',           vinegar: 'soy-sauce', sauce: 'soy-sauce', mayo: 'soy-sauce',
  mustard: 'soy-sauce',   ketchup: 'tomato', pesto: 'soy-sauce', soy: 'soy-sauce',
  sriracha: 'hot-pepper', chilli: 'hot-pepper', spice: 'salt', salt: 'salt',
  honey: 'honey-pot',     jam: 'honey-pot', marmalade: 'honey-pot', syrup: 'honey-pot',
  sugar: 'salt',          sweetener: 'salt', stevia: 'leafy-green',
  coffee: 'hot-beverage', espresso: 'hot-beverage', tea: 'teacup-without-handle', matcha: 'teacup-without-handle',
  juice: 'cup-with-straw', smoothie: 'cup-with-straw', water: 'cup-with-straw',
  beer: 'beer-mug',       wine: 'wine-glass', soda: 'cup-with-straw', cola: 'cup-with-straw',
  drink: 'cup-with-straw',
  chocolate: 'chocolate-bar', candy: 'candy', sweet: 'candy',
  protein: 'flexed-biceps',  supplement: 'pill', vitamin: 'pill',
  sausage: 'hot-dog',     burger: 'hamburger', pizza: 'pizza', sushi: 'sushi',
  jerky: 'cut-of-meat',   pudding: 'custard',   dessert: 'shortcake',
  gherkin: 'cucumber',    olive: 'olive', lentil: 'pot-of-food', bean: 'pot-of-food',
  chickpea: 'pot-of-food', tinned: 'canned-food', canned: 'canned-food',
  frozen: 'ice-cube',
}

function getIconName(name: string): string {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(FOOD_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return 'pot-of-food'
}

// Per-item sizing so the shelf doesn't look like a uniform grid. Tall items
// like bottles/drinks lean against the back of the shelf; small items like
// single eggs sit at the front. The width:height ratio is hinted via the
// `aspect` field — items render at their natural size centered in the slot.
type ItemDim = { size: number; aspect: 'tall' | 'wide' | 'square' }
const ITEM_DIMS: Array<{ match: string[]; dim: ItemDim }> = [
  { match: ['milk', 'juice', 'water', 'bottle', 'wine', 'beer', 'oil', 'sauce',
            'vinegar', 'kombucha', 'soda', 'cola', 'protein shake'],
    dim: { size: 70, aspect: 'tall' } },
  { match: ['salad', 'broccoli', 'cauliflower', 'leafy', 'lettuce', 'spinach',
            'kale', 'cabbage', 'pizza', 'sushi', 'cake', 'pie'],
    dim: { size: 68, aspect: 'wide' } },
  { match: ['banana', 'pineapple', 'corn', 'baguette', 'carrot', 'celery'],
    dim: { size: 66, aspect: 'tall' } },
  { match: ['egg', 'garlic', 'cherry', 'cherries', 'olive', 'salt', 'spice'],
    dim: { size: 50, aspect: 'square' } },
]
function getItemDim(name: string): ItemDim {
  const lower = name.toLowerCase()
  for (const { match, dim } of ITEM_DIMS) {
    if (match.some(k => lower.includes(k))) return dim
  }
  return { size: 60, aspect: 'square' }
}

// Deterministic micro-rotation per item name so each item has the same lean
// every render but distinct items have different leans. Cheap hash → range.
function getItemRotation(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  // Range -4° to +4° in 1° steps
  return ((h % 9) - 4)
}

// Iconify CDN -> Noto Color Emoji namespace. Pre-sized to 48px so the
// returned SVG is small and lazy-loaded. Cards have a 56px tinted slot;
// 48 inside that slot leaves 4px breathing room each side.
function NotoIcon({ name, size = 48 }: { name: string; size?: number }) {
  const icon = getIconName(name)
  return (
    <img
      src={`https://api.iconify.design/noto/${icon}.svg?width=${size}&height=${size}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, display: 'block' }}
      onError={(e) => {
        const t = e.currentTarget
        if (!t.dataset.fallback) {
          t.dataset.fallback = '1'
          t.src = `https://api.iconify.design/noto/pot-of-food.svg?width=${size}&height=${size}`
        }
      }}
    />
  )
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
      {/* Noto Color icon — chosen by Brody 2026-05-05 over emoji + OFF photos.
          Single source: keyword in item.name -> Noto icon name (FOOD_ICONS map)
          -> Iconify CDN. Falls back to pot-of-food on misses. */}
      <div style={{
        width: 56, height: 56, borderRadius: 12,
        background: tint,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <NotoIcon name={item.name} size={48} />
      </div>
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

/**
 * Cartoon-illustrated fridge SVG. Uses the "front cutaway" Style A: bold black
 * outlines, multi-tone shading for 3D feel, magnets / brand badge / sticky note,
 * snowflake + LCD in the freezer, light bulb with rays at the top of the
 * interior, glass shelves with visible thickness, and a chrome handle with
 * specular reflection. Empty content area for the HTML items overlay to layer
 * on top.
 *
 * viewBox: 240 wide × 480 tall — gives a generous fridge aspect ratio.
 *   Freezer compartment: y = 60 to 138
 *   Main interior:       y = 150 to 442
 *     Shelf 1 line:      y = 226
 *     Shelf 2 line:      y = 304
 *     Shelf 3 line:      y = 386
 *   Bottom drawer:       y = 392 to 432
 */
function FridgeSvg({ itemCount }: { itemCount: number }) {
  return (
    <svg viewBox="0 0 240 480" xmlns="http://www.w3.org/2000/svg"
         style={{ width: '100%', height: 'auto', display: 'block' }}
         aria-hidden="true">
      <defs>
        <linearGradient id="fr-body-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E8E1CE" stopOpacity="0.7"/>
          <stop offset="22%" stopColor="#E8E1CE" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="fr-body-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7"/>
          <stop offset="40%" stopColor="#FFFFFF" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="fr-handle" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9AA0A8"/>
          <stop offset="40%" stopColor="#FFFFFF"/>
          <stop offset="65%" stopColor="#D8DEE5"/>
          <stop offset="100%" stopColor="#7C828A"/>
        </linearGradient>
        <radialGradient id="fr-bulb-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFF7B5" stopOpacity="0.95"/>
          <stop offset="50%" stopColor="#FFE066" stopOpacity="0.45"/>
          <stop offset="100%" stopColor="#FFE066" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fr-interior" cx="0.5" cy="0.15" r="0.95">
          <stop offset="0%" stopColor="#F5FBFF"/>
          <stop offset="55%" stopColor="#D8ECF8"/>
          <stop offset="100%" stopColor="#A6C8E0"/>
        </radialGradient>
      </defs>

      {/* === FLOOR SHADOW === */}
      <ellipse cx="120" cy="468" rx="92" ry="6" fill="#000" opacity="0.18"/>

      {/* === MAIN BODY === bold cartoon white fridge */}
      <rect x="14" y="14" width="212" height="442" rx="26" ry="26"
            fill="#FFFFFF" stroke="#1F1B14" strokeWidth="3.8"/>
      {/* Left edge cell-shade */}
      <rect x="14" y="14" width="40" height="442" rx="26"
            fill="url(#fr-body-shade)"/>
      {/* Top rim highlight */}
      <path d="M 28 18 Q 28 16 32 16 L 200 16 Q 220 16 220 28"
            fill="none" stroke="#FFFFFF" strokeWidth="2.4" opacity="0.85"/>
      {/* Faint vertical gloss reflection on right of body */}
      <rect x="190" y="20" width="14" height="420" rx="4"
            fill="url(#fr-body-gloss)" opacity="0.55"/>

      {/* === MAGNETS === colorful circles, decoration above shelves */}
      <g>
        <circle cx="64" cy="40" r="5" fill="#E84B6A" stroke="#1F1B14" strokeWidth="2"/>
        <circle cx="63" cy="38.5" r="1.8" fill="#FFFFFF" opacity="0.55"/>
        <circle cx="170" cy="36" r="5" fill="#F2C744" stroke="#1F1B14" strokeWidth="2"/>
        <circle cx="169" cy="34.5" r="1.8" fill="#FFFFFF" opacity="0.55"/>
        <circle cx="190" cy="50" r="5" fill="#7AC74F" stroke="#1F1B14" strokeWidth="2"/>
        <circle cx="189" cy="48.5" r="1.8" fill="#FFFFFF" opacity="0.55"/>
      </g>

      {/* === STICKY NOTE === yellow square top-left, small */}
      <g transform="rotate(-6 100 42)">
        <rect x="88" y="32" width="22" height="20" rx="1.5"
              fill="#FFE57F" stroke="#1F1B14" strokeWidth="1.6"/>
        <line x1="92" y1="40" x2="106" y2="40" stroke="#1F1B14" strokeWidth="0.9" opacity="0.5"/>
        <line x1="92" y1="44" x2="104" y2="44" stroke="#1F1B14" strokeWidth="0.9" opacity="0.5"/>
        <line x1="92" y1="48" x2="100" y2="48" stroke="#1F1B14" strokeWidth="0.9" opacity="0.5"/>
      </g>

      {/* === MAIN FRIDGE INTERIOR === bright cyan cartoon glow,
          spans MOST of the body height now (freezer moved to bottom) */}
      <rect x="30" y="68" width="180" height="270" rx="8"
            fill="url(#fr-interior)" stroke="#1F1B14" strokeWidth="2.6"/>

      {/* Light bulb fixture at top of interior */}
      <ellipse className="appliance-bulb"
               cx="120" cy="82" rx="76" ry="12"
               fill="url(#fr-bulb-glow)"/>
      <circle cx="120" cy="78" r="5" fill="#FFE066"
              stroke="#1F1B14" strokeWidth="1.8"/>
      <rect x="118" y="71" width="4" height="3" rx="0.5"
            fill="#9AA0A8" stroke="#1F1B14" strokeWidth="1.2"/>
      <g stroke="#F2C744" strokeWidth="1.8" strokeLinecap="round" opacity="0.85">
        <line x1="120" y1="68" x2="120" y2="64"/>
        <line x1="128" y1="73" x2="132" y2="71"/>
        <line x1="112" y1="73" x2="108" y2="71"/>
      </g>

      {/* === GLASS SHELVES === 3 shelves with visible thickness.
          Position math (matches the items overlay percentages):
          Interior visible from y=68 to y=338. 3 shelves divide the items
          area equally. Items area: y=98 (under bulb) to y=330. Each shelf
          gets (330-98)/3 = ~77 viewBox-y. Shelf lines at y=174, y=252, y=330. */}
      <rect x="30" y="171" width="180" height="6" rx="2"
            fill="#A6C8E0" stroke="#1F1B14" strokeWidth="2.2" opacity="0.78"/>
      <line x1="32" y1="173" x2="208" y2="173" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.85"/>

      <rect x="30" y="249" width="180" height="6" rx="2"
            fill="#A6C8E0" stroke="#1F1B14" strokeWidth="2.2" opacity="0.78"/>
      <line x1="32" y1="251" x2="208" y2="251" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.85"/>

      <rect x="30" y="327" width="180" height="6" rx="2"
            fill="#A6C8E0" stroke="#1F1B14" strokeWidth="2.2" opacity="0.78"/>
      <line x1="32" y1="329" x2="208" y2="329" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.85"/>

      {/* === FREEZER DIVIDER (now at the bottom) === */}
      <line x1="14" y1="346" x2="226" y2="346" stroke="#1F1B14" strokeWidth="3.4"/>
      <line x1="14" y1="350" x2="226" y2="350" stroke="#1F1B14" strokeWidth="0.8" opacity="0.4"/>

      {/* === FREEZER COMPARTMENT (BOTTOM) === LCD + snowflake */}
      <rect x="30" y="358" width="180" height="74" rx="10"
            fill="#EAF3FB" stroke="#1F1B14" strokeWidth="2.6"/>
      {/* Inset frosted highlight strip */}
      <rect x="34" y="362" width="172" height="14" rx="6"
            fill="#FFFFFF" opacity="0.55"/>
      {/* LCD readout — black with green digits */}
      <rect x="42" y="384" width="42" height="18" rx="3"
            fill="#1A2530" stroke="#0E1620" strokeWidth="0.6"/>
      <rect x="44" y="386" width="38" height="4" rx="1.5"
            fill="#5EE6A8" opacity="0.18"/>
      <text x="63" y="397" textAnchor="middle"
            fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="bold"
            fill="#5EE6A8">3°C</text>
      {/* "FREEZER" label next to LCD */}
      <text x="98" y="396" textAnchor="start"
            fontFamily="system-ui, sans-serif" fontSize="9" fontWeight="800"
            fill="#1F1B14" letterSpacing="2">FREEZER</text>
      {/* Snowflake — animated rotation */}
      <g className="appliance-snowflake" transform="translate(184 394)"
         stroke="#2B6CB0" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <line x1="-10" y1="0" x2="10" y2="0"/>
        <line x1="0" y1="-10" x2="0" y2="10"/>
        <line x1="-7" y1="-7" x2="7" y2="7"/>
        <line x1="-7" y1="7" x2="7" y2="-7"/>
        <circle cx="10" cy="0" r="1.2" fill="#2B6CB0" stroke="none"/>
        <circle cx="-10" cy="0" r="1.2" fill="#2B6CB0" stroke="none"/>
        <circle cx="0" cy="10" r="1.2" fill="#2B6CB0" stroke="none"/>
        <circle cx="0" cy="-10" r="1.2" fill="#2B6CB0" stroke="none"/>
      </g>
      {/* Freezer drawer pull */}
      <rect x="100" y="412" width="40" height="3" rx="1.5" fill="#1F1B14" opacity="0.5"/>

      {/* === LEFT HINGES === cylindrical pegs */}
      <circle cx="14" cy="80" r="5" fill="#9AA0A8" stroke="#1F1B14" strokeWidth="2.2"/>
      <circle cx="13" cy="78" r="1.5" fill="#FFFFFF" opacity="0.55"/>
      <circle cx="14" cy="396" r="5" fill="#9AA0A8" stroke="#1F1B14" strokeWidth="2.2"/>
      <circle cx="13" cy="394" r="1.5" fill="#FFFFFF" opacity="0.55"/>

      {/* === RIGHT HANDLE === chrome on the main fridge door (top section).
          Stops above the freezer compartment so it reads as the door handle. */}
      <rect x="218" y="78" width="14" height="252" rx="7"
            fill="url(#fr-handle)" stroke="#1F1B14" strokeWidth="2.4"/>
      <line x1="222" y1="98" x2="222" y2="312" stroke="#FFFFFF" strokeWidth="2" opacity="0.65"/>
      <rect x="216" y="74" width="18" height="6" rx="2"
            fill="#7C828A" stroke="#1F1B14" strokeWidth="1.8"/>
      <rect x="216" y="328" width="18" height="6" rx="2"
            fill="#7C828A" stroke="#1F1B14" strokeWidth="1.8"/>

      {/* === FEET === */}
      <ellipse cx="50" cy="456" rx="14" ry="6" fill="#5A6068" stroke="#1F1B14" strokeWidth="2"/>
      <rect x="36" y="446" width="28" height="10" rx="2" fill="#7C828A" stroke="#1F1B14" strokeWidth="2"/>
      <ellipse cx="190" cy="456" rx="14" ry="6" fill="#5A6068" stroke="#1F1B14" strokeWidth="2"/>
      <rect x="176" y="446" width="28" height="10" rx="2" fill="#7C828A" stroke="#1F1B14" strokeWidth="2"/>

      {/* itemCount badge intentionally removed per Brody 2026-05-05 */}
      {void itemCount}
    </svg>
  )
}

/**
 * Cartoon-illustrated wooden pantry SVG — distinct from the fridge. Wood-grain
 * cabinet body with two visible doors meeting in the middle, brass knobs at
 * the meeting point, decorative cornice up top, plank shelves with visible
 * grain, items sit on warm-amber illuminated shelves.
 */
function PantrySvg({ itemCount }: { itemCount: number }) {
  return (
    <svg viewBox="0 0 240 480" xmlns="http://www.w3.org/2000/svg"
         style={{ width: '100%', height: 'auto', display: 'block' }}
         aria-hidden="true">
      <defs>
        <pattern id="pa-wood" patternUnits="userSpaceOnUse" width="240" height="480">
          <rect width="240" height="480" fill="#D4A875"/>
          <path d="M 0 30 Q 60 28 120 32 T 240 32" stroke="#9F7340" strokeWidth="0.6" fill="none" opacity="0.6"/>
          <path d="M 0 60 Q 60 64 120 60 T 240 62" stroke="#9F7340" strokeWidth="0.5" fill="none" opacity="0.55"/>
          <path d="M 0 100 Q 60 96 120 100 T 240 98" stroke="#9F7340" strokeWidth="0.7" fill="none" opacity="0.5"/>
          <path d="M 0 140 Q 60 144 120 140 T 240 142" stroke="#9F7340" strokeWidth="0.4" fill="none" opacity="0.6"/>
          <path d="M 0 180 Q 60 176 120 180 T 240 178" stroke="#9F7340" strokeWidth="0.6" fill="none" opacity="0.5"/>
          <path d="M 0 220 Q 60 224 120 220 T 240 222" stroke="#9F7340" strokeWidth="0.5" fill="none" opacity="0.55"/>
          <path d="M 0 260 Q 60 256 120 260 T 240 258" stroke="#9F7340" strokeWidth="0.6" fill="none" opacity="0.5"/>
          <path d="M 0 300 Q 60 304 120 300 T 240 302" stroke="#9F7340" strokeWidth="0.4" fill="none" opacity="0.6"/>
          <path d="M 0 340 Q 60 336 120 340 T 240 338" stroke="#9F7340" strokeWidth="0.5" fill="none" opacity="0.5"/>
          <path d="M 0 380 Q 60 384 120 380 T 240 382" stroke="#9F7340" strokeWidth="0.6" fill="none" opacity="0.55"/>
          <path d="M 0 420 Q 60 416 120 420 T 240 418" stroke="#9F7340" strokeWidth="0.5" fill="none" opacity="0.5"/>
          {/* Knot detail */}
          <ellipse cx="60" cy="120" rx="3" ry="1.5" fill="#7C5828" opacity="0.3"/>
          <ellipse cx="180" cy="280" rx="2.5" ry="1.2" fill="#7C5828" opacity="0.3"/>
        </pattern>
        <radialGradient id="pa-interior" cx="0.5" cy="0.15" r="0.95">
          <stop offset="0%" stopColor="#FFF6DC"/>
          <stop offset="55%" stopColor="#F1DCA0"/>
          <stop offset="100%" stopColor="#C99857"/>
        </radialGradient>
        <radialGradient id="pa-knob" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="#F5D572"/>
          <stop offset="55%" stopColor="#C99014"/>
          <stop offset="100%" stopColor="#7C5828"/>
        </radialGradient>
        <linearGradient id="pa-shelf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C99014"/>
          <stop offset="50%" stopColor="#A07847"/>
          <stop offset="100%" stopColor="#7C5828"/>
        </linearGradient>
      </defs>

      {/* === FLOOR SHADOW === */}
      <ellipse cx="120" cy="468" rx="92" ry="6" fill="#000" opacity="0.22"/>

      {/* === DECORATIVE CORNICE === pediment up top */}
      <path d="M 8 22 L 232 22 L 224 8 L 16 8 Z"
            fill="#9F7340" stroke="#1F1B14" strokeWidth="2.6"/>
      <line x1="14" y1="14" x2="226" y2="14" stroke="#7C5828" strokeWidth="1.4" opacity="0.7"/>

      {/* === MAIN BODY === wooden cabinet */}
      <rect x="14" y="20" width="212" height="436" rx="6" ry="6"
            fill="url(#pa-wood)" stroke="#1F1B14" strokeWidth="3.8"/>

      {/* === DOOR SPLIT === vertical line down the middle */}
      <line x1="120" y1="22" x2="120" y2="454" stroke="#1F1B14" strokeWidth="2.2" opacity="0.85"/>
      <line x1="121.5" y1="24" x2="121.5" y2="452" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.4"/>

      {/* === LEFT DOOR PANEL DETAILS === inset rectangle */}
      <rect x="26" y="36" width="86" height="412" rx="3"
            fill="none" stroke="#7C5828" strokeWidth="1.4" opacity="0.6"/>
      {/* === RIGHT DOOR PANEL DETAILS === inset rectangle */}
      <rect x="128" y="36" width="86" height="412" rx="3"
            fill="none" stroke="#7C5828" strokeWidth="1.4" opacity="0.6"/>

      {/* === BRASS KNOBS === at meeting line, raised 3D look */}
      <g>
        {/* Left door knob */}
        <circle cx="110" cy="240" r="9" fill="url(#pa-knob)"
                stroke="#1F1B14" strokeWidth="2.4"/>
        <circle cx="107" cy="237" r="2.5" fill="#FFE7A8" opacity="0.85"/>
        {/* Right door knob */}
        <circle cx="130" cy="240" r="9" fill="url(#pa-knob)"
                stroke="#1F1B14" strokeWidth="2.4"/>
        <circle cx="127" cy="237" r="2.5" fill="#FFE7A8" opacity="0.85"/>
      </g>

      {/* === CABINET CUTAWAY (interior visible) === warm interior */}
      <rect x="30" y="60" width="180" height="376" rx="4"
            fill="url(#pa-interior)" stroke="#1F1B14" strokeWidth="2.6"/>

      {/* Subtle interior glow */}
      <ellipse cx="120" cy="80" rx="80" ry="14"
               fill="#FFF6DC" opacity="0.6"/>

      {/* === WOODEN SHELVES === plank-style with grain. y=156, 256, 356
          aligns with the Appliance items overlay percentages. */}
      <rect x="30" y="153" width="180" height="8" rx="1"
            fill="url(#pa-shelf)" stroke="#1F1B14" strokeWidth="2.2"/>
      <line x1="32" y1="155" x2="208" y2="155" stroke="#FFE7A8" strokeWidth="0.6" opacity="0.5"/>
      <line x1="34" y1="158" x2="206" y2="158" stroke="#5C3D14" strokeWidth="0.4" opacity="0.5"/>

      <rect x="30" y="253" width="180" height="8" rx="1"
            fill="url(#pa-shelf)" stroke="#1F1B14" strokeWidth="2.2"/>
      <line x1="32" y1="255" x2="208" y2="255" stroke="#FFE7A8" strokeWidth="0.6" opacity="0.5"/>
      <line x1="34" y1="258" x2="206" y2="258" stroke="#5C3D14" strokeWidth="0.4" opacity="0.5"/>

      <rect x="30" y="353" width="180" height="8" rx="1"
            fill="url(#pa-shelf)" stroke="#1F1B14" strokeWidth="2.2"/>
      <line x1="32" y1="355" x2="208" y2="355" stroke="#FFE7A8" strokeWidth="0.6" opacity="0.5"/>
      <line x1="34" y1="358" x2="206" y2="358" stroke="#5C3D14" strokeWidth="0.4" opacity="0.5"/>

      {/* === BOTTOM DRAWER === */}
      <rect x="30" y="402" width="180" height="32" rx="3"
            fill="#A07847" stroke="#1F1B14" strokeWidth="2.2"/>
      <rect x="34" y="406" width="172" height="24" rx="2"
            fill="none" stroke="#7C5828" strokeWidth="1" opacity="0.7"/>
      {/* Small brass drawer pull */}
      <rect x="106" y="416" width="28" height="6" rx="2"
            fill="url(#pa-knob)" stroke="#1F1B14" strokeWidth="1.6"/>

      {/* === FEET === */}
      <ellipse cx="50" cy="456" rx="14" ry="6" fill="#5C3D14" stroke="#1F1B14" strokeWidth="2"/>
      <rect x="36" y="446" width="28" height="10" rx="2" fill="#7C5828" stroke="#1F1B14" strokeWidth="2"/>
      <ellipse cx="190" cy="456" rx="14" ry="6" fill="#5C3D14" stroke="#1F1B14" strokeWidth="2"/>
      <rect x="176" y="446" width="28" height="10" rx="2" fill="#7C5828" stroke="#1F1B14" strokeWidth="2"/>

      {/* itemCount badge removed per Brody 2026-05-05 */}
      {void itemCount}
    </svg>
  )
}

/**
 * Appliance: combines the cartoon SVG body with an HTML overlay of items
 * positioned over the SVG shelves. Auto-grows up to 3 shelves of 3 items each;
 * empty shelves stay visible (suggesting "more capacity" so the user feels
 * like they can add more).
 */
function Appliance({ kind, items, onRemove, learnedShelfLife }: {
  kind: 'fridge' | 'pantry'
  items: FridgeItem[]
  onRemove: (name: string, zone: Zone) => void
  learnedShelfLife: ShelfLifeMap
}) {
  const fridge = kind === 'fridge'
  const PER_SHELF = 3
  const TOTAL_SHELVES = 3
  // Auto-fill shelves left to right. Empty shelves still render so the user
  // sees there's room for more.
  const shelves: FridgeItem[][] = Array.from({ length: TOTAL_SHELVES }, (_, i) =>
    items.slice(i * PER_SHELF, (i + 1) * PER_SHELF),
  )
  const zoneId: Zone = fridge ? 'fridge' : 'pantry'

  // Items overlay alignment with SVG shelves. viewBox is 240w × 480h.
  //   FRIDGE: freezer is at the BOTTOM now (per Brody 2026-05-05).
  //     Interior y=68..338. Shelf lines at y=174, 252, 330.
  //     Items area = under bulb (y=98) → last shelf (y=330).
  //   PANTRY: shelves at y=156, 256, 356. Items area = y=80 → y=356.
  const itemsTopPct    = fridge ? (98  / 480) * 100 : (80  / 480) * 100
  const itemsBottomPct = fridge ? ((480 - 330) / 480) * 100 : ((480 - 356) / 480) * 100

  return (
    <div style={{
      maxWidth: 320,
      margin: '0 auto 28px',
      position: 'relative',
      filter: `drop-shadow(0 18px 20px rgba(0,0,0,0.28)) drop-shadow(0 6px 8px rgba(0,0,0,0.18))`,
    }}>
      {/* The cartoon body */}
      {fridge ? <FridgeSvg itemCount={items.length} /> : <PantrySvg itemCount={items.length} />}

      {/* Items overlay — 3 shelves × 3 slots, items positioned over the SVG
          shelves. Items align to flex-end so they sit ON the shelf line.
          Empty slots still render so the appliance shows it has more room. */}
      <div style={{
        position: 'absolute',
        top: `${itemsTopPct}%`,
        bottom: `${itemsBottomPct}%`,
        left: '12.5%',
        right: '12.5%',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
      }}>
        {shelves.map((shelfItems, shelfIdx) => (
          <div key={shelfIdx} style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: `repeat(${PER_SHELF}, 1fr)`,
            alignItems: 'flex-end',
            paddingBottom: 2,
            position: 'relative',
            pointerEvents: 'auto',
          }}>
            {shelfItems.map((item, i) => (
              <ApplianceItem
                key={i}
                item={item}
                zone={zoneId}
                onTap={() => onRemove(item.name, zoneId)}
                learnedDays={learnedShelfLife[item.name]}
                idx={shelfIdx * PER_SHELF + i}
              />
            ))}
            {Array.from({ length: PER_SHELF - shelfItems.length }).map((_, i) => (
              <div key={`pad-${i}`} aria-hidden="true" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ApplianceItem — single item rendered on an appliance shelf. Uses the same
 * Noto icon + name as ItemCard, plus a soft elliptical drop-shadow on the
 * shelf surface to anchor it in 3D and a hover-lift micro-interaction.
 *
 * Re-implements the freshness urgency badge (OLD / SOON) so we don't lose the
 * spoilage signals from the old grid view.
 */
function ApplianceItem({ item, zone, onTap, learnedDays, idx }: {
  item: FridgeItem
  zone: Zone
  onTap: () => void
  learnedDays?: { avg_days: number; sample_count: number }
  idx: number
}) {
  const age = daysOld(item.added)
  const shelfDays = learnedDays?.avg_days ?? SHELF_LIFE[zone]
  const pct = Math.min(age / shelfDays, 1)
  const isOld = pct >= 0.85
  const isWarn = pct >= 0.55 && !isOld
  const dim = getItemDim(item.name)
  const rotation = getItemRotation(item.name)
  return (
    <button
      onClick={onTap}
      className="appliance-item"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        position: 'relative',
        WebkitTapHighlightColor: 'transparent',
        // Stagger drop-in animation per index — items "fall" onto the shelf
        // when the appliance first paints. 60ms per item, smooth ease-out.
        animation: `applianceItemDrop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both`,
        animationDelay: `${idx * 70}ms`,
      }}
    >
      {isOld && (
        <span style={{
          position: 'absolute', top: -4, right: 0, zIndex: 2,
          background: '#E63946', color: '#fff', fontSize: 8.5, fontWeight: 800,
          letterSpacing: '0.05em', borderRadius: 4, padding: '1px 4px',
          boxShadow: '0 1px 3px rgba(230,57,70,0.4)',
        }}>OLD</span>
      )}
      {isWarn && !isOld && (
        <span style={{
          position: 'absolute', top: -4, right: 0, zIndex: 2,
          background: '#F4A93D', color: '#fff', fontSize: 8.5, fontWeight: 800,
          letterSpacing: '0.05em', borderRadius: 4, padding: '1px 4px',
          boxShadow: '0 1px 3px rgba(244,169,61,0.4)',
        }}>SOON</span>
      )}

      {/* Rotation wrapper — static, holds the item's per-name rotation lean.
          Inside, a separate breathing wrapper animates scale only so it
          composes cleanly with the rotation. */}
      <div style={{
        position: 'relative',
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'bottom center',
      }}>
        {/* Soft elliptical shadow pressed into the shelf surface, BELOW the
            rotation so the shadow stays grounded as item leans */}
        <span aria-hidden="true" style={{
          position: 'absolute', bottom: -2, left: '50%',
          transform: 'translateX(-50%)',
          width: dim.size * 0.78,
          height: 5,
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 65%)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
        <div
          className="appliance-icon-wrap"
          style={{
            position: 'relative',
            width: dim.size + 8,
            height: dim.size + 8,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            // Idle breathing — items gently scale up/down to feel alive
            animation: `applianceItemBreathe ${5 + (idx % 3)}s ease-in-out ${idx * 0.4}s infinite`,
          }}
        >
          {/* The icon itself with a soft cast shadow downward */}
          <div style={{
            position: 'relative',
            filter: 'drop-shadow(0 3px 2px rgba(0,0,0,0.20)) drop-shadow(0 1px 0 rgba(255,255,255,0.4))',
          }}>
            <NotoIcon name={item.name} size={dim.size} />
          </div>
        </div>
      </div>

      {/* Item name — slightly bigger now items are bigger */}
      <span style={{
        fontSize: 9.5, fontWeight: 600,
        color: 'rgba(0,0,0,0.72)',
        marginTop: 1, lineHeight: 1.2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: '100%', padding: '0 2px',
      }}>
        {item.name}
      </span>
    </button>
  )
}

/**
 * Legacy zone section — kept for freezer + condiments which we don't render
 * as full appliances (they're typically empty / sparse and the grid still
 * reads well for them).
 */
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

        {/* ── Appliance views ── fridge + pantry get the cozy 3D doll-house
            treatment. Freezer + condiments fall back to the legacy grid since
            they're usually empty/sparse and the appliance metaphor is overkill. */}
        {data.fridge.length > 0 && (
          <Appliance
            kind="fridge"
            items={data.fridge}
            onRemove={(name, z) => setRemoveModal({ name, zone: z })}
            learnedShelfLife={learnedShelfLife}
          />
        )}
        {data.pantry.length > 0 && (
          <Appliance
            kind="pantry"
            items={data.pantry}
            onRemove={(name, z) => setRemoveModal({ name, zone: z })}
            learnedShelfLife={learnedShelfLife}
          />
        )}
        {(['freezer', 'condiments'] as Zone[]).map(zone => {
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
