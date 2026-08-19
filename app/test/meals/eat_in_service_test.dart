// Tests for EatInService (P1-T5) — eating a home meal deducts its ingredients
// from the pantry, offline-safe and honest.
//
// Contract:
//  • load stock → run the PURE deductIngredients graph → persist ONLY the
//    changed items via PantryRepo.update (each queues, never "failed").
//  • a shortfall is surfaced honestly (hadShortfall + shortfallByItemId), never
//    hidden; qty clamps at 0, never negative, and the persisted value is 0.
//  • unchanged items are NOT needlessly rewritten.
//  • a missing / null-qty ingredient is reported as a shortfall, no crash.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/meals/eat_in_service.dart';
import 'package:health_hub/meals/meal_composition.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── In-memory fakes (mirror pantry_repo_test) ────────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

class FakePantryStore implements PantryStore {
  List<PantryItem> _items = [];

  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PantryItem> items) async {
    _items = List.of(items);
  }
}

// A PantryRepo that RECORDS every update() so tests can assert exactly which
// items were rewritten (and that unchanged items were not).
class RecordingPantryRepo extends PantryRepo {
  RecordingPantryRepo({required super.outbox, required super.store});

  final List<PantryItem> updated = [];

  @override
  Future<WriteOutcome> update(PantryItem item) async {
    updated.add(item);
    return super.update(item);
  }
}

RecordingPantryRepo buildRepo({FakePantryStore? store}) {
  return RecordingPantryRepo(
    outbox: Outbox(FakeOutboxStore()),
    store: store ?? FakePantryStore(),
  );
}

const _chicken = PantryItem(
  id: 'chicken',
  name: 'Chicken breast',
  zone: PantryZone.fridge,
  qty: 500,
  unit: 'g',
  source: 'manual',
);

const _rice = PantryItem(
  id: 'rice',
  name: 'Rice',
  zone: PantryZone.pantry,
  qty: 1000,
  unit: 'g',
  source: 'manual',
);

const _oil = PantryItem(
  id: 'oil',
  name: 'Olive oil',
  zone: PantryZone.condiments,
  qty: 200,
  unit: 'ml', // non-gram unit — can't reconcile honestly
  source: 'manual',
);

const _saltNoQty = PantryItem(
  id: 'salt',
  name: 'Salt',
  zone: PantryZone.condiments,
  source: 'manual', // qty null
);

