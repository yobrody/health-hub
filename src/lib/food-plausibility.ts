// Pure sanity guard for AI-generated food estimates.
//
// The food estimator is usually right, but it occasionally hallucinates high —
// e.g. "3 scrambled eggs" once logged as 702 kcal / 54 g protein when the real
// figure is ~234 kcal / 19 g. Nothing flagged it, so the bad numbers went
// straight into the log.
//
// This util runs a handful of cheap, dependency-free plausibility checks and
// returns human-readable warnings. It NEVER blocks logging — it just gives the
// user a reason to glance at the numbers before they commit them.

export interface FoodPlausibilityInput {
  kcal: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  description?: string
}

export interface FoodPlausibilityResult {
  ok: boolean
  warnings: string[]
}

// True only for real, finite numbers. Guards every check against NaN /
// undefined / Infinity so a missing macro simply skips its check rather than
// throwing or producing a bogus warning.
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function checkFoodPlausibility(input: FoodPlausibilityInput): FoodPlausibilityResult {
  const warnings: string[] = []

  const kcal = input.kcal
  const protein = input.protein_g
  const carbs = input.carbs_g
  const fat = input.fat_g

  const hasKcal = isNum(kcal)
  const hasProtein = isNum(protein)

  // 1. Protein impossible — protein supplies 4 kcal/g, so its calorie
  //    contribution alone can't meaningfully exceed the stated total. The 1.05
  //    factor allows a little rounding slack before we cry foul.
  if (hasKcal && hasProtein && protein! * 4 > kcal * 1.05) {
    warnings.push('Protein exceeds total calories — likely an error.')
  }

  // 2. Atwater inconsistency — only meaningful when BOTH carbs and fat are
  //    given (otherwise the derived total is missing real energy and would
  //    false-positive). Compares the kcal implied by the macros against the
  //    stated kcal, allowing the larger of 60 kcal or 35% wiggle room.
  if (hasKcal && hasProtein && isNum(carbs) && isNum(fat) && kcal > 0) {
    const derived = 4 * protein! + 4 * carbs! + 9 * fat!
    if (Math.abs(kcal - derived) > Math.max(60, kcal * 0.35)) {
      warnings.push(
        `Calories and macros don't line up (~${Math.round(derived)} from macros vs ${Math.round(kcal)} stated).`,
      )
    }
  }

  // 3. High single-item outliers — sanity ceilings for one logged item.
  if (hasProtein && protein! > 50) {
    warnings.push("That's a lot of protein for one item — double-check.")
  }
  if (hasKcal && kcal > 1200) {
    warnings.push('Unusually high calories for a single item — double-check.')
  }

  return { ok: warnings.length === 0, warnings }
}
