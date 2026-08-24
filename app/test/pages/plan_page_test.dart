// Widget tests for PlanPage — the agentic "plan my week" flow, driven by the
// JourneyHarness fakes (in-memory repos + FakeMealPlanClient). No network.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/meals/eat_in_service.dart';
import 'package:health_hub/nutrition/food_log_entry.dart' show AccuracyTier;
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/pages/plan_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';

import '../e2e/journey_scope.dart';

MealPlan _cannedPlan() => MealPlan(
      id: 'plan-canned',
      weekStart: DateTime(2026, 8, 24),
      days: [
        PlanDay(date: DateTime(2026, 8, 24), meals: [
          PlanMeal(
            name: 'Oats & yogurt',
            slot: MealSlot.breakfast,
            tier: AccuracyTier.estimate,
            kcal: 420,
            ingredients: const [
              PlanIngredient(name: 'Oats', grams: 60), // in pantry (covered)
              PlanIngredient(name: 'Blueberries', grams: 80), // absent → gap
            ],
          ),
        ]),
      ],
    );

Widget _host(JourneyHarness h, {DateTime? now}) => ProviderScope(
      overrides: h.overrides,
      child: MaterialApp(
        home: PlanPage(
          planRepo: h.mealPlanRepo,
          planClient: h.planClient,
          goalsRepo: h.goalsRepo,
          pantryRepo: h.pantryRepo,
          groceryRepo: h.groceryRepo,
          nutritionRepo: h.nutritionRepo,
          eatInService: EatInService(h.pantryRepo),
          now: now ?? DateTime(2026, 8, 24),
        ),
      ),
    );

void main() {
  testWidgets('no goal → honest "set your goal first", no generate button',
      (tester) async {
    final h = JourneyHarness(); // no goals seeded
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('plan-needs-goal')), findsOneWidget);
    expect(find.byKey(const Key('plan-generate-btn')), findsNothing);
  });

  testWidgets('has goal, no plan → generate builds + shows the plan + gaps',
      (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      pantry: [
        const PantryItem(
            id: 'p1',
            name: 'Oats',
            zone: PantryZone.pantry,
            qty: 500,
            unit: 'g',
            source: 'manual'),
      ],
      planResult: _cannedPlan(),
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('plan-generate-btn')), findsOneWidget);
    await tester.tap(find.byKey(const Key('plan-generate-btn')));
    await tester.pumpAndSettle();

    // The plan renders (day card + the meal — shown as "Breakfast · <name>"),
    // and the shopping card shows only the gap (Blueberries), NOT Oats (covered
    // by the 500g pantry).
    expect(find.textContaining('Oats & yogurt'), findsWidgets);
    expect(find.byKey(const Key('plan-shopping-card')), findsOneWidget);
    expect(find.text('Blueberries'), findsOneWidget); // the gap row.

    // The plan persisted.
    expect(await h.mealPlanRepo.load(), isNotNull);
    // The client received the real goal + pantry.
    expect(h.planClient.lastGoals!.caloriesKcal, 2600);
    expect(h.planClient.lastPantry!.single.name, 'Oats');
  });

  testWidgets('add gaps to cart → only the gap lands in the grocery list',
      (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      pantry: [
        const PantryItem(
            id: 'p1',
            name: 'Oats',
            zone: PantryZone.pantry,
            qty: 500,
            unit: 'g',
            source: 'manual'),
      ],
      mealPlan: _cannedPlan(), // start with a plan already generated
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('plan-add-to-cart-btn')));
    await tester.pumpAndSettle();

    final cart = await h.groceryRepo.all();
    expect(cart.map((i) => i.name), ['Blueberries']); // the gap only.
    expect(find.text('Added to cart ✓'), findsOneWidget);
  });

  testWidgets('log a planned meal → macros logged AND pantry deducted',
      (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      pantry: [
        const PantryItem(
            id: 'p1',
            name: 'Oats',
            zone: PantryZone.pantry,
            qty: 500,
            unit: 'g',
            source: 'manual'),
      ],
      mealPlan: _cannedPlan(), // breakfast: Oats 60g (have) + Blueberries 80g
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('plan-log-meal-0:0')));
    await tester.pumpAndSettle();

    // Macros landed in the food log.
    final log = await h.nutritionRepo.all();
    expect(log.map((e) => e.name), contains('Oats & yogurt'));
    expect(log.single.kcal, 420);
    expect(log.single.tier, AccuracyTier.estimate);

    // Pantry Oats deducted 60g (500 → 440); Blueberries weren't in the pantry.
    final oats = (await h.pantryRepo.all()).firstWhere((i) => i.id == 'p1');
    expect(oats.qty, 440);

    // The button flips to a logged state.
    expect(find.text('Logged ✓'), findsOneWidget);
  });

  testWidgets('rapid double-tap on "Log this meal" logs + deducts ONCE',
      (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      pantry: [
        const PantryItem(
            id: 'p1', name: 'Oats', zone: PantryZone.pantry, qty: 500, unit: 'g', source: 'manual'),
      ],
      mealPlan: _cannedPlan(),
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    // Two taps before any rebuild — the in-flight guard must collapse them.
    final btn = find.byKey(const Key('plan-log-meal-0:0'));
    await tester.tap(btn, warnIfMissed: false);
    await tester.tap(btn, warnIfMissed: false);
    await tester.pumpAndSettle();

    expect((await h.nutritionRepo.all()).length, 1); // one entry, not two.
    final oats = (await h.pantryRepo.all()).firstWhere((i) => i.id == 'p1');
    expect(oats.qty, 440); // deducted 60g once, not 120g.
  });

  testWidgets('planner returns null → honest "couldn\'t plan", no fabrication',
      (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      // planResult null → the fake client returns null.
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('plan-generate-btn')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('plan-error')), findsOneWidget);
    // Still no plan — nothing fabricated.
    expect(await h.mealPlanRepo.load(), isNull);
  });

  testWidgets('empty pantry → honest "buy to cook this week" copy, not "the '
      'rest is in your kitchen"', (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      // no pantry → everything is a gap; there is no "rest" in the kitchen.
      mealPlan: _cannedPlan(),
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.textContaining('to cook this week'), findsOneWidget);
    expect(find.textContaining('the rest is in your kitchen'), findsNothing);
  });

  testWidgets('a plan the pantry fully covers → "you have everything", no cart '
      'button', (tester) async {
    final h = JourneyHarness(
      goals: {'caloriesKcal': 2600.0},
      pantry: [
        const PantryItem(
            id: 'p1', name: 'Oats', zone: PantryZone.pantry, qty: 500, unit: 'g', source: 'manual'),
        const PantryItem(
            id: 'p2', name: 'Blueberries', zone: PantryZone.fridge, qty: 300, unit: 'g', source: 'manual'),
      ],
      mealPlan: _cannedPlan(),
    );
    await tester.pumpWidget(_host(h));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('plan-no-gaps')), findsOneWidget);
    expect(find.byKey(const Key('plan-add-to-cart-btn')), findsNothing);
  });
}
