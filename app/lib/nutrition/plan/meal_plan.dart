/// A weekly meal plan — the output of the agentic "plan my week" step.
///
/// The plan is grounded in the user's real goals + real pantry (see the
/// `plan-week` edge function). Honesty rules travel with it: macros the planner
/// couldn't estimate stay `null` (never coerced to `0`), and the estimate
/// [AccuracyTier] is carried so the UI can mark meals with `~`.
library;

import '../../pantry/pantry_item.dart';
import '../food_log_entry.dart' show AccuracyTier;

/// Which sitting a meal belongs to.
enum MealSlot { breakfast, lunch, dinner, snack }

MealSlot _slotFromString(String? raw) {
  for (final s in MealSlot.values) {
    if (s.name == raw) return s;
  }
  return MealSlot.snack;
}

/// A single ingredient a meal calls for. [grams] is null when the planner gave
/// an amount it couldn't quantify (e.g. "a pinch of salt") — honest, not `0`.
class PlanIngredient {
  const PlanIngredient({required this.name, this.grams});

  final String name;
  final double? grams;

  Map<String, dynamic> toJson() => {
        'name': name,
        if (grams != null) 'grams': grams,
      };

  factory PlanIngredient.fromJson(Map<String, dynamic> json) => PlanIngredient(
        name: json['name'] as String,
        grams: (json['grams'] as num?)?.toDouble(),
      );
}

/// One planned meal. Macros are nullable and never fabricated.
class PlanMeal {
  const PlanMeal({
    required this.name,
    required this.slot,
    required this.tier,
    required this.ingredients,
    this.kcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
  });

  final String name;
  final MealSlot slot;
  final AccuracyTier tier;
  final List<PlanIngredient> ingredients;
  final double? kcal;
  final double? proteinG;
  final double? carbsG;
  final double? fatG;

  Map<String, dynamic> toJson() => {
        'name': name,
        'slot': slot.name,
        'tier': tier.name,
        'ingredients': ingredients.map((i) => i.toJson()).toList(),
        if (kcal != null) 'kcal': kcal,
        if (proteinG != null) 'proteinG': proteinG,
        if (carbsG != null) 'carbsG': carbsG,
        if (fatG != null) 'fatG': fatG,
      };

  factory PlanMeal.fromJson(Map<String, dynamic> json) => PlanMeal(
        name: json['name'] as String,
        slot: _slotFromString(json['slot'] as String?),
        tier: (json['tier'] as String?) == AccuracyTier.exact.name
            ? AccuracyTier.exact
            : AccuracyTier.estimate,
        ingredients: ((json['ingredients'] as List?) ?? const [])
            .map((e) => PlanIngredient.fromJson(e as Map<String, dynamic>))
            .toList(),
        kcal: (json['kcal'] as num?)?.toDouble(),
        proteinG: (json['proteinG'] as num?)?.toDouble(),
        carbsG: (json['carbsG'] as num?)?.toDouble(),
        fatG: (json['fatG'] as num?)?.toDouble(),
      );
}

/// A day of the plan.
class PlanDay {
  const PlanDay({required this.date, required this.meals});

  final DateTime date;
  final List<PlanMeal> meals;

  Map<String, dynamic> toJson() => {
        'date': date.toIso8601String(),
        'meals': meals.map((m) => m.toJson()).toList(),
      };