void main() {
  group('EatInService.eatMeal — deduction + persistence', () {
    test('deducts the correct grams and PERSISTS only the changed items',
        () async {
      final store = FakePantryStore();
      final repo = buildRepo(store: store);
      await repo.add(_chicken); // 500 g
      await repo.add(_rice); // 1000 g
      repo.updated.clear(); // ignore the seeding adds

      const meal = MealComposition(
        id: 'chicken-rice',
        name: 'Chicken & rice',
        ingredients: [
          Ingredient(pantryItemId: 'chicken', grams: 200),
          Ingredient(pantryItemId: 'rice', grams: 150),
        ],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isFalse);
      expect(outcome.shortfallByItemId, isEmpty);

      // Persisted stock reflects the deduction.
      final byId = {for (final i in await repo.all()) i.id: i};
      expect(byId['chicken']!.qty, 300); // 500 - 200
      expect(byId['rice']!.qty, 850); // 1000 - 150

      // Both changed items were updated exactly once (queued, not failed).
      expect(repo.updated.map((i) => i.id).toSet(), {'chicken', 'rice'});
      expect(repo.updated, hasLength(2));
      for (final o in outcome.writeOutcomes.values) {
        expect(o, WriteOutcome.queued);
        expect(o, isNot(WriteOutcome.failed));
      }
    });

    test('does not needlessly rewrite unchanged items', () async {
      final repo = buildRepo();
      await repo.add(_chicken);
      await repo.add(_rice);
      repo.updated.clear();

      // Meal only touches chicken; rice must be left alone.
      const meal = MealComposition(
        id: 'grilled-chicken',
        name: 'Grilled chicken',
        ingredients: [Ingredient(pantryItemId: 'chicken', grams: 100)],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isFalse);
      expect(repo.updated.map((i) => i.id), ['chicken']);
      expect(repo.updated.any((i) => i.id == 'rice'), isFalse);
      // Rice untouched in the store.
      final byId = {for (final i in await repo.all()) i.id: i};
      expect(byId['rice']!.qty, 1000);
    });
  });

  group('EatInService.eatMeal — honest shortfall', () {
    test('short ingredient clamps at 0, persists 0, and reports the shortfall',
        () async {
      final repo = buildRepo();
      await repo.add(_chicken); // only 500 g
      repo.updated.clear();

      const meal = MealComposition(
        id: 'big-chicken',
        name: 'Huge chicken',
        ingredients: [Ingredient(pantryItemId: 'chicken', grams: 800)],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isTrue);
      expect(outcome.shortfallByItemId['chicken'], 300); // 800 - 500

      // Persisted value clamped to 0, NEVER negative.
      final chicken =
          (await repo.all()).firstWhere((i) => i.id == 'chicken');
      expect(chicken.qty, 0);
      expect(chicken.qty! >= 0, isTrue);
      // The clamped item WAS persisted (queued).
      expect(repo.updated.map((i) => i.id), ['chicken']);
      expect(outcome.writeOutcomes['chicken'], WriteOutcome.queued);
    });

    test('a missing ingredient is reported as a shortfall (no crash)',
        () async {
      final repo = buildRepo();
      await repo.add(_rice);
      repo.updated.clear();

      const meal = MealComposition(
        id: 'ghost-meal',
        name: 'Uses something we do not have',
        ingredients: [Ingredient(pantryItemId: 'chicken', grams: 200)],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isTrue);
      expect(outcome.shortfallByItemId['chicken'], 200);
      // Nothing to persist — the item isn't in stock.
      expect(repo.updated, isEmpty);
      expect(outcome.writeOutcomes, isEmpty);
    });

    test('a null-qty ingredient is reported as a shortfall, item untouched',
        () async {
      final repo = buildRepo();
      await repo.add(_saltNoQty); // qty null
      repo.updated.clear();

      const meal = MealComposition(
        id: 'salted',
        name: 'Salted thing',
        ingredients: [Ingredient(pantryItemId: 'salt', grams: 5)],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isTrue);
      expect(outcome.shortfallByItemId['salt'], 5);
      // We never fabricate a qty for an unknown-amount item — left as-is,
      // and NOT rewritten.
      expect(repo.updated, isEmpty);
      final salt = (await repo.all()).firstWhere((i) => i.id == 'salt');
      expect(salt.qty, isNull);
    });

    test('a non-gram-unit ingredient is a shortfall, item untouched',
        () async {
      final repo = buildRepo();
      await repo.add(_oil); // 200 ml — unreconcilable to grams
      repo.updated.clear();

      const meal = MealComposition(
        id: 'oily',
        name: 'Fried something',
        ingredients: [Ingredient(pantryItemId: 'oil', grams: 15)],
      );

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isTrue);
      expect(outcome.shortfallByItemId['oil'], 15);
      expect(repo.updated, isEmpty);
      final oil = (await repo.all()).firstWhere((i) => i.id == 'oil');
      expect(oil.qty, 200); // untouched
    });
  });

  group('EatInService.eatMeal — empty / no-op', () {
    test('a meal with no ingredients writes nothing and reports no shortfall',
        () async {
      final repo = buildRepo();
      await repo.add(_chicken);
      repo.updated.clear();

      const meal =
          MealComposition(id: 'empty', name: 'Nothing', ingredients: []);

      final outcome = await EatInService(repo).eatMeal(meal);

      expect(outcome.hadShortfall, isFalse);
      expect(outcome.shortfallByItemId, isEmpty);
      expect(repo.updated, isEmpty);
      expect(outcome.writeOutcomes, isEmpty);
    });
  });
}
