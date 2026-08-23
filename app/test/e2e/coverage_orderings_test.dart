// EXHAUSTIVE ordering coverage — the interconnection must hold regardless of the
// SEQUENCE of actions. These drive the REAL app through the same actions in
// DIFFERENT orders and assert the Brain / cart / kitchen / nutrition end up in
// the SAME correct, honest, consistent state either way.
//
// The reactive providers (groceryListProvider, brainInputsProvider) are the
// thing under test: no stale views, no order-dependence. Every assertion is
// against REAL store state or an honest on-screen value.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';

import 'journey_scope.dart';

void main() {
  Finder pageScroll(Key pageKey) => find
      .descendant(of: find.byKey(pageKey), matching: find.byType(Scrollable))
      .first;

  Future<void> pumpApp(WidgetTester tester, JourneyHarness h) async {
    // A taller surface so the long scrollables (the gym gate under its Brain
    // setup card, Home under its cards) fit comfortably — keeps multi-step
    // sequences robust without fighting the fold. Reset after the test.
    tester.view.physicalSize = const Size(1000, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(overrides: h.overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();
  }

  // Set a calorie goal via the Home goals editor.
  Future<void> setGoalOnHome(WidgetTester tester, String kcal) async {
    // Ensure we're on Home.
    if (find.text('Home').evaluate().isNotEmpty) {
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
    }
    await tester.scrollUntilVisible(
      find.byKey(const Key('today-edit-goals')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('today-edit-goals')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('goals-kcal')), kcal);
    await tester.tap(find.byKey(const Key('goals-save')));
    await tester.pumpAndSettle();
  }

  // Log a simple In meal via the Home → Nutrition route.
  Future<void> logMealViaHome(
    WidgetTester tester,
    String name,
    String kcal,
  ) async {
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('home-log-meal-btn')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('home-log-meal-btn')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('nutrition-name')), name);
    await tester.enterText(find.byKey(const Key('nutrition-kcal')), kcal);
    await tester.scrollUntilVisible(
      find.byKey(const Key('nutrition-log-btn')),
      200,
      scrollable: pageScroll(const Key('nutrition-page')),
    );
    await tester.tap(find.byKey(const Key('nutrition-log-btn')));
    await tester.pumpAndSettle();
    // Back to Home so the next step starts from a known tab.
    await tester.pageBack();
    await tester.pumpAndSettle();
  }

  // Open the Nutrition page from Home (scrolls the log-meal button into view).
  Future<void> openNutritionFromHome(WidgetTester tester) async {
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('home-log-meal-btn')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('home-log-meal-btn')));
    await tester.pumpAndSettle();
  }

  // Log a workout (start → pick → set → skip rest → finish) from the Gym tab.
  Future<void> logWorkout(WidgetTester tester) async {
    await tester.tap(find.text('Gym'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('gym-start-btn')),
      200,
      scrollable: pageScroll(const Key('gym-page')),
    );
    await tester.tap(find.byKey(const Key('gym-start-btn')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('gym-exercise-leg-press')));
    await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('gym-weight-field')), '100');
    await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
    await tester.ensureVisible(find.byKey(const Key('gym-log-set-btn')));
    await tester.tap(find.byKey(const Key('gym-log-set-btn')));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('gym-finish-btn')));
    await tester.tap(find.byKey(const Key('gym-finish-btn')));
    await tester.pumpAndSettle();
  }

  // ── goal → meal  vs  meal → goal : the EAT insight is identical either way ──
  group('goal vs meal ordering', () {
    testWidgets('goal THEN meal → EAT insight = 2000 − 500 = 1500 left',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h);
      await setGoalOnHome(tester, '2000');
      await logMealViaHome(tester, 'Chicken', '500');

      // On Nutrition the EAT insight cites the real remaining calories.
      await openNutritionFromHome(tester);
      expect(find.textContaining('1500 kcal left'), findsOneWidget);
    });

    testWidgets('meal THEN goal → SAME EAT insight (order-independent)',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h);
      // Reverse order: log the meal FIRST, then set the goal.
      await logMealViaHome(tester, 'Chicken', '500');
      await setGoalOnHome(tester, '2000');

      await openNutritionFromHome(tester);
      // Same honest arithmetic regardless of which came first.
      expect(find.textContaining('1500 kcal left'), findsOneWidget);

      // And the REAL stores agree.
      final goals = await h.goalsRepo.load();
      expect(goals.caloriesKcal, 2000);
      final log = await h.nutritionRepo.all();
      expect(log.single.kcal, 500);
    });
  });

  // ── workout before vs after goal : TRAIN insight is real either way ─────────
  group('workout vs goal ordering', () {
    testWidgets('workout BEFORE goal → both a real TRAIN + EAT insight surface',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h);
      await logWorkout(tester);
      await setGoalOnHome(tester, '2200');

      // Gym now shows a REAL train insight (setup prompt gone).
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-train-setup')), findsNothing);
      expect(find.byKey(const Key('insight-card-train')), findsOneWidget);

      // Real stores: a finished workout + a real goal.
      expect((await h.workoutRepo.all()).single.finished, isTrue);
      expect((await h.goalsRepo.load()).caloriesKcal, 2200);
    });

    testWidgets('goal BEFORE workout → identical end state',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h);
      await setGoalOnHome(tester, '2200');
      await logWorkout(tester);

      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-train-setup')), findsNothing);
      expect(find.byKey(const Key('insight-card-train')), findsOneWidget);
      expect((await h.workoutRepo.all()).single.finished, isTrue);
      expect((await h.goalsRepo.load()).caloriesKcal, 2200);
    });
  });

  // ── add-to-cart before vs after logging a meal : cart is consistent ─────────
  group('cart vs meal ordering', () {
    testWidgets('add-to-cart from Food BEFORE logging a meal → both consistent',
        (tester) async {
      final h = JourneyHarness(pantry: [lowPantryItem('Milk')]);
      await pumpApp(tester, h);

      // Add the low item to the cart from Food FIRST.
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('insight-action-buy-milk')));
      await tester.tap(find.byKey(const Key('insight-action-buy-milk')));
      await tester.pumpAndSettle();
      expect((await h.groceryRepo.all()).map((i) => i.name), contains('Milk'));

      // THEN log a meal.
      await logMealViaHome(tester, 'Eggs', '300');

      // Both persisted; the cart still holds Milk, the log holds Eggs.
      expect((await h.groceryRepo.all()).map((i) => i.name), contains('Milk'));
      expect((await h.nutritionRepo.all()).single.name, 'Eggs');
    });

    testWidgets('log a meal BEFORE add-to-cart → identical end state',
        (tester) async {
      final h = JourneyHarness(pantry: [lowPantryItem('Milk')]);
      await pumpApp(tester, h);

      // Log a meal FIRST.
      await logMealViaHome(tester, 'Eggs', '300');
      // THEN add the low item to the cart from Food.
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('insight-action-buy-milk')));
      await tester.tap(find.byKey(const Key('insight-action-buy-milk')));
      await tester.pumpAndSettle();

      expect((await h.groceryRepo.all()).map((i) => i.name), contains('Milk'));
      expect((await h.nutritionRepo.all()).single.name, 'Eggs');
    });
  });

  // ── visit tabs in several sequences → Brain/cart/kitchen stay consistent ────
  group('tab-visit sequences', () {
    testWidgets('Home→Food→Gym→Cart→Home keeps every surface consistent',
        (tester) async {
      final h = JourneyHarness(pantry: [lowPantryItem('Milk')]);
      await pumpApp(tester, h);

      // A tour of every tab in one order.
      for (final tab in ['Food', 'Gym', 'Cart', 'Home', 'Cart', 'Food']) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
      }

      // Add Milk to the cart from Food.
      await tester.ensureVisible(find.byKey(const Key('insight-action-buy-milk')));
      await tester.tap(find.byKey(const Key('insight-action-buy-milk')));
      await tester.pumpAndSettle();

      // The Cart badge reflects the real count regardless of the tour taken.
      final badge = tester.widget<Badge>(
        find.ancestor(
          of: find.byIcon(Icons.shopping_cart_outlined),
          matching: find.byType(Badge),
        ),
      );
      expect(badge.isLabelVisible, isTrue);
      expect((badge.label as Text).data, '1');

      // Cart shows the live row; the BUY suggestion dropped everywhere.
      await tester.tap(find.text('Cart'));
      await tester.pumpAndSettle();
      expect(find.text('Milk'), findsWidgets);
      expect(find.byKey(const Key('insight-card-buy-milk')), findsNothing);
    });
  });

  // ── eat-in deduction THEN restock/cart : the loop closes in this order too ──
  group('eat-in → restock → cart ordering', () {
    testWidgets('eat-in deducts a pantry item low enough to surface a BUY, then '
        'adding it to the cart drops the suggestion', (tester) async {
      // Rice at 150 g. Eating 100 g leaves 50 g (< 100 g low threshold) → it
      // becomes a genuine BUY signal AFTER the deduction.
      final h = JourneyHarness(pantry: [
        lowPantryItem('Rice').copyWith(qty: 150),
      ]);
      await pumpApp(tester, h);

      // No BUY yet (150 g is above the 100 g low threshold).
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-buy-rice')), findsNothing);

      // Log an eat-in meal deducting 100 g of Rice.
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('home-log-meal-btn')),
        -200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Rice bowl');
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-add-ingredient')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-add-ingredient')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nutrition-ingredient-item')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rice').last);
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('nutrition-ingredient-grams')), '100');
      await tester.tap(find.byKey(const Key('nutrition-ingredient-confirm')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      // The pantry deducted to 50 g.
      expect((await h.pantryRepo.all()).single.qty, 50);

      // A no-shortfall eat-in shows the "Pantry updated" confirmation sheet —
      // dismiss it (tap Done) before navigating back off the Nutrition route.
      if (find.byKey(const Key('eatin-confirmation-sheet')).evaluate().isNotEmpty) {
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
      }

      // Back to Food → the BUY insight NOW surfaces (real low signal appeared).
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-buy-rice')), findsOneWidget);

      // Add it to the cart → the suggestion drops (loop closed, in this order).
      await tester.ensureVisible(find.byKey(const Key('insight-action-buy-rice')));
      await tester.tap(find.byKey(const Key('insight-action-buy-rice')));
      await tester.pumpAndSettle();
      expect((await h.groceryRepo.all()).map((i) => i.name), contains('Rice'));
      await tester.tap(find.text('Cart'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-buy-rice')), findsNothing);
    });
  });
}