  factory PlanDay.fromJson(Map<String, dynamic> json) => PlanDay(
        date: DateTime.parse(json['date'] as String),
        meals: ((json['meals'] as List?) ?? const [])
            .map((e) => PlanMeal.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// A whole week's plan. PK convention: `plan-<uid>-<isoWeek>`.
class MealPlan {
  const MealPlan({
    required this.id,
    required this.weekStart,
    required this.days,
  });

  final String id;
  final DateTime weekStart;
  final List<PlanDay> days;

  Map<String, dynamic> toJson() => {
        'id': id,
        'weekStart': weekStart.toIso8601String(),
        'days': days.map((d) => d.toJson()).toList(),
      };

  factory MealPlan.fromJson(Map<String, dynamic> json) => MealPlan(
        id: json['id'] as String,
        weekStart: DateTime.parse(json['weekStart'] as String),
        days: ((json['days'] as List?) ?? const [])
            .map((e) => PlanDay.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

// ── Needed-ingredients diff ─────────────────────────────────────────────────

/// How well the pantry covers a planned ingredient.
enum IngredientCoverage {
  /// Not in the pantry at all.
  absent,

  /// In the pantry, but a measured shortfall (needed grams > on-hand grams).
  short,
}

/// One line of the shopping gap: something the plan needs that the kitchen
/// doesn't (fully) have.
class NeededIngredient {
  const NeededIngredient({
    required this.name,
    required this.coverage,
    this.gramsNeeded,
    this.gramsOnHand,
  });

  final String name;
  final IngredientCoverage coverage;

  /// Total grams the plan calls for. Null when the planner didn't quantify it
  /// (honest "amount unknown", never guessed).
  final double? gramsNeeded;

  /// Grams already in the pantry (only set for a [IngredientCoverage.short]).
  final double? gramsOnHand;
}

String _norm(String s) => s.trim().toLowerCase();

/// Grams-equivalent of a pantry item, or null if we can't quantify it in grams
/// (unknown qty, or a non-mass unit like "x"/"pcs"). g and ml are treated 1:1,
/// matching the app's existing liquid≈1 g/ml convention.
double? _pantryGrams(PantryItem item) {
  final qty = item.qty;
  if (qty == null) return null;
  final unit = (item.unit ?? '').trim().toLowerCase();
  const gramLike = {'g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters'};
  if (gramLike.contains(unit)) return qty;
  return null; // present, but not comparable in grams
}

/// The pure diff at the heart of the loop: given a [plan] and the real
/// [pantry], return only the ingredients the user actually needs to buy.
///
/// Rules (honest, non-nagging):
///  * Ingredients are summed across the whole plan by normalized name.
///  * An item the pantry has *at all* — even if we can't quantify it — is
///    treated as covered (don't tell someone to re-buy oil they can see).
///  * A quantified shortfall (need > on-hand grams) is surfaced as
///    [IngredientCoverage.short], disclosing grams-on-hand.
///  * An absent ingredient is [IngredientCoverage.absent]; if the plan didn't
///    quantify it, [NeededIngredient.gramsNeeded] stays null.
List<NeededIngredient> neededIngredients(
  MealPlan plan,
  List<PantryItem> pantry,
) {
  // Sum required grams per ingredient. A null total means "at least one line
  // was unquantified" — we keep it null rather than inventing a number.
  final requiredGrams = <String, double?>{};
  final displayName = <String, String>{};
  for (final day in plan.days) {
    for (final meal in day.meals) {
      for (final ing in meal.ingredients) {
        final key = _norm(ing.name);
        displayName.putIfAbsent(key, () => ing.name.trim());
        if (!requiredGrams.containsKey(key)) {
          requiredGrams[key] = ing.grams;
        } else if (requiredGrams[key] != null && ing.grams != null) {
          requiredGrams[key] = requiredGrams[key]! + ing.grams!;
        } else {
          // Once any line is unquantified, the total is unknown.
          requiredGrams[key] = requiredGrams[key] ?? ing.grams;
          if (ing.grams == null) requiredGrams[key] = null;
        }
      }
    }
  }

  // Fold the pantry: presence + grams-on-hand per normalized name.
  final onHandGrams = <String, double>{};
  final present = <String>{};
  for (final item in pantry) {
    final key = _norm(item.name);
    present.add(key);
    final grams = _pantryGrams(item);
    if (grams != null) {
      onHandGrams[key] = (onHandGrams[key] ?? 0) + grams;
    }
  }

  final result = <NeededIngredient>[];
  for (final entry in requiredGrams.entries) {
    final key = entry.key;
    final needGrams = entry.value;
    final name = displayName[key] ?? key;

    if (!present.contains(key)) {
      result.add(NeededIngredient(
        name: name,
        coverage: IngredientCoverage.absent,
        gramsNeeded: needGrams,
      ));
      continue;
    }

    // Present in the pantry. Only flag a shortfall when BOTH sides are
    // quantified in grams; otherwise assume covered (don't nag).
    final have = onHandGrams[key];
    if (needGrams != null && have != null && have < needGrams) {
      result.add(NeededIngredient(
        name: name,
        coverage: IngredientCoverage.short,
        gramsNeeded: needGrams,
        gramsOnHand: have,
      ));
    }
    // else: covered (or not comparable) → not needed.
  }
  return result;
}
