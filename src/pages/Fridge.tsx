import { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../api/client'
import type { FridgeData, FridgeItem, Meal, MealDetail, ScanResult, ScannedItem, ShelfLifeMap, SlotMap, SlotPos, FridgeItemDetail } from '../api/client'
import { showToast } from '../toast'
import { computeAteMacros } from '../lib/ate-macros'
import {
  DndContext, useDraggable, useDroppable, DragOverlay, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'

type Zone = 'fridge' | 'pantry' | 'condiments' | 'freezer'

// Estimated shelf life per zone (days)
const SHELF_LIFE: Record<Zone, number> = {
  fridge: 7, freezer: 90, pantry: 180, condiments: 365,
}

const STAPLES = ['eggs', 'milk', 'chicken', 'rice', 'yogurt', 'spinach', 'banana', 'oats']

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

// getFoodTint, freshnessColor, quantityBarColor removed alongside ItemCard
// — only the cartoon-SVG Appliance render path remains, which doesn't use
// these per-item color helpers. SOON/OLD freshness signals are inline in
// ApplianceItem.

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

function formatGrams(g: number): string {
  // 1500 → "1.5kg"; 800 → "800g"; 0 → "0g"
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10000 ? 0 : 1).replace(/\.0$/, '')}kg`
  return `${Math.round(g)}g`
}

// ItemCard removed alongside ZoneSection in audit P2-11 — all four
// zones now use the cartoon-SVG Appliance + ApplianceItem render path.

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
      {/* Audit P0-4: was '3°C' (fridge temp on a freezer compartment).
          Standard freezer is around -18°C. */}
      <text x="63" y="397" textAnchor="middle"
            fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="bold"
            fill="#5EE6A8">-18°</text>
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
        <linearGradient id="pa-top-shadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F1B14" stopOpacity="0.32"/>
          <stop offset="100%" stopColor="#1F1B14" stopOpacity="0"/>
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

      {/* === OPEN-FACED CABINET INTERIOR === no doors, just a wooden frame
          surrounding the shelves. Earlier revision had a closed-door split,
          panel insets, and brass knobs drawn behind the interior cutaway —
          they peeked through above and below the cutaway and read as a
          confused metaphor (closed doors AND open shelves at once). */}
      <rect x="30" y="50" width="180" height="386" rx="4"
            fill="url(#pa-interior)" stroke="#1F1B14" strokeWidth="2.6"/>

      {/* Inner shadow at the top of the cabinet so the interior reads
          three-dimensional — wood frame casts a soft shadow into the open
          cavity. */}
      <rect x="30" y="50" width="180" height="16" rx="4"
            fill="url(#pa-top-shadow)" pointerEvents="none"/>

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

      {/* Bottom drawer removed (audit P2-1). After the doors-removed polish
          this read as a closed drawer base under an otherwise open-faced
          cabinet — inconsistent metaphor. The wooden frame edge below the
          interior cutaway gives enough bottom-grounding without the drawer. */}

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
 * Standalone freezer cabinet — slim, frosted-blue, with a small LCD reading
 * -18°C up top and three internal shelves at y=160, 260, 360 to align with
 * the items overlay (top=100, bottom=120 from base of 480). Same 240×480
 * viewBox as fridge + pantry so the Appliance overlay positioning works.
 */
function FreezerSvg({ itemCount }: { itemCount: number }) {
  return (
    <svg viewBox="0 0 240 480" xmlns="http://www.w3.org/2000/svg"
         style={{ width: '100%', height: 'auto', display: 'block' }}
         aria-hidden="true">
      <defs>
        <linearGradient id="fz-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#D4E5F2"/>
          <stop offset="50%" stopColor="#E9F2FA"/>
          <stop offset="100%" stopColor="#B8CFE0"/>
        </linearGradient>
        <linearGradient id="fz-handle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9FB3C8"/>
          <stop offset="50%" stopColor="#E0E8F0"/>
          <stop offset="100%" stopColor="#7989A0"/>
        </linearGradient>
        <radialGradient id="fz-interior" cx="0.5" cy="0.15" r="0.95">
          <stop offset="0%" stopColor="#FFFFFF"/>
          <stop offset="55%" stopColor="#E8F0F8"/>
          <stop offset="100%" stopColor="#A0BFD8"/>
        </radialGradient>
        <linearGradient id="fz-shelf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B8D0E0" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#90AEC4" stopOpacity="0.7"/>
        </linearGradient>
        <linearGradient id="fz-top-shadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F3548" stopOpacity="0.28"/>
          <stop offset="100%" stopColor="#1F3548" stopOpacity="0"/>
        </linearGradient>
      </defs>

      {/* Floor shadow */}
      <ellipse cx="120" cy="468" rx="86" ry="6" fill="#000" opacity="0.18"/>

      {/* Cabinet body */}
      <rect x="20" y="20" width="200" height="436" rx="14"
            fill="url(#fz-body)" stroke="#1F3548" strokeWidth="3"/>

      {/* Top control panel — chrome strip + LCD */}
      <rect x="34" y="32" width="172" height="32" rx="6"
            fill="#1A2530" stroke="#0E1620" strokeWidth="1.4"/>
      <rect x="38" y="36" width="60" height="24" rx="3" fill="#0E1620"/>
      <text x="68" y="53" textAnchor="middle"
            fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="bold"
            fill="#5EE6A8">-18°</text>
      <text x="110" y="53" textAnchor="start"
            fontFamily="system-ui, sans-serif" fontSize="9" fontWeight="800"
            fill="#5EE6A8" letterSpacing="2">FREEZER</text>
      {/* Snowflake icon next to label */}
      <g transform="translate(195 48)" stroke="#5EE6A8" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <line x1="-6" y1="0" x2="6" y2="0"/>
        <line x1="0" y1="-6" x2="0" y2="6"/>
        <line x1="-4" y1="-4" x2="4" y2="4"/>
        <line x1="-4" y1="4" x2="4" y2="-4"/>
      </g>

      {/* Open-faced interior cavity */}
      <rect x="32" y="80" width="176" height="380" rx="6"
            fill="url(#fz-interior)" stroke="#1F3548" strokeWidth="2.2"/>

      {/* Top inner shadow */}
      <rect x="32" y="80" width="176" height="14" rx="6"
            fill="url(#fz-top-shadow)" pointerEvents="none"/>

      {/* Frost crystals — decorative, around interior corners */}
      <g stroke="#FFFFFF" strokeWidth="1" fill="none" opacity="0.7">
        <path d="M 38 90 L 42 86 M 40 88 L 44 92"/>
        <path d="M 200 88 L 196 92 M 202 90 L 198 86"/>
        <path d="M 38 450 L 42 446 M 40 448 L 44 452"/>
        <path d="M 200 448 L 196 452 M 202 450 L 198 446"/>
      </g>
      <circle cx="50" cy="100" r="1.4" fill="#FFFFFF" opacity="0.85"/>
      <circle cx="190" cy="120" r="1.2" fill="#FFFFFF" opacity="0.7"/>
      <circle cx="60" cy="430" r="1.1" fill="#FFFFFF" opacity="0.7"/>
      <circle cx="180" cy="440" r="1.4" fill="#FFFFFF" opacity="0.85"/>

      {/* Three glass-look shelves at y=156, 256, 356 (same as pantry/fridge) */}
      <rect x="40" y="156" width="160" height="4" rx="1.5"
            fill="url(#fz-shelf)" stroke="#1F3548" strokeWidth="1.5"/>
      <rect x="40" y="256" width="160" height="4" rx="1.5"
            fill="url(#fz-shelf)" stroke="#1F3548" strokeWidth="1.5"/>
      <rect x="40" y="356" width="160" height="4" rx="1.5"
            fill="url(#fz-shelf)" stroke="#1F3548" strokeWidth="1.5"/>

      {/* Side handle */}
      <rect x="206" y="200" width="6" height="80" rx="3"
            fill="url(#fz-handle)" stroke="#1F3548" strokeWidth="1.4"/>

      {/* Feet */}
      <rect x="36" y="456" width="20" height="8" rx="2" fill="#5C7080" stroke="#1F3548" strokeWidth="1.6"/>
      <rect x="184" y="456" width="20" height="8" rx="2" fill="#5C7080" stroke="#1F3548" strokeWidth="1.6"/>

      {void itemCount}
    </svg>
  )
}

/**
 * Wall-mounted spice rack — wooden tones matching the pantry, three small
 * shelves with rails so bottles "lean against" the back. Same 240×480
 * viewBox; shelves at y=150, 250, 350 to align with the items overlay.
 */
function CondimentsSvg({ itemCount }: { itemCount: number }) {
  return (
    <svg viewBox="0 0 240 480" xmlns="http://www.w3.org/2000/svg"
         style={{ width: '100%', height: 'auto', display: 'block' }}
         aria-hidden="true">
      <defs>
        <pattern id="cd-wood" patternUnits="userSpaceOnUse" width="240" height="480">
          <rect width="240" height="480" fill="#B8884C"/>
          <path d="M 0 60 Q 60 56 120 60 T 240 58" stroke="#7C5828" strokeWidth="0.6" fill="none" opacity="0.5"/>
          <path d="M 0 140 Q 60 144 120 140 T 240 142" stroke="#7C5828" strokeWidth="0.5" fill="none" opacity="0.55"/>
          <path d="M 0 220 Q 60 216 120 220 T 240 218" stroke="#7C5828" strokeWidth="0.6" fill="none" opacity="0.5"/>
          <path d="M 0 300 Q 60 304 120 300 T 240 302" stroke="#7C5828" strokeWidth="0.5" fill="none" opacity="0.55"/>
          <path d="M 0 380 Q 60 376 120 380 T 240 378" stroke="#7C5828" strokeWidth="0.6" fill="none" opacity="0.5"/>
        </pattern>
        <linearGradient id="cd-shelf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9F7340"/>
          <stop offset="50%" stopColor="#7C5828"/>
          <stop offset="100%" stopColor="#5C3D14"/>
        </linearGradient>
        <linearGradient id="cd-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F1DCA0"/>
          <stop offset="100%" stopColor="#D4A875"/>
        </linearGradient>
      </defs>

      {/* Floor shadow */}
      <ellipse cx="120" cy="468" rx="78" ry="5" fill="#000" opacity="0.16"/>

      {/* Mounting board (wall plate) */}
      <rect x="36" y="40" width="168" height="400" rx="6"
            fill="url(#cd-back)" stroke="#1F1B14" strokeWidth="2.6"/>

      {/* Outer wooden frame */}
      <rect x="30" y="34" width="180" height="412" rx="8"
            fill="none" stroke="#1F1B14" strokeWidth="3"/>
      <rect x="30" y="34" width="180" height="412" rx="8"
            fill="url(#cd-wood)" opacity="0.18"/>

      {/* Decorative top trim */}
      <rect x="34" y="38" width="172" height="6" rx="2"
            fill="url(#cd-shelf)" stroke="#1F1B14" strokeWidth="1"/>
      <rect x="34" y="438" width="172" height="6" rx="2"
            fill="url(#cd-shelf)" stroke="#1F1B14" strokeWidth="1"/>

      {/* Three shelves with front rails (bottles lean on them) */}
      {/* Shelf 1 — y=150 */}
      <rect x="38" y="148" width="164" height="6" rx="1.5"
            fill="url(#cd-shelf)" stroke="#1F1B14" strokeWidth="1.6"/>
      <line x1="38" y1="160" x2="202" y2="160" stroke="#1F1B14" strokeWidth="0.8" opacity="0.7"/>

      {/* Shelf 2 — y=250 */}
      <rect x="38" y="248" width="164" height="6" rx="1.5"
            fill="url(#cd-shelf)" stroke="#1F1B14" strokeWidth="1.6"/>
      <line x1="38" y1="260" x2="202" y2="260" stroke="#1F1B14" strokeWidth="0.8" opacity="0.7"/>

      {/* Shelf 3 — y=350 */}
      <rect x="38" y="348" width="164" height="6" rx="1.5"
            fill="url(#cd-shelf)" stroke="#1F1B14" strokeWidth="1.6"/>
      <line x1="38" y1="360" x2="202" y2="360" stroke="#1F1B14" strokeWidth="0.8" opacity="0.7"/>

      {/* Hanging brackets at the corners */}
      <circle cx="44" cy="46" r="3" fill="#1F1B14"/>
      <circle cx="196" cy="46" r="3" fill="#1F1B14"/>

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
const PER_SHELF = 3
const TOTAL_SHELVES = 3

/**
 * Build a 3×3 grid of items for a zone from the slot map. Items the user has
 * placed go to their explicit slot. Items that have NO slot entry yet (newly
 * added) get the first free `(shelf, col)` scanning left→right top→bottom,
 * so a freshly added thing always shows up somewhere visible without
 * needing a server round-trip.
 */
function buildShelfGrid(items: FridgeItem[], slots: SlotMap, zone: Zone): (FridgeItem | null)[][] {
  const grid: (FridgeItem | null)[][] = Array.from({ length: TOTAL_SHELVES }, () =>
    Array.from({ length: PER_SHELF }, () => null))

  const placed = new Set<string>()
  for (const item of items) {
    const pos = slots[item.name]
    if (pos && pos.zone === zone && pos.shelf >= 0 && pos.shelf < TOTAL_SHELVES
              && pos.col >= 0 && pos.col < PER_SHELF
              && !grid[pos.shelf][pos.col]) {
      grid[pos.shelf][pos.col] = item
      placed.add(item.name)
    }
  }

  for (const item of items) {
    if (placed.has(item.name)) continue
    outer:
    for (let s = 0; s < TOTAL_SHELVES; s++) {
      for (let c = 0; c < PER_SHELF; c++) {
        if (!grid[s][c]) {
          grid[s][c] = item
          placed.add(item.name)
          break outer
        }
      }
    }
    // If both 3×3 grids are full and there are extra items, they fall off-screen.
    // Acceptable: a 9-slot appliance is a real physical limit.
  }
  return grid
}

function Appliance({ kind, items, slots, learnedShelfLife, activeDragName, onTapItem }: {
  kind: Zone
  items: FridgeItem[]
  slots: SlotMap
  learnedShelfLife: ShelfLifeMap
  activeDragName: string | null
  onTapItem: (name: string, zone: Zone) => void
}) {
  const zoneId: Zone = kind
  const grid = buildShelfGrid(items, slots, zoneId)

  // Items overlay alignment with each SVG body. All four use the same
  // 240×480 viewBox so the Appliance React tree is identical, but each
  // SVG positions its shelves at different y-coordinates.
  const overlay: Record<Zone, { top: number; bottom: number }> = {
    fridge:     { top: 98 / 480 * 100, bottom: (480 - 330) / 480 * 100 },
    pantry:     { top: 80 / 480 * 100, bottom: (480 - 356) / 480 * 100 },
    freezer:    { top: 100 / 480 * 100, bottom: (480 - 360) / 480 * 100 },
    condiments: { top: 90 / 480 * 100, bottom: (480 - 350) / 480 * 100 },
  }
  const itemsTopPct = overlay[kind].top
  const itemsBottomPct = overlay[kind].bottom

  const zoneLabel = ZONE_CONFIG[kind].label

  return (
    <div style={{
      maxWidth: 320,
      margin: '0 auto 28px',
      position: 'relative',
      filter: `drop-shadow(0 18px 20px rgba(0,0,0,0.28)) drop-shadow(0 6px 8px rgba(0,0,0,0.18))`,
    }}>
      {/* Zone label + item count badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{zoneLabel}</span>
        <span style={{
          background: ZONE_CONFIG[kind].accent, color: '#fff',
          fontSize: 11, fontWeight: 700, borderRadius: 10,
          padding: '1px 8px', minWidth: 22, textAlign: 'center',
        }}>{items.length}</span>
      </div>
      {kind === 'fridge' && <FridgeSvg itemCount={items.length} />}
      {kind === 'pantry' && <PantrySvg itemCount={items.length} />}
      {kind === 'freezer' && <FreezerSvg itemCount={items.length} />}
      {kind === 'condiments' && <CondimentsSvg itemCount={items.length} />}

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
        {grid.map((shelf, shelfIdx) => (
          <div key={shelfIdx} style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: `repeat(${PER_SHELF}, 1fr)`,
            alignItems: 'flex-end',
            paddingBottom: 2,
            position: 'relative',
            pointerEvents: 'auto',
          }}>
            {shelf.map((item, col) => (
              <DroppableSlot
                key={`${shelfIdx}-${col}`}
                zone={zoneId}
                shelf={shelfIdx}
                col={col}
              >
                {item && item.name !== activeDragName && (
                  <DraggableApplianceItem
                    item={item}
                    zone={zoneId}
                    learnedDays={learnedShelfLife[item.name]}
                    idx={shelfIdx * PER_SHELF + col}
                    onTap={() => onTapItem(item.name, zoneId)}
                  />
                )}
              </DroppableSlot>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function DroppableSlot({ zone, shelf, col, children }: {
  zone: Zone
  shelf: number
  col: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${zone}:${shelf}:${col}`,
    data: { zone, shelf, col },
  })
  return (
    <div ref={setNodeRef} style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      borderRadius: 8,
      transition: 'background 120ms ease, box-shadow 120ms ease',
      background: isOver ? 'rgba(99,102,241,0.18)' : 'transparent',
      boxShadow: isOver ? 'inset 0 0 0 1.5px rgba(99,102,241,0.55)' : 'none',
    }}>
      {children}
    </div>
  )
}

