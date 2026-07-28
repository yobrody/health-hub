import { NUTRITION_TARGETS } from '../program'

// Dietary pattern checks.
//
// DELIBERATELY NOT MICRONUTRIENT TOTALS. Asking a language model for the
// vitamin D content of "chicken thighs and rice" returns a confident, invented
// number, and OpenFoodFacts only covers barcoded items - so a total would
// represent a fraction of intake while looking complete. A precise-looking
// fabrication is worse than an absent number, because it gets trusted.
//
// What IS knowable from the food log is which categories of food appear and
// which never do. "No oily fish in 14 days" is a true statement derived from
// real data. That is what this file produces.

export type FoodLogEntry = {
  date: string
  meal?: string
  items?: string
  kcal?: number
  fiber_g?: number
}

export type DietFlag = {
  kind: 'insufficient-data' | 'gap' | 'standing' | 'ok'
  headline: string
  detail: string
}

/** Below this many logged days, nothing about the diet can honestly be said. */
export const MIN_LOGGED_DAYS = 5

type Category = {
  id: string
  label: string
  /** Lowercase substrings. Deliberately generous - a false "you ate greens"
   * is far less harmful than nagging someone who did. */
  match: string[]
  /** How many days without it before it is worth mentioning. */
  afterDays: number
  why: string
}

const CATEGORIES: Category[] = [
  {
    id: 'oily-fish',
    label: 'Oily fish',
    match: ['salmon', 'mackerel', 'sardine', 'herring', 'trout', 'anchov', 'pilchard', 'kipper'],
    afterDays: 7,
    why: 'The main dietary source of omega-3. NHS guidance is one portion a week.',
  },
  {
    id: 'greens',
    label: 'Leafy greens',
    match: ['spinach', 'kale', 'broccoli', 'cabbage', 'rocket', 'chard', 'sprout', 'lettuce', 'greens', 'pak choi', 'bok choy', 'tenderstem'],
    afterDays: 4,
    why: 'Folate, vitamin K and magnesium cluster here and are hard to get elsewhere.',
  },
  {
    id: 'fruit',
    label: 'Fruit',
    match: ['banana', 'apple', 'orange', 'berry', 'berries', 'strawberr', 'blueberr', 'raspberr', 'kiwi', 'mango', 'pineapple', 'grape', 'pear', 'melon', 'peach', 'plum'],
    afterDays: 4,
    why: 'Vitamin C and potassium, and the cheapest way to move fibre.',
  },
  {
    id: 'legumes',
    label: 'Beans, lentils or pulses',
    match: ['bean', 'lentil', 'chickpea', 'hummus', 'houmous', 'pulse', 'dal', 'daal'],
    afterDays: 10,
    why: 'The densest fibre source available, and cheap.',
  },
]

function daysBetween(a: string, b: string): number {
  const t1 = new Date(a).getTime()
  const t2 = new Date(b).getTime()
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0
  return Math.abs(t1 - t2) / 86400000
}

/**
 * Turn a food log into honest statements.
 *
 * Leads with data sufficiency: with only a couple of logged days out of
 * fourteen, the correct output is "not enough to say", not a confident list
 * of things you are supposedly missing.
 */
export function analyseDiet(entries: FoodLogEntry[], windowDays = 14, todayISO?: string): DietFlag[] {
  const today = todayISO ?? new Date().toISOString().slice(0, 10)
  const clean = entries.filter(e => e && typeof e.date === 'string' && Number.isFinite(new Date(e.date).getTime()))
  const loggedDays = new Set(clean.map(e => e.date)).size

  if (loggedDays < MIN_LOGGED_DAYS) {
    return [{
      kind: 'insufficient-data',
      headline: `Only ${loggedDays} of the last ${windowDays} days logged`,
      detail: `Nothing useful can be said about your diet from ${loggedDays} day${loggedDays === 1 ? '' : 's'}. Log ${MIN_LOGGED_DAYS} or more and this becomes a real read on what is missing.`,
    }]
  }

  const flags: DietFlag[] = []
  const haystack = clean.map(e => ({ date: e.date, text: (e.items ?? '').toLowerCase() }))

  for (const cat of CATEGORIES) {
    const hits = haystack.filter(h => cat.match.some(m => h.text.includes(m)))
    if (hits.length === 0) {
      flags.push({
        kind: 'gap',
        headline: `No ${cat.label.toLowerCase()} in ${windowDays} days`,
        detail: cat.why,
      })
      continue
    }
    const newest = hits.map(h => h.date).sort().reverse()[0]
    const gap = daysBetween(today, newest)
    if (gap >= cat.afterDays) {
      flags.push({
        kind: 'gap',
        headline: `No ${cat.label.toLowerCase()} for ${Math.round(gap)} days`,
        detail: cat.why,
      })
    }
  }

  // Fibre, now that it is measured rather than guessed.
  const withFibre = clean.filter(e => typeof e.fiber_g === 'number')
  if (withFibre.length > 0) {
    const byDay: Record<string, number> = {}
    for (const e of withFibre) byDay[e.date] = (byDay[e.date] ?? 0) + (e.fiber_g ?? 0)
    const dayTotals = Object.values(byDay)
    const avg = dayTotals.reduce((a, b) => a + b, 0) / dayTotals.length
    if (avg < NUTRITION_TARGETS.fibreG * 0.7) {
      flags.push({
        kind: 'gap',
        headline: `Fibre averaging ${Math.round(avg)}g a day`,
        detail: `Target is ${NUTRITION_TARGETS.fibreG}g. Oats, beans, berries and leaving skins on potatoes are the least effortful ways up.`,
      })
    }
  }

  // Not a gap - true regardless of how well anyone eats, and specific to the UK.
  flags.push({
    kind: 'standing',
    headline: 'Vitamin D is not really obtainable from food here',
    detail: 'NHS guidance is 10µg daily for everyone in the UK, and particularly October to March. Diet alone does not cover it. Worth a word with a GP rather than guesswork if you are unsure.',
  })

  if (flags.filter(f => f.kind === 'gap').length === 0) {
    flags.unshift({
      kind: 'ok',
      headline: 'No obvious gaps',
      detail: `Every category worth checking has appeared in the last ${windowDays} days.`,
    })
  }

  return flags
}
