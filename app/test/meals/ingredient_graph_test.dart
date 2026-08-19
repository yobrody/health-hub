// Tests for the PURE ingredient-graph logic (P1-T4) — the keystone.
//
// Honesty rules under test:
//  • canMakeFromStock is true ONLY when every ingredient has a matching pantry
//    item with a KNOWN qty (not null) that is ≥ the required grams, and a
//    gram-comparable unit. Missing item / null qty / bad unit / too little → false.
//  • deductIngredients never drives stock negative — it clamps at 0 and reports
//    a shortfall; it never mutates the input list.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/meals/meal_composition.dart';
import 'package:health_hub/meals/ingredient_graph.dart';
import 'package:health_hub/pantry/pantry_item.dart';

PantryItem _item(String id, {double? qty, String? unit = 'g'}) => PantryItem(
      id: id,
      name: id,
      zone: PantryZone.pantry,
      qty: qty,
      unit: unit,
      source: 'manual',
    );

const _chickenRice = MealComposition(
  id: 'm1',
  name: 'Chicken & rice',
  ingredients: [
    Ingredient(pantryItemId: 'chicken', grams: 200),
    Ingredient(pantryItemId: 'rice', grams: 100),
  ],
);

void main() {
  group('canMakeFromStock', () {
    test('true when all ingredients present with enough known qty', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: 300),
      ];
      expect(canMakeFromStock(_chickenRice, stock), isTrue);
    });

    test('true at the exact boundary (qty == grams)', () {
      final stock = [
        _item('chicken', qty: 200),
        _item('rice', qty: 100),
      ];
      expect(canMakeFromStock(_chickenRice, stock), isTrue);
    });

    test('false when an ingredient item is MISSING from stock', () {
      final stock = [
        _item('chicken', qty: 500),
        // no rice at all
      ];
      expect(canMakeFromStock(_chickenRice, stock), isFalse);
    });

    test('false when a required item qty is NULL (unknown — not a guess)', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: null), // unknown amount
      ];
      expect(canMakeFromStock(_chickenRice, stock), isFalse);
    });

    test('false when qty is less than the required grams', () {
      final stock = [
        _item('chicken', qty: 150), // need 200
        _item('rice', qty: 300),
      ];
      expect(canMakeFromStock(_chickenRice, stock), isFalse);
    });

    test('false when a unit is non-gram / unreconcilable', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: 300, unit: 'cups'), // can't reconcile to grams
      ];
      expect(canMakeFromStock(_chickenRice, stock), isFalse);
    });

    test('true when unit is null (treated as grams — the pantry default)', () {
      final stock = [
        _item('chicken', qty: 500, unit: null),
        _item('rice', qty: 300, unit: null),
      ];
      expect(canMakeFromStock(_chickenRice, stock), isTrue);
    });

    test('a meal with no ingredients is trivially makeable', () {
      const empty = MealComposition(id: 'e', name: 'Nothing', ingredients: []);
      expect(canMakeFromStock(empty, const []), isTrue);
    });
  });

  group('suggestMeals', () {
    test('returns only the makeable meals, preserving input order', () {
      const makeable = _chickenRice;
      const notMakeable = MealComposition(
        id: 'm2',
        name: 'Steak',
        ingredients: [Ingredient(pantryItemId: 'steak', grams: 250)],
      );
      const alsoMakeable = MealComposition(
        id: 'm3',
        name: 'Rice bowl',
        ingredients: [Ingredient(pantryItemId: 'rice', grams: 50)],
      );
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: 300),
        // no steak
      ];

      final result = suggestMeals(
        const [makeable, notMakeable, alsoMakeable],
        stock,
      );
      expect(result.map((m) => m.id), ['m1', 'm3']);
    });

    test('empty when nothing is makeable', () {
      final result = suggestMeals(const [_chickenRice], const []);
      expect(result, isEmpty);
    });
  });

  group('deductIngredients', () {
    test('reduces each item qty by the right grams', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: 300),
      ];
      final result = deductIngredients(stock, _chickenRice);

      expect(result.hadShortfall, isFalse);
      expect(result.shortfallByItemId, isEmpty);
      final byId = {for (final i in result.updatedStock) i.id: i};
      expect(byId['chicken']!.qty, 300); // 500 - 200
      expect(byId['rice']!.qty, 200); // 300 - 100
    });

    test('does NOT mutate the input stock list or items', () {
      final chicken = _item('chicken', qty: 500);
      final rice = _item('rice', qty: 300);
      final stock = [chicken, rice];

      deductIngredients(stock, _chickenRice);

      expect(chicken.qty, 500); // original untouched
      expect(rice.qty, 300);
      expect(stock.length, 2);
    });

    test('clamps at 0 and flags a shortfall instead of going negative', () {
      final stock = [
        _item('chicken', qty: 150), // need 200 → 50 short
        _item('rice', qty: 300),
      ];
      final result = deductIngredients(stock, _chickenRice);

      final byId = {for (final i in result.updatedStock) i.id: i};
      expect(byId['chicken']!.qty, 0); // clamped, never -50
      expect(result.hadShortfall, isTrue);
      expect(result.shortfallByItemId['chicken'], 50);
      expect(result.shortfallByItemId.containsKey('rice'), isFalse);
    });

    test('missing item → recorded as full shortfall, no crash', () {
      final stock = [
        _item('chicken', qty: 500),
        // no rice
      ];
      final result = deductIngredients(stock, _chickenRice);

      expect(result.hadShortfall, isTrue);
      expect(result.shortfallByItemId['rice'], 100); // all of it short
      // chicken still deducted honestly
      final byId = {for (final i in result.updatedStock) i.id: i};
      expect(byId['chicken']!.qty, 300);
    });

    test('null-qty item → recorded as full shortfall, item left unchanged', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: null),
      ];
      final result = deductIngredients(stock, _chickenRice);

      expect(result.hadShortfall, isTrue);
      expect(result.shortfallByItemId['rice'], 100);
      final byId = {for (final i in result.updatedStock) i.id: i};
      expect(byId['rice']!.qty, isNull); // untouched, not fabricated to 0
    });

    test('non-gram unit → shortfall, item unchanged (unreconcilable)', () {
      final stock = [
        _item('chicken', qty: 500),
        _item('rice', qty: 300, unit: 'cups'),
      ];
      final result = deductIngredients(stock, _chickenRice);

      expect(result.hadShortfall, isTrue);
      expect(result.shortfallByItemId['rice'], 100);
      final byId = {for (final i in result.updatedStock) i.id: i};
      expect(byId['rice']!.qty, 300); // unchanged
    });
  });
}