/**
 * Wraps ApplianceItem with dnd-kit's useDraggable. PointerSensor with an
 * 8px activation distance means a tap (<8px movement) doesn't start a drag,
 * so the existing tap handler keeps its tap-to-open-modal behavior.
 */
function DraggableApplianceItem({ item, zone, learnedDays, idx, onTap }: {
  item: FridgeItem
  zone: Zone
  learnedDays?: { avg_days: number; sample_count: number }
  idx: number
  onTap: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${item.name}`,
    data: { name: item.name, zone },
  })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        opacity: isDragging ? 0 : 1, // hide source; DragOverlay shows the floating ghost
        touchAction: 'none', // mobile drag — don't let scroll grab it
      }}>
      <ApplianceItem
        item={item}
        zone={zone}
        learnedDays={learnedDays}
        idx={idx}
        onTap={onTap}
      />
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
  onTap?: () => void
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

      {/* No on-card label — Noto icons are recognizable enough on their own,
          and the cluttered text under each tile read as cheap. Tap to see
          the item's full name + details in the modal. */}
    </button>
  )
}

/**
 * Legacy zone section — kept for freezer + condiments which we don't render
 * as full appliances (they're typically empty / sparse and the grid still
 * reads well for them).
 */
// ZoneSection (legacy flat grid for freezer/condiments) removed in audit
// P2-11 fix: those zones now use the cartoon SVG Appliance like fridge +
// pantry. ItemCard kept as it's still referenced from the modal /
// removal flow internals.

/**
 * Rich product page bottom-sheet — replaces the old bare Remove? sheet.
 * Loads from GET /fridge/item/{name} on open. Renders gracefully when
 * enrichment is missing (skeleton → "no nutrition data yet" state).
 */
function ItemDetailModal({ name, zone, onClose, onRemove }: {
  name: string
  zone: Zone
  onClose: () => void
  // Receives the CANONICAL stored name (from /fridge/item GET) when available
  // — guards against the card showing one casing/spelling and the backend
  // exact-match needing the other. Falls back to the prop name on cold open.
  onRemove: (canonicalName: string) => void
}) {
  const [detail, setDetail] = useState<FridgeItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reEnriching, setReEnriching] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getFridgeItem(name)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => { if (!cancelled) setError(String(err?.message || err)) })
    return () => { cancelled = true }
  }, [name])

  async function reEnrich() {
    setReEnriching(true)
    try {
      const r = await api.enrichItem({ name, force: true })
      // Re-pull the merged item so we render the full payload (item-detail
      // includes recent_prices + zone, which /enrich doesn't return).
      const fresh = await api.getFridgeItem(name)
      setDetail(fresh)
      showToast(`Updated ${name}${r.meta.confidence === 'high' ? '' : ' (best guess)'}`, 'info')
    } catch {
      showToast('Re-enrich failed', 'err')
    } finally {
      setReEnriching(false)
    }
  }

  // computeAteMacros lives in src/lib/ate-macros.ts so it can be unit-tested
  // without dragging in the React module tree.

  function mealForNow(): 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner' {
    const h = new Date().getHours()
    if (h < 11) return 'Breakfast'
    if (h < 15) return 'Lunch'
    if (h < 18) return 'Snack'
    return 'Dinner'
  }

  // "I ate it" — log estimated macros to today, then remove from fridge.
  // Common path because Brody (and likely anyone) often removes items
  // because they ate them but didn't track the macros (audit feedback
  // 2026-05-06). When we can't estimate (no nutrition data), still remove
  // — the alternative is forcing the user to use the camera flow first,
  // which slows down a fridge cleanup pass.
  async function ateAndRemove() {
    if (!detail) { onRemove(name); return }
    const macros = computeAteMacros(detail)
    if (macros) {
      try {
        await api.addFood({
          meal: mealForNow(),
          description: macros.portion_g === 100 ? detail.name : `${macros.portion_g}g ${detail.name}`,
          kcal: macros.kcal,
          protein_g: macros.protein_g,
        })
        showToast(`Logged ${detail.name} (~${macros.kcal} kcal, ${macros.protein_g}g protein)`)
      } catch (err) {
        // Don't remove on log failure — the user wanted "log AND remove";
        // doing only the remove silently loses the macros. Surface the
        // error so they can retry instead of getting half the action.
        showToast(`Couldn't log — ${String(err).slice(0, 60)}`, 'err')
        return
      }
    } else {
      showToast('Removed (couldn’t estimate macros — no nutrition data)', 'info')
    }
    onRemove(detail.name)
  }

  const photo = detail?.photo_url || null
  const zoneCfg = ZONE_CONFIG[detail?.zone || zone]
  const nutri = detail?.nutrition_per_100g || null
  const slot = detail?.slot || null
  const age = detail ? daysOld(detail.added) : 0
  const shelfDays = SHELF_LIFE[detail?.zone || zone]
  const freshnessPct = Math.min(age / shelfDays, 1)
  const daysLeft = Math.max(0, Math.ceil(shelfDays - age))

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Details for ${name}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300,
        display: 'flex', alignItems: 'flex-end',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '20px 20px 0 0',
        padding: '14px 20px 32px', width: '100%', maxHeight: '92vh', overflowY: 'auto',
        animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)', position: 'relative',
      }}>
        <button className="sheet-close" onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 14, right: 16, zIndex: 2 }}>×</button>
        <div style={{ width: 36, height: 5, background: 'var(--gray4)', borderRadius: 3, margin: '2px auto 14px' }} />

        {/* ── Header: photo + name + brand + size ── */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{
            width: 96, height: 96, flexShrink: 0,
            borderRadius: 14, background: 'var(--gray6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}>
            {photo ? (
              <img src={photo} alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <NotoIcon name={detail?.name || name} size={68} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 28 }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.3px' }}>
              {detail?.name || name}
            </div>
            {detail?.brand && (
              <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 2, fontWeight: 500 }}>
                {detail.brand}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {detail?.size && <span>{detail.size}</span>}
              {detail?.size && detail?.packaging && <span style={{ opacity: 0.5 }}>·</span>}
              {detail?.packaging && <span style={{ textTransform: 'capitalize' }}>{detail.packaging}</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--label3)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: zoneCfg.accent }} />
              <span>{zoneCfg.label}</span>
              {slot && <span style={{ opacity: 0.5 }}>·</span>}
              {slot && <span>Shelf {slot.shelf + 1}, slot {slot.col + 1}</span>}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#FFEFEC', color: 'var(--red)', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
            Couldn't load details — {error}
          </div>
        )}

        {/* ── Freshness ── */}
        <Section label="Freshness">
          <div style={{ fontSize: 13, color: 'var(--label2)', marginBottom: 6 }}>
            {detail?.added ? <>Added {detail.added} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</> : 'Newly added'}
          </div>
          <div style={{ height: 6, borderRadius: 4, background: 'var(--gray6)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(8, freshnessPct * 100)}%`,
              height: '100%',
              background: freshnessPct >= 0.85 ? 'var(--red)'
                       : freshnessPct >= 0.55 ? 'var(--orange)'
                       : 'var(--green)',
              transition: 'width 200ms ease',
            }} />
          </div>
        </Section>

        {/* ── Nutrition ── skeleton while fetching, hidden once we know there's nothing to show */}
        {!detail && !error && (
          <Section label="Nutrition">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{ height: 56, background: 'var(--gray6)', borderRadius: 10, animation: 'pulse 1.4s ease-in-out infinite' }} />
              ))}
            </div>
          </Section>
        )}
        {detail && nutri && (
          <Section label="Nutrition (per 100g)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {[
                { label: 'kcal',    value: nutri.kcal,       color: 'var(--blue)' },
                { label: 'protein', value: nutri.protein_g,  color: 'var(--orange)', suffix: 'g' },
                { label: 'carbs',   value: nutri.carbs_g,    color: 'var(--green)', suffix: 'g' },
                { label: 'fat',     value: nutri.fat_g,      color: 'var(--purple)', suffix: 'g' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--gray6)', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>
                    {s.value != null ? <>{s.value}{(s as { suffix?: string }).suffix || ''}</> : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--label3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {detail.allergens && detail.allergens.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--label2)' }}>
                Allergens: {detail.allergens.map(a => <span key={a} style={{
                  display: 'inline-block', background: '#F4E5C2', color: '#8B6914',
                  padding: '2px 8px', borderRadius: 6, marginRight: 4, fontSize: 11, fontWeight: 600,
                  textTransform: 'capitalize',
                }}>{a}</span>)}
              </div>
            )}
          </Section>
        )}

        {/* ── Inventory ── */}
        {detail && (detail.cost != null || detail.store || detail.unit_size_g != null) && (
          <Section label="Inventory">
            <div style={{ fontSize: 14, color: 'var(--label)' }}>
              {detail.cost != null && (
                <span style={{ fontWeight: 700 }}>£{detail.cost.toFixed(2)}</span>
              )}
              {detail.cost != null && detail.store && <span style={{ color: 'var(--label3)' }}> · </span>}
              {detail.store && <span style={{ color: 'var(--label2)' }}>{detail.store}</span>}
            </div>
            {(detail.unit_size_g != null || detail.quantity_g != null) && (
              <div style={{ fontSize: 13, color: 'var(--label2)', marginTop: 4 }}>
                {detail.quantity_g != null && detail.unit_size_g
                  ? <>{formatGrams(detail.quantity_g)} of {formatGrams(detail.unit_size_g)} left</>
                  : detail.unit_size_g
                  ? <>{formatGrams(detail.unit_size_g)} pack</>
                  : null}
              </div>
            )}
          </Section>
        )}

        {/* ── Price history ── */}
        {detail && detail.recent_prices.length > 0 && (
          <Section label="Price history">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detail.recent_prices.slice(0, 5).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--label2)' }}>{p.store || '—'}</span>
                  <span style={{ display: 'flex', gap: 8, color: 'var(--label)' }}>
                    <span style={{ fontWeight: 600 }}>£{p.cost.toFixed(2)}</span>
                    <span style={{ color: 'var(--label3)' }}>{p.date}</span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Confidence + source footer ── */}
        {detail && detail.confidence && detail.confidence !== 'unknown' && (
          <div style={{ fontSize: 11, color: 'var(--label3)', marginBottom: 14, textAlign: 'center' }}>
            Data from {detail.source} · {detail.confidence} confidence
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={reEnrich} disabled={reEnriching}
            style={{
              flex: 1, padding: '12px 8px', borderRadius: 12, border: '1.5px solid var(--separator)',
              background: 'var(--card)', color: 'var(--label)', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', opacity: reEnriching ? 0.5 : 1,
            }}>
            {/* Audit P2-10: was 'Re-enrich' which read as jargon. */}
            {reEnriching ? '…' : '↻ Refresh data'}
          </button>
        </div>
        {/* Primary action when removing because you ATE it — logs estimated
            macros to today's calorie log, then removes. Most "remove" taps
            are post-consumption; without this button the user would lose
            the macros silently. Falls back to plain remove if we have no
            nutrition data to estimate from. */}
        {detail && detail.nutrition_per_100g && (() => {
          const m = computeAteMacros(detail)
          return (
            <button onClick={ateAndRemove}
              style={{
                width: '100%', marginBottom: 8,
                padding: '13px 8px', borderRadius: 12, border: 'none',
                background: 'var(--green)', color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
              }}>
              I ate it{m ? ` · log ~${m.kcal} kcal, ${m.protein_g}g protein` : ''}
            </button>
          )
        })()}
        <button className="btn-destructive" onClick={() => onRemove(detail?.name || name)} style={{ width: '100%', marginBottom: 8 }}>
          {detail && detail.nutrition_per_100g ? 'Remove (without logging)' : `Remove from ${zoneCfg.label}`}
        </button>
        <button onClick={onClose}
          style={{ width: '100%', background: 'none', border: 'none', color: 'var(--blue)', fontSize: 16, fontWeight: 600, cursor: 'pointer', padding: 10 }}>
          Close
        </button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--label3)',
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  )
}

