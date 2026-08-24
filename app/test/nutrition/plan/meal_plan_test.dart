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

    test('real AI name variance is matched to the pantry — parenthetical '
        'qualifiers and plurals do NOT create false gaps (honesty)', () {
      // Observed live from the plan-week fn: Gemini writes "Brown rice (cooked)"
      // / "Banana" while the pantry says "Brown rice" / "Bananas". Exact matching
      // told the user to buy rice + bananas they already had.
      final plan = _plan([
        _meal([
          const PlanIngredient(name: 'Brown rice (cooked)', grams: 220),
          const PlanIngredient(name: 'Banana', grams: 100),
          const PlanIngredient(name: 'Milk (2%)', grams: 200), // genuinely absent
        ]),
      ]);
      final pantry = [
        _pantry('Brown rice', qty: 1200, unit: 'g'),
        _pantry('Bananas', qty: 4, unit: 'x'),
      ];
      final needed = neededIngredients(plan, pantry);
      // Rice + bananas are matched to the pantry (not false gaps); only the
      // genuinely-absent milk remains on the shopping list.
      expect(needed.map((n) => n.name), ['Milk (2%)']);
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

  group('resolveDeductions', () {
    test('resolves plan ingredients to pantry ids (robust name match), skips '
        'unmatched + unquantified', () {
      final meal = _meal([
        const PlanIngredient(name: 'Brown rice (cooked)', grams: 220), // → id r
        const PlanIngredient(name: 'Bananas', grams: 100), // → id b (plural)
        const PlanIngredient(name: 'Salt'), // no grams → skipped
        const PlanIngredient(name: 'Saffron', grams: 1), // not in pantry → skip
      ]);
      final pantry = [
        const PantryItem(
            id: 'r',
            name: 'Brown rice',
            zone: PantryZone.pantry,
            qty: 1200,
            unit: 'g',
            source: 'manual'),
        const PantryItem(
            id: 'b',
            name: 'Banana',
            zone: PantryZone.fridge,
            qty: 400,
            unit: 'g',
            source: 'manual'),
      ];
      final ded = resolveDeductions(meal, pantry);
      expect(ded.map((d) => d.pantryItemId), ['r', 'b']);
      expect(ded.firstWhere((d) => d.pantryItemId == 'r').grams, 220);
      expect(ded.firstWhere((d) => d.pantryItemId == 'b').grams, 100);
    });

    test('nothing deductible → empty list (never fabricated)', () {
      final meal = _meal([const PlanIngredient(name: 'Truffle', grams: 5)]);
      expect(resolveDeductions(meal, const []), isEmpty);
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
