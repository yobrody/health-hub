/// EatInService — the WRITE half of the ingredient graph (P1-T5).
///
/// Ties the pure [deductIngredients] graph to the [PantryRepo]: logging a home
/// meal deducts its ingredients from inventory, offline-safe and honest.
///
/// This class is a thin ORCHESTRATOR only:
///   load stock (`repo.all()`)
///     → deduct (PURE `deductIngredients`, clamps at 0, never mutates input)
///     → persist ONLY the changed items (`repo.update`, which already
///       enqueues a queued [PendingMutation] — a SUCCESS state, not a failure)
///     → report the outcome, surfacing any shortfall HONESTLY.
///
/// Honesty rules (mirrored from the graph + repo):
///  • A shortfall is reported ([EatInOutcome.hadShortfall] +
///    [EatInOutcome.shortfallByItemId]), never hidden — we never fabricate that
///    we had the ingredients.
///  • qty never goes negative: the graph clamps at 0 and we persist the clamped
///    result.
///  • A queued persistence is SUCCESS (queued), not a failure.
///  • We never fabricate a qty for an item whose amount we don't honestly know
///    (missing / null qty / unreconcilable unit) — such an item is reported as a
///    shortfall and left untouched (not rewritten).
///
/// Eating a meal you were low on is allowed — [eatMeal] does NOT throw on a
/// shortfall; it just reports we couldn't fully account for it.
library;

import '../offline/outbox.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import 'ingredient_graph.dart';
import 'meal_composition.dart';

/// The outcome of eating a home meal: what was short (honestly) and how the
/// pantry writes were queued.
class EatInOutcome {
  const EatInOutcome({
    required this.hadShortfall,
    required this.shortfallByItemId,
    required this.updatedItems,
    required this.writeOutcomes,
  });

  /// True when any ingredient could not be fully accounted for (missing item,
  /// unknown/unreconcilable qty, or not enough on hand). Never hidden.
  final bool hadShortfall;

  /// Per short ingredient, the grams we couldn't cover (item id → grams).
  /// A missing / null-qty / unreconcilable item records the FULL required grams.
  final Map<String, double> shortfallByItemId;

  /// The pantry items that were actually changed and persisted (clamped, never
  /// negative). Items the meal didn't touch — and items we couldn't honestly
  /// deduct from — are NOT included.
  final List<PantryItem> updatedItems;

  /// Per persisted item id, the repo write outcome. Always [WriteOutcome.queued]
  /// today (there's no live `/pantry` backend yet) — a SUCCESS state, never
  /// "failed". Empty when nothing needed persisting.
  final Map<String, WriteOutcome> writeOutcomes;
}

/// Orchestrates eating-in: deduct a meal's ingredients from the pantry.
class EatInService {
  const EatInService(this._repo, {this.onPantryChanged});

  final PantryRepo _repo;

  /// Invoked AFTER a deduction persists at least one changed pantry item, so the
  /// reactive `pantryItemsProvider` (and any UI watching it) refreshes. Wired in
  /// the composition root to `ref.invalidate(pantryItemsProvider)`; `null` in
  /// pure/unit contexts where there is no provider container to refresh.
  final void Function()? onPantryChanged;

  /// Deduct [meal]'s ingredients from the current pantry stock.
  ///
  /// Loads stock, runs the pure [deductIngredients], then persists ONLY the
  /// items whose qty actually changed (each via [PantryRepo.update], which
  /// queues). Returns an [EatInOutcome] that surfaces any shortfall honestly.
  /// Does NOT throw on a shortfall.
  Future<EatInOutcome> eatMeal(MealComposition meal) async {
    final stock = await _repo.all();
    final result = deductIngredients(stock, meal);

    // Index the original stock so we persist ONLY genuinely-changed items — the
    // graph carries untouched items through unchanged, and leaves items it can't
    // honestly deduct from (null/unreconcilable qty) exactly as-is. Rewriting
    // those would be wasted queued mutations.
    final before = {for (final i in stock) i.id: i};

    final writeOutcomes = <String, WriteOutcome>{};
    final updatedItems = <PantryItem>[];

    for (final item in result.updatedStock) {
      final original = before[item.id];
      // `identical` catches carried-through items cheaply; the qty compare
      // catches the ones the graph rebuilt with a new (clamped) qty.
      if (original != null &&
          identical(original, item) == false &&
          original.qty != item.qty) {
        writeOutcomes[item.id] = await _repo.update(item);
        updatedItems.add(item);
      }
    }

    // A genuine deduction changed inventory → refresh the reactive pantry so no
    // other tab (or the Food page's kitchen scene) shows stale counts/freshness.
    if (updatedItems.isNotEmpty) {
      onPantryChanged?.call();
    }

    return EatInOutcome(
      hadShortfall: result.hadShortfall,
      shortfallByItemId: result.shortfallByItemId,
      updatedItems: updatedItems,
      writeOutcomes: writeOutcomes,
    );
  }
}
