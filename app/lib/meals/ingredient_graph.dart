/// PURE, tested ingredient-graph logic — the keystone read/write over the
/// pantry. No IO: every function is deterministic and fully unit-tested.
///
/// Honesty rules baked in (the whole point of this task):
///  • [canMakeFromStock] NEVER guesses. A meal is confirmed makeable only when
///    EVERY ingredient has a matching pantry item whose amount is KNOWN
///    (`qty != null`), is gram-reconcilable, and is ≥ the required grams.
///    A missing item, a null qty, an unreconcilable unit, or too little → the
///    meal is NOT makeable (false). "Probably enough" is not a thing here.
///  • [deductIngredients] NEVER drives stock negative and NEVER mutates its
///    input. Subtracting more than is present clamps at 0 and records a
///    shortfall — an honest "you were short", never a silent negative.
///
/// ## Unit assumption (deliberate, conservative)
/// Ingredients are expressed in grams. A pantry item's `qty` is treated as
/// grams-comparable ONLY when its `unit` is a known gram-equivalent: `"g"`,
/// `"gram"`/`"grams"`, or `null` (the pantry's implicit default). Any other
/// unit (`"ml"`, `"cups"`, `"unit"`, …) is NOT reconciled here — we cannot
/// honestly convert it without a density/piece-weight, so such an item is
/// treated as NOT confirmable (makeability → false; deduction → shortfall,
/// item left untouched). Richer unit conversion is a later phase.
library;

import '../pantry/pantry_item.dart';
import 'meal_composition.dart';

/// Units whose `qty` we treat as directly gram-comparable. `null` is included
/// separately (the pantry's implicit default) in [_gramsAvailable].
const Set<String> _gramUnits = {'g', 'gram', 'grams'};

/// The gram-comparable amount available for [item], or `null` when we cannot
/// honestly say (unknown qty, or a unit we can't reconcile to grams).
double? _gramsAvailable(PantryItem item) {
  final qty = item.qty;
  if (qty == null) return null; // unknown amount — never a guess
  final unit = item.unit;
  if (unit == null || _gramUnits.contains(unit.toLowerCase())) return qty;
  return null; // non-gram unit we can't reconcile
}

/// True ONLY if every ingredient of [meal] can be honestly satisfied from
/// [stock]: a matching pantry item exists, its amount is known and
/// gram-reconcilable, and it is ≥ the required grams. Otherwise false.
bool canMakeFromStock(MealComposition meal, List<PantryItem> stock) {
  final byId = {for (final i in stock) i.id: i};
  for (final ing in meal.ingredients) {
    final item = byId[ing.pantryItemId];
    if (item == null) return false; // missing → not confirmable
    final available = _gramsAvailable(item);
    if (available == null) return false; // unknown / unreconcilable → not confirmable
    if (available < ing.grams) return false; // genuinely not enough
  }
  return true;
}

/// Return only the meals from [known] that are confirmed makeable from [stock].
///
/// Ranking is intentionally trivial for now: input order is preserved (stable).
/// A richer ranking (use-soon ingredients, time/DayPlan/workout context) is a
/// later phase — plug it in by sorting the returned list here.
List<MealComposition> suggestMeals(
  List<MealComposition> known,
  List<PantryItem> stock,
) =>
    [for (final meal in known) if (canMakeFromStock(meal, stock)) meal];

/// The outcome of deducting a meal's ingredients from stock.
class DeductionResult {
  const DeductionResult({
    required this.updatedStock,
    required this.hadShortfall,
    required this.shortfallByItemId,
  });

  /// A NEW stock list with the meal's ingredients subtracted (clamped at 0).
  /// Items not touched by the meal are carried through unchanged.
  final List<PantryItem> updatedStock;

  /// True if any ingredient could not be fully satisfied.
  final bool hadShortfall;

  /// For each short ingredient, how many grams were missing (item id → grams).
  /// A missing item or null/unreconcilable qty records the FULL required grams.
  final Map<String, double> shortfallByItemId;
}

/// Subtract [meal]'s ingredients from [stock], returning a NEW stock list.
///
/// Never mutates [stock] or its items. For each ingredient:
///  • matching item with known gram qty → subtract, CLAMPED at 0; if the qty
///    was less than required, record the (grams - available) shortfall.
///  • missing item / null qty / unreconcilable unit → record the FULL required
///    grams as a shortfall and leave the item (if any) untouched — we never
///    fabricate a qty for an item whose amount we don't honestly know.
DeductionResult deductIngredients(List<PantryItem> stock, MealComposition meal) {
  // Sum required grams per pantry item id (a meal could list one twice).
  final requiredById = <String, double>{};
  for (final ing in meal.ingredients) {
    requiredById[ing.pantryItemId] =
        (requiredById[ing.pantryItemId] ?? 0) + ing.grams;
  }

  final shortfall = <String, double>{};
  final updated = <PantryItem>[];

  for (final item in stock) {
    final required = requiredById[item.id];
    if (required == null) {
      updated.add(item); // untouched
      continue;
    }
    final available = _gramsAvailable(item);
    if (available == null) {
      // Unknown / unreconcilable — can't honestly deduct. Full shortfall.
      shortfall[item.id] = required;
      updated.add(item); // left exactly as-is
      continue;
    }
    if (available < required) {
      shortfall[item.id] = required - available;
    }
    final remaining = available - required;
    updated.add(item.copyWith(qty: remaining < 0 ? 0 : remaining));
  }

  // Ingredients whose pantry item isn't in stock at all → full shortfall.
  for (final entry in requiredById.entries) {
    final present = stock.any((i) => i.id == entry.key);
    if (!present) shortfall[entry.key] = entry.value;
  }

  return DeductionResult(
    updatedStock: updated,
    hadShortfall: shortfall.isNotEmpty,
    shortfallByItemId: shortfall,
  );
}
