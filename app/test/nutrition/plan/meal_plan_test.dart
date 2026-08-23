import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/food_log_entry.dart' show AccuracyTier;
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/pantry/pantry_item.dart';

// ── Helpers ───────────────────────────────────────────────────────────────────

PlanMeal _meal(List<PlanIngredient> ings, {String name = 'Test meal'}) =>
    PlanMeal(
      name: name,
      slot: MealSlot.dinner,
      kcal: 500,
      proteinG: 40,
      carbsG: 30,
      fatG: 20,
      tier: AccuracyTier.estimate,
      ingredients: ings,
    );

MealPlan _plan(List<PlanMeal> meals) => MealPlan(
      id: 'plan-1',
      weekStart: DateTime(2026, 8, 24),
      days: [PlanDay(date: DateTime(2026, 8, 24), meals: meals)],
    );

PantryItem _pantry(String name, {double? qty, String? unit}) => PantryItem(
      id: 'pi-$name',
      name: name,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      source: 'manual',
    );

void main() {
  group('neededIngredients', () {
    test('an ingredient absent from the pantry is needed', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Chicken breast', grams: 200)]),
      ]);
      final needed = neededIngredients(plan, const []);
      expect(needed, hasLength(1));
      expect(needed.single.name, 'Chicken breast');
      expect(needed.single.gramsNeeded, 200);
      expect(needed.single.coverage, IngredientCoverage.absent);
    });

    test('an ingredient fully covered by pantry grams is NOT needed', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Rice', grams: 100)]),
      ]);
      final needed =
          neededIngredients(plan, [_pantry('Rice', qty: 500, unit: 'g')]);
      expect(needed, isEmpty);
    });

    test('a pantry shortfall is needed, with grams-on-hand disclosed', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Oats', grams: 300)]),
      ]);
      final needed =
          neededIngredients(plan, [_pantry('Oats', qty: 100, unit: 'g')]);
      expect(needed, hasLength(1));
      expect(needed.single.coverage, IngredientCoverage.short);
      expect(needed.single.gramsOnHand, 100);
      expect(needed.single.gramsNeeded, 300);
    });

    test('matching is case- and whitespace-insensitive', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: '  Chicken Breast ', grams: 100)]),
      ]);
      final needed = neededIngredients(
          plan, [_pantry('chicken breast', qty: 500, unit: 'g')]);
      expect(needed, isEmpty);
    });

    test('the same ingredient across meals/days is summed once', () {
      final plan = MealPlan(
        id: 'p',
        weekStart: DateTime(2026, 8, 24),
        days: [
          PlanDay(date: DateTime(2026, 8, 24), meals: [
            _meal([const PlanIngredient(name: 'Eggs', grams: 120)]),
          ]),
          PlanDay(date: DateTime(2026, 8, 25), meals: [
            _meal([const PlanIngredient(name: 'eggs', grams: 60)]),
          ]),
        ],
      );
      final needed = neededIngredients(plan, const []);
      expect(needed, hasLength(1));
      expect(needed.single.gramsNeeded, 180);
    });

    test('a pantry item you have but can\'t quantify is treated as covered '
        '(no nagging to re-buy something visibly in your kitchen)', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Olive oil', grams: 15)]),
      ]);
      // qty/unit unknown → we know it's present, not how much.
      final needed = neededIngredients(plan, [_pantry('Olive oil')]);
      expect(needed, isEmpty);
    });

    test('an ingredient with no grams is still surfaced when absent, '
        'with a null gramsNeeded (honest: amount unknown)', () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Salt')]),
      ]);
      final needed = neededIngredients(plan, const []);
      expect(needed, hasLength(1));
      expect(needed.single.name, 'Salt');
      expect(needed.single.gramsNeeded, isNull);
      expect(needed.single.coverage, IngredientCoverage.absent);
    });

    test('once ANY line of an ingredient is unquantified, the summed total '
        'stays null — a later quantified line must not resurrect it (honesty)',
        () {
      final plan = MealPlan(
        id: 'p',
        weekStart: DateTime(2026, 8, 24),
        days: [
          PlanDay(date: DateTime(2026, 8, 24), meals: [
            _meal([const PlanIngredient(name: 'Salt')]), // grams null
            _meal([const PlanIngredient(name: 'salt', grams: 200)]),
          ]),
        ],
      );
      final needed = neededIngredients(plan, const []);
      expect(needed, hasLength(1));
      expect(needed.single.name, 'Salt');
      // The real total is unknown (one line had no amount) — never 200.
      expect(needed.single.gramsNeeded, isNull);
    });

    test('order-independent: quantified line first, then unquantified → still '
        'null', () {
      final plan = MealPlan(
        id: 'p',
        weekStart: DateTime(2026, 8, 24),
        days: [
          PlanDay(date: DateTime(2026, 8, 24), meals: [
            _meal([const PlanIngredient(name: 'Flour', grams: 100)]),
            _meal([const PlanIngredient(name: 'flour')]), // grams null
          ]),
        ],
      );
      final needed = neededIngredients(plan, const []);
      expect(needed.single.gramsNeeded, isNull);
    });

    test('non-gram pantry units (e.g. "x") count as present, not a shortfall',
        () {
      final plan = _plan([
        _meal([const PlanIngredient(name: 'Eggs', grams: 300)]),
      ]);
      final needed =
          neededIngredients(plan, [_pantry('Eggs', qty: 6, unit: 'x')]);
      expect(needed, isEmpty);
    });
  });

  group('MealPlan JSON round-trip', () {
    test('toJson/fromJson preserves the plan', () {
      final plan = MealPlan(
        id: 'plan-uid-2026W35',
        weekStart: DateTime(2026, 8, 24),
        days: [
          PlanDay(date: DateTime(2026, 8, 24), meals: [
            PlanMeal(
              name: 'Greek yogurt & oats',
              slot: MealSlot.breakfast,
              kcal: 420,
              proteinG: 30,
              carbsG: 55,
              fatG: 9,
              tier: AccuracyTier.estimate,
              ingredients: const [
                PlanIngredient(name: 'Greek yogurt', grams: 200),
                PlanIngredient(name: 'Oats', grams: 60),
              ],
            ),
          ]),
        ],
      );
      final round = MealPlan.fromJson(plan.toJson());
      expect(round.id, plan.id);
      expect(round.weekStart, plan.weekStart);
      expect(round.days.single.meals.single.name, 'Greek yogurt & oats');
      expect(round.days.single.meals.single.slot, MealSlot.breakfast);
      expect(round.days.single.meals.single.tier, AccuracyTier.estimate);
      expect(round.days.single.meals.single.ingredients, hasLength(2));
      expect(round.days.single.meals.single.ingredients.first.grams, 200);
    });

    test('missing macros survive as null, never coerced to 0 (honesty)', () {
      final plan = MealPlan(
        id: 'p',
        weekStart: DateTime(2026, 8, 24),
        days: [
          PlanDay(date: DateTime(2026, 8, 24), meals: [
            PlanMeal(
              name: 'Black coffee',
              slot: MealSlot.snack,
              kcal: 5,
              proteinG: null,
              carbsG: null,
              fatG: null,
              tier: AccuracyTier.estimate,
              ingredients: const [],
            ),
          ]),
        ],
      );
      final round = MealPlan.fromJson(plan.toJson());
      final meal = round.days.single.meals.single;
      expect(meal.proteinG, isNull);
      expect(meal.carbsG, isNull);
      expect(meal.fatG, isNull);
    });
  });
}