export default function Fridge() {
  const [data, setData] = useState<FridgeData>({ fridge: [], pantry: [], condiments: [], freezer: [] })
  const [slots, setSlots] = useState<SlotMap>({})
  const [learnedShelfLife, setLearnedShelfLife] = useState<ShelfLifeMap>({})
  const [meals, setMeals] = useState<Meal[]>([])
  const [loadingMeals, setLoadingMeals] = useState(false)
  const [showMeals, setShowMeals] = useState(false)
  const [expandedMealIdx, setExpandedMealIdx] = useState<number | null>(null)
  const [mealDetails, setMealDetails] = useState<Record<string, MealDetail | 'loading' | 'error'>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addZone, setAddZone] = useState<Zone>('fridge')
  // Loading state used internally by handleScan; no UI reads it any more
  // since the header Scan button was removed (audit P0-2).
  const [, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<string | null>(null)
  const [, setBarcodeScanning] = useState(false)
  const [detailModal, setDetailModal] = useState<{ name: string; zone: Zone } | null>(null)
  const [activeDragName, setActiveDragName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // PointerSensor with distance:8 means a tap (<8px) doesn't start a drag.
  // The inner button's onClick fires normally for taps; only real drags
  // activate dnd-kit. Phone-friendly without needing a long-press.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Find an item by name across zones (for drag-overlay rendering and the
  // drag-end swap logic that needs to know what was on the drop target).
  const itemByName = useMemo(() => {
    const map = new Map<string, { item: FridgeItem; zone: Zone }>()
    ;(['fridge', 'pantry', 'freezer', 'condiments'] as Zone[]).forEach(z => {
      data[z]?.forEach(it => map.set(it.name, { item: it, zone: z }))
    })
    return map
  }, [data])

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    if (id.startsWith('item:')) setActiveDragName(id.slice(5))
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveDragName(null)
    if (!e.over) return
    const overId = String(e.over.id)
    const activeId = String(e.active.id)
    if (!overId.startsWith('slot:') || !activeId.startsWith('item:')) return

    const draggedName = activeId.slice(5)
    const [, zoneStr, shelfStr, colStr] = overId.split(':')
    const zone = zoneStr as Zone
    const shelf = parseInt(shelfStr, 10)
    const col = parseInt(colStr, 10)

    // BUG FIX 2026-05-06: Anchor every CURRENTLY-VISIBLE item to its present
    // slot before applying the drag. Without this, items that had no explicit
    // slot_memory entry (relying on auto-fill from buildShelfGrid) would
    // re-flow whenever any *other* item got an explicit slot — visually
    // looking like a drag also moved unrelated items. After this, slot_memory
    // contains an entry for every visible item, so the drag only affects the
    // dragged item (+ swap target), and every other item stays put.
    const next: SlotMap = { ...slots }
    for (const z of ['fridge', 'pantry'] as const) {
      const grid = buildShelfGrid(data[z] || [], slots, z)
      grid.forEach((row, s) => row.forEach((it, c) => {
        if (it && !next[it.name]) {
          next[it.name] = { zone: z, shelf: s, col: c }
        }
      }))
    }

    const fromPos = next[draggedName] || null
    const occupantName = findNameInSlotIn(next, zone, shelf, col)

    if (occupantName && occupantName !== draggedName) {
      // Swap. Occupant takes dragged item's old slot (or stays put if dragged
      // item had no recorded slot — find first free in source zone).
      const draggedZoneNow = itemByName.get(draggedName)?.zone || zone
      const occupantZoneNow = itemByName.get(occupantName)?.zone || zone
      const occupantTarget: SlotPos = fromPos
        ? { zone: fromPos.zone, shelf: fromPos.shelf, col: fromPos.col }
        : firstFreeSlot(draggedZoneNow, next, draggedName)
      next[draggedName] = { zone, shelf, col }
      next[occupantName] = occupantTarget
      // If swap crosses zones, persist zone change in the items list too.
      // When BOTH items change zones, removes must happen before either add —
      // FastAPI's remove deletes by substring match across all zones, so a
      // remove("honey") could nuke a freshly-added "honeycomb" if order is
      // remove-A → add-A → remove-B → add-B. Doing both removes first avoids
      // any substring overlap collision.
      const draggedCrosses = zone !== draggedZoneNow
      const occupantCrosses = occupantTarget.zone !== occupantZoneNow
      if (draggedCrosses && occupantCrosses) {
        try {
          await api.removeFridgeItem(draggedName)
          await api.removeFridgeItem(occupantName)
          await api.addFridgeItem(draggedName, zone)
          await api.addFridgeItem(occupantName, occupantTarget.zone)
          const updated = await api.getFridge()
          setData(updated)
        } catch {
          showToast(`Couldn’t complete swap`, 'err')
        }
      } else {
        if (draggedCrosses) await moveItemBetweenZones(draggedName, draggedZoneNow, zone)
        if (occupantCrosses) await moveItemBetweenZones(occupantName, occupantZoneNow, occupantTarget.zone)
      }
    } else {
      // Empty slot: just place. If cross-zone, also move item between lists.
      const draggedZoneNow = itemByName.get(draggedName)?.zone || zone
      next[draggedName] = { zone, shelf, col }
      if (zone !== draggedZoneNow) await moveItemBetweenZones(draggedName, draggedZoneNow, zone)
    }

    setSlots(next)
    try {
      await api.putSlots(next)
    } catch {
      showToast('Could not save layout', 'err')
    }
  }

  // Lookup variant that operates on a snapshot map (so handleDragEnd can use
  // the materialized `next` instead of the live `slots` state).
  function findNameInSlotIn(map: SlotMap, zone: Zone, shelf: number, col: number): string | null {
    for (const [name, pos] of Object.entries(map)) {
      if (pos.zone === zone && pos.shelf === shelf && pos.col === col) return name
    }
    return null
  }

  function firstFreeSlot(zone: Zone, slotMap: SlotMap, ignoreName?: string): SlotPos {
    const occupied = new Set<string>()
    for (const [name, pos] of Object.entries(slotMap)) {
      if (name === ignoreName) continue
      if (pos.zone === zone) occupied.add(`${pos.shelf}:${pos.col}`)
    }
    for (let s = 0; s < TOTAL_SHELVES; s++) {
      for (let c = 0; c < PER_SHELF; c++) {
        if (!occupied.has(`${s}:${c}`)) return { zone, shelf: s, col: c }
      }
    }
    return { zone, shelf: 0, col: 0 } // overflow — overlay onto top-left
  }

  // Cross-zone drag: remove from source first, then add to destination.
  // Order matters: FastAPI's remove endpoint deletes by substring match across
  // every zone, so an add-then-remove sequence nukes the freshly-added copy
  // alongside the original. Remove-then-add gives the correct end state.
  async function moveItemBetweenZones(name: string, from: Zone, to: Zone) {
    if (from === to) return
    try {
      await api.removeFridgeItem(name)
      await api.addFridgeItem(name, to)
      const updated = await api.getFridge()
      setData(updated)
    } catch {
      showToast(`Couldn’t move ${name}`, 'err')
    }
  }

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
    api.getSlots().then(setSlots).catch(() => { /* slot persistence is best-effort */ })
  }, [])
  useEffect(() => {
    try { localStorage.setItem('grocery_done', JSON.stringify(groceryDone)) } catch { /* ignore quota errors */ }
  }, [groceryDone])
  // Note: legacy `fridge_qty` localStorage is no longer used. Quantity is now
  // server-side via item.quantity_g / quantity_count and the camera Home flow
  // decrements via /fridge/item/{name}/consume.

  // Staples-to-restock list. Used to mix in alertItems (expiring) too, but
  // those are already surfaced in the dedicated "Eat soon" banner above —
  // duplicating them here was the audit P1-2 confusion. This list now ONLY
  // shows staples the user doesn't have in the fridge.
  const smartGrocery = STAPLES
    .filter(staple => !allItems.some(i => i.name.toLowerCase().includes(staple)))
    .slice(0, 10)

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
      // Background batch enrichment \u2014 fills nutrition + brand + allergens
      // for everything we just added, with the receipt's store/cost/size as
      // hints so price history gets a real entry. Fire-and-forget; we
      // re-pull /fridge after it lands so cards swap to real photos.
      const todayIso = new Date().toISOString().slice(0, 10)
      const batch = detected.map(it => ({
        name: it.name,
        hints: {
          store: storeName,
          cost: it.cost ?? null,
          size: it.size ?? null,
          date: todayIso,
        },
      }))
      void api.enrichBatch(batch).then(() => api.getFridge()).then(setData).catch(() => {})
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
      // Pass the OFF photo through immediately for fast UI; full enrichment
      // (nutrition, brand, allergens, packaging) lands in the background.
      await api.addFridgeItem(product.name, section, {
        photo_url: product.image_url ?? null,
      })
      const updated = await api.getFridge()
      setData(updated)
      setScanStatus(`✓ Added ${product.name} to ${ZONE_CONFIG[section].label}`)
      // Background enrichment with the barcode itself — high-confidence path
      // (OFF API barcode lookup, full record).
      void api.enrichItem({ name: product.name, barcode: code }).catch(() => {})
    } catch {
      setScanStatus('Barcode add failed - try again')
    } finally {
      setBarcodeScanning(false)
      if (barcodeInputRef.current) barcodeInputRef.current.value = ''
      setTimeout(() => setScanStatus(null), 4500)
    }
  }

  async function removeByName(name: string) {
    // Exact match only (one row at a time on duplicates). The detail modal
    // passes `detail.name` (the canonical stored name from /fridge/item),
    // so 404s should be rare. We previously fell back to ?contains=true,
    // but that path nukes ALL substring matches across every zone — too
    // dangerous for an automatic retry. If exact-match 404s, surface the
    // error instead of silently deleting unrelated items.
    try {
      await api.removeFridgeItem(name)
    } catch (err) {
      const msg = String(err)
      showToast(`Couldn't remove "${name}" — ${msg.slice(0, 60)}`, 'err')
      setDetailModal(null)
      return
    }
    const updated = await api.getFridge()
    setData(updated)
    setSlots(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    setDetailModal(null)
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
    // Background AI enrichment. Replaces the prior photo-only lookup with
    // full OFF + Gemini cascade — fills photo, brand, nutrition, allergens,
    // packaging in one round-trip. We re-pull /fridge once it returns so the
    // card swaps from emoji → photo without a reload. Silent failure: emoji
    // fallback + missing nutrition is still useful.
    void api.enrichItem({ name }).then(r => {
      if (r.meta?.photo_url) {
        return api.addFridgeItem(name, addZone, { photo_url: r.meta.photo_url })
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
              {/* Expiring pill removed — banner below is the single source
                  of truth for the count (audit P1-3). */}
            </div>
          </div>
          {/* Header action: only manual + Add. The bottom camera FAB
              already exposes "Scan Receipt" + "Scan Barcode" — duplicating
              them up here was redundant + cluttered (audit P0-2). */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => setShowAdd(true)}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
                {oldItems.length > 0 ? `Past their best \u00B7 ${alertItems.length}` : `Eat soon \u00B7 ${alertItems.length}`}
              </div>
              {/* Show first 3 names then "+N more" \u2014 single source of truth
                  for the count; was showing 6 in header + 4 names + "+2"
                  (audit P1-3). */}
              <div style={{ fontSize: 12, color: 'var(--label2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {alertItems.slice(0, 3).map(i => i.name).join(' \u00B7 ')}
                {alertItems.length > 3 ? ` +${alertItems.length - 3} more` : ''}
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

        {/* ── Appliance views ── all four zones now share the cartoon SVG +
            drag-and-drop slot model (audit P2-11). Each zone is its own
            appliance, and items can drag between them via the shared
            DndContext. Empty zones don't render to keep the page tight. */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {(['fridge', 'pantry', 'freezer', 'condiments'] as Zone[]).map(zone => (
            data[zone].length > 0 && (
              <Appliance
                key={zone}
                kind={zone}
                items={data[zone]}
                slots={slots}
                learnedShelfLife={learnedShelfLife}
                activeDragName={activeDragName}
                onTapItem={(name, z) => setDetailModal({ name, zone: z })}
              />
            )
          ))}
          <DragOverlay dropAnimation={null}>
            {activeDragName ? (() => {
              const found = itemByName.get(activeDragName)
              if (!found) return null
              return <ApplianceItem item={found.item} zone={found.zone} idx={0} learnedDays={learnedShelfLife[found.item.name]} />
            })() : null}
          </DragOverlay>
        </DndContext>

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

        {/* ── Staples to restock ── distinct from the "Eat soon" banner above:
            Eat soon = items you HAVE that are aging; this = staples you're
            missing entirely. Same UI, different intent. */}
        {smartGrocery.length > 0 && (
          <>
            <div className="section-label">Staples to restock</div>
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
                        <div style={{ fontSize: 13, color: 'var(--label2)' }}>⏳ Generating recipe…</div>
                      )}
                      {detail === 'error' && (
                        <div style={{ fontSize: 13, color: 'var(--red)' }}>Couldn't generate recipe — tap to retry</div>
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
            ⏳ Finding meal ideas from your fridge…
          </div>
        )}
      </div>

      {/* ── Item detail modal ── replaces the bare "Remove?" sheet */}
      {detailModal && (
        <ItemDetailModal
          name={detailModal.name}
          zone={detailModal.zone}
          onClose={() => setDetailModal(null)}
          onRemove={() => removeByName(detailModal.name)}
        />
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
