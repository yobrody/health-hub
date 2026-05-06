// Pure helper: estimate kcal + protein for the portion of a fridge item
// the user just ate, using the cascade:
//   1. quantity_g  (remaining grams, set by receipt scan + decremented on consume)
//   2. unit_size_g (full pack size, set when adding)
//   3. typical_size_g (Gemini-enriched fallback)
//   4. 100g default (last resort if we have nutrition_per_100g but no portion)
//
// Returns null when there's no nutrition_per_100g — the caller skips the
// log step and just removes. Never throws.

export interface AteMacrosInput {
  nutrition_per_100g?: { kcal?: number | null; protein_g?: number | null } | null
  quantity_g?: number | null
  unit_size_g?: number | null
  typical_size_g?: number | null
}

export interface AteMacros {
  kcal: number
  protein_g: number
  portion_g: number
}

export function computeAteMacros(d: AteMacrosInput): AteMacros | null {
  const np = d.nutrition_per_100g
  if (!np || typeof np.kcal !== 'number') return null
  const grams =
      typeof d.quantity_g === 'number' && d.quantity_g > 0 ? d.quantity_g
    : typeof d.unit_size_g === 'number' && d.unit_size_g > 0 ? d.unit_size_g
    : typeof d.typical_size_g === 'number' && d.typical_size_g > 0 ? d.typical_size_g
    : 100
  const factor = grams / 100
  return {
    kcal: Math.round(np.kcal * factor),
    protein_g: Math.round((np.protein_g ?? 0) * factor),
    portion_g: Math.round(grams),
  }
}
