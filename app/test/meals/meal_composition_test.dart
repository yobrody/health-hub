// Tests for the ingredient-graph model (P1-T4).
//
// Honesty / seam contract mirrors PantryItem:
//  • toJson OMITS every null field (ownerId) — nothing fabricated.
//  • Ingredient references a pantry item by id + required grams.
//  • MealComposition carries the social seam (ownerId null, shared false).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/meals/meal_composition.dart';

void main() {
  group('Ingredient json', () {
    test('round-trips id + grams', () {
      const ing = Ingredient(pantryItemId: 'chicken', grams: 200);
      final round = Ingredient.fromJson(ing.toJson());
      expect(round.pantryItemId, 'chicken');
      expect(round.grams, 200);
    });

    test('grams parses from int or double JSON', () {
      expect(
        Ingredient.fromJson({'pantryItemId': 'x', 'grams': 150}).grams,
        150.0,
      );
      expect(
        Ingredient.fromJson({'pantryItemId': 'x', 'grams': 12.5}).grams,
        12.5,
      );
    });
  });

  group('MealComposition.toJson — omits null seam fields', () {
    test('a minimal meal emits no ownerId, shared defaults false', () {
      const meal = MealComposition(
        id: 'm1',
        name: 'Chicken & rice',
        ingredients: [
          Ingredient(pantryItemId: 'chicken', grams: 200),
          Ingredient(pantryItemId: 'rice', grams: 100),
        ],
      );
      final json = meal.toJson();

      expect(json['id'], 'm1');
      expect(json['name'], 'Chicken & rice');
      expect((json['ingredients'] as List).length, 2);
      // shared is a real boolean state, always emitted.
      expect(json['shared'], false);
      // ownerId unknown → omitted, not fabricated.
      expect(json.containsKey('ownerId'), isFalse);
    });
  });

  group('MealComposition.fromJson — round-trips', () {
    test('a fully-populated meal round-trips exactly', () {
      const meal = MealComposition(
        id: 'm2',
        name: 'Omelette',
        ingredients: [
          Ingredient(pantryItemId: 'eggs', grams: 120),
        ],
        ownerId: 'brody',
        shared: true,
      );
      final round = MealComposition.fromJson(meal.toJson());

      expect(round.id, 'm2');
      expect(round.name, 'Omelette');
      expect(round.ingredients.length, 1);
      expect(round.ingredients.first.pantryItemId, 'eggs');
      expect(round.ingredients.first.grams, 120);
      expect(round.ownerId, 'brody');
      expect(round.shared, isTrue);
    });

    test('social seam defaults: absent ownerId/shared → null / false', () {
      final round = MealComposition.fromJson({
        'id': 'm3',
        'name': 'Toast',
        'ingredients': [
          {'pantryItemId': 'bread', 'grams': 60},
        ],
      });
      expect(round.ownerId, isNull);
      expect(round.shared, isFalse);
    });

    test('absent/empty ingredients → empty list (no crash)', () {
      final round = MealComposition.fromJson({
        'id': 'm4',
        'name': 'Water',
      });
      expect(round.ingredients, isEmpty);
    });
  });
}
