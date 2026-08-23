// Tests for the meal-plan client seam — the pure parsePlanResponse mapping
// (edge JSON → MealPlan) and the FakeMealPlanClient.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/food_log_entry.dart' show AccuracyTier;
import 'package:health_hub/nutrition/nutrition_goals.dart';
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/nutrition/plan/meal_plan_client.dart';
import 'package:health_hub/pantry/pantry_item.dart';

void main() {
  final weekStart = DateTime(2026, 8, 24);

  group('parsePlanResponse', () {
    test('maps edge JSON into a MealPlan (dates, tier, macros, ingredients)',
        () {
      final data = {
        'days': [
          {
            'meals': [
              {
                'name': 'Oats & yogurt',
                'slot': 'breakfast',
                'kcal': 420,
                'protein_g': 30,
                'carbs_g': 55,
                'fat_g': 9,
                'ingredients': [
                  {'name': 'Oats', 'grams': 60},
                  {'name': 'Greek yogurt', 'grams': 200},
                ],
              },
            ],
          },
          {
            'meals': [
              {'name': 'Chicken & rice', 'slot': 'dinner', 'ingredients': []},
            ],
          },
        ],
        'confidence': 0.7,
      };

      final plan =
          parsePlanResponse(data, weekStart: weekStart, idSeed: 'plan-x');
      expect(plan, isNotNull);
      expect(plan!.id, 'plan-x');
      expect(plan.weekStart, weekStart);
      expect(plan.days, hasLength(2));

      // Day 0 date = weekStart; day 1 = +1 day.
      expect(plan.days[0].date, DateTime(2026, 8, 24));
      expect(plan.days[1].date, DateTime(2026, 8, 25));

      final meal = plan.days.first.meals.single;
      expect(meal.name, 'Oats & yogurt');
      expect(meal.slot, MealSlot.breakfast);
      expect(meal.tier, AccuracyTier.estimate); // always an estimate.
      expect(meal.kcal, 420);
      expect(meal.proteinG, 30);
      expect(meal.ingredients, hasLength(2));
      expect(meal.ingredients.first.grams, 60);
    });

    test('a missing macro stays null, never coerced to 0 (honesty)', () {
      final data = {
        'days': [
          {
            'meals': [
              {
                'name': 'Black coffee',
                'slot': 'snack',
                'kcal': 5,
                // no protein/carbs/fat
                'ingredients': [
                  {'name': 'Coffee'}, // no grams
                ],
              },
            ],
          },
        ],
      };
      final plan =
          parsePlanResponse(data, weekStart: weekStart, idSeed: 'p');
      final meal = plan!.days.single.meals.single;
      expect(meal.kcal, 5);
      expect(meal.proteinG, isNull);
      expect(meal.carbsG, isNull);
      expect(meal.fatG, isNull);
      expect(meal.ingredients.single.grams, isNull); // "a pinch" → null.
    });

    test('an unknown slot falls back to snack', () {
      final data = {
        'days': [
          {
            'meals': [
              {'name': 'Mystery', 'slot': 'brunch', 'ingredients': []},
            ],
          },
        ],
      };
      final plan = parsePlanResponse(data, weekStart: weekStart, idSeed: 'p');
      expect(plan!.days.single.meals.single.slot, MealSlot.snack);
    });

    test('nameless meals and empty days are dropped, not fabricated', () {
      final data = {
        'days': [
          {
            'meals': [
              {'slot': 'lunch', 'ingredients': []}, // no name → dropped
            ],
          },
          {
            'meals': [
              {'name': 'Real meal', 'slot': 'lunch', 'ingredients': []},
            ],
          },
        ],
      };
      final plan = parsePlanResponse(data, weekStart: weekStart, idSeed: 'p');
      // The all-nameless day collapses to empty → dropped; only the real day.
      expect(plan!.days, hasLength(1));
      expect(plan.days.single.meals.single.name, 'Real meal');
    });

    test('no usable days → null (honest "couldn\'t plan", never fabricated)',
        () {
      expect(parsePlanResponse({'days': []}, weekStart: weekStart, idSeed: 'p'),
          isNull);
      expect(parsePlanResponse({}, weekStart: weekStart, idSeed: 'p'), isNull);
      expect(
          parsePlanResponse({
            'days': [
              {'meals': []},
            ],
          }, weekStart: weekStart, idSeed: 'p'),
          isNull);
    });
  });

  group('FakeMealPlanClient', () {
    test('returns the canned plan and records the inputs', () async {
      final canned = MealPlan(
        id: 'canned',
        weekStart: weekStart,
        days: [
          PlanDay(date: weekStart, meals: [
            PlanMeal(
              name: 'Test',
              slot: MealSlot.lunch,
              tier: AccuracyTier.estimate,
              ingredients: const [],
            ),
          ]),
        ],
      );
      final fake = FakeMealPlanClient(result: canned);
      final pantry = [
        const PantryItem(
            id: 'p1', name: 'Eggs', zone: PantryZone.fridge, source: 'manual'),
      ];
      final out = await fake.planWeek(
        goals: const NutritionGoals(caloriesKcal: 2600),
        pantry: pantry,
        weekStart: weekStart,
      );
      expect(out, same(canned));
      expect(fake.lastGoals!.caloriesKcal, 2600);
      expect(fake.lastPantry!.single.name, 'Eggs');
    });

    test('a null result drives the "couldn\'t plan" path', () async {
      final fake = FakeMealPlanClient();
      final out = await fake.planWeek(
        goals: const NutritionGoals(),
        pantry: const [],
        weekStart: weekStart,
      );
      expect(out, isNull);
    });
  });
}
