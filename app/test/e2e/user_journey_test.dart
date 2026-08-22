// End-to-end user-journey tests — the capstone.
//
// Unlike the per-screen widget tests, these pump the REAL application root
// (`HealthHubApp`: the auth gate → the first-run gate → RootScaffold's Home /
// Food / Gym / Cart nav) with every provider overridden to shared in-memory
// fakes (see `journey_scope.dart`), and drive a coherent multi-screen journey
// with real taps and entries. Each step asserts BOTH the local screen result
// AND the cross-screen interconnection: the Brain reads the same repos the UI
// wrote, so an action on one screen genuinely changes what another screen (and
// the Brain) shows.
//
// What this proves that per-screen tests can't:
//   • the whole widget tree composes and navigates for real (no mock nav);
//   • the Brain's insights are computed from the user's REAL, just-entered data
//     and cite real numbers in their "why" (honesty, end-to-end);
//   • the eat → goal → Brain and pantry → BUY → cart loops close across screens
//     through the SAME shared stores.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';

import 'journey_scope.dart';

void main() {
  // ── Journey 1: goal → meal → the Brain's honest EAT insight ────────────────
  //
  // Proves: setting a goal on Home and logging a meal via the Home→Nutrition
  // route both persist to the REAL repos, and the Brain then surfaces an EAT
  // insight whose title + "why" are the real (goal − eaten) arithmetic — not a
  // fabricated number. This is the eat→deplete loop's nutrition half, woven
  // across Home and Nutrition through one shared store.
  testWidgets(
      'goal set on Home + meal logged via Nutrition → Brain EAT insight cites real remaining macros',
      (tester) async {
    final h = JourneyHarness();
    await tester.pumpWidget(
      ProviderScope(overrides: h.overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();

    // 1. Lands in the app (signed-in fake auth + a seeded profile → past both
    //    gates), on Home.
    expect(find.byKey(const Key('today-page')), findsOneWidget);
    // No goal yet → Home shows no "For you" section (setup prompts are excluded
    // from Home, and nothing else is real yet).
    expect(find.byKey(const Key('home-brain')), findsNothing);

    // 2. Set a daily calorie + protein goal via the Home goals editor.
    await tester.scrollUntilVisible(
      find.byKey(const Key('today-edit-goals')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('today-edit-goals')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('goals-kcal')), '2000');
    await tester.enterText(find.byKey(const Key('goals-protein')), '150');
    await tester.tap(find.byKey(const Key('goals-save')));
    await tester.pumpAndSettle();

    // It persisted to the REAL goals repo — not a UI-only echo.
    final savedGoals = await h.goalsRepo.load();
    expect(savedGoals.caloriesKcal, 2000);
    expect(savedGoals.proteinG, 150);

    // 3. Log a meal via Home → Nutrition ("In" is the default mode). 500 kcal,
    //    40 g protein. Scroll back up to the log-meal button (setting the goal
    //    scrolled the Home list down).
    await tester.scrollUntilVisible(
      find.byKey(const Key('home-log-meal-btn')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('home-log-meal-btn')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nutrition-page')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('nutrition-name')), 'Chicken');
    await tester.enterText(find.byKey(const Key('nutrition-kcal')), '500');
    await tester.enterText(find.byKey(const Key('nutrition-protein')), '40');
    // The log button is below the fold in the Nutrition ListView (the EAT card
    // + the form fields sit above it) — scroll it into view (builds lazily).
    // The outer Nutrition ListView is the FIRST scrollable under the page (the
    // text fields have their own inner scrollables, so scope to the page).
    final nutritionScroll = find
        .descendant(
          of: find.byKey(const Key('nutrition-page')),
          matching: find.byType(Scrollable),
        )
        .first;
    await tester.scrollUntilVisible(
      find.byKey(const Key('nutrition-log-btn')),
      200,
      scrollable: nutritionScroll,
    );
    await tester.tap(find.byKey(const Key('nutrition-log-btn')));
    await tester.pumpAndSettle();

    // Persisted to the REAL nutrition repo (the meal genuinely exists).
    final log = await h.nutritionRepo.all();
    expect(log, hasLength(1));
    expect(log.single.name, 'Chicken');
    expect(log.single.kcal, 500);
    expect(log.single.proteinG, 40);

    // 4. The Brain's EAT insight, on the SAME Nutrition screen, now reflects the
    //    real remaining macros: 2000 − 500 = 1500 kcal, 150 − 40 = 110 g protein.
    //    Scroll back up to it (it sits above the form, now scrolled off).
    await tester.scrollUntilVisible(
      find.byKey(const Key('insight-card-eat')),
      -200,
      scrollable: nutritionScroll,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('nutrition-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-eat')), findsOneWidget);
    expect(
      find.textContaining('1500 kcal · 110 g protein left'),
      findsOneWidget,
    );

    // Expand the card's "why" — it must cite the REAL goal + real eaten totals,
    // the traceable numbers the user just entered (honesty, visible).
    await tester.tap(find.byKey(const Key('insight-why-eat')));
    await tester.pumpAndSettle();
    expect(find.text('2000 kcal'), findsOneWidget); // Calorie goal
    expect(find.text('500 kcal'), findsOneWidget); // Eaten today
    expect(find.text('150 g'), findsOneWidget); // Protein goal
    expect(find.text('40 g'), findsOneWidget); // Protein eaten
  });

  // ── Journey 2: log a workout → the Brain's TRAIN insight goes real ─────────
  //
  // Proves: the Gym flow (start → pick exercise → log a set → finish) persists a
  // finished session, and the Brain's TRAIN slice flips from the honest setup
  // prompt to a real insight grounded in that session ("Last trained today").
  testWidgets(
      'workout logged in Gym → Brain TRAIN insight reflects the real session',
      (tester) async {
    final h = JourneyHarness();
    await tester.pumpWidget(
      ProviderScope(overrides: h.overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();

    // Go to the Gym tab. With no history the Brain shows the honest TRAIN setup
    // prompt (never a fabricated "due" date).
    await tester.tap(find.text('Gym'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gym-page')), findsOneWidget);
    expect(find.byKey(const Key('gym-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-train-setup')), findsOneWidget);

    // Start a session → pick a machine lift → log a real set. The gate's start
    // button sits in a centered/scrollable card — ensure it's on-screen so the
    // tap lands.
    await tester.ensureVisible(find.byKey(const Key('gym-start-btn')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('gym-start-btn')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('gym-exercise-leg-press')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
    await tester.pumpAndSettle();
    // Enter 97 kg — an impossible machine notch (the stack steps by 5). The app
    // must snap it to a REAL notch before saving; we assert 95 below, so this
    // genuinely exercises the snap (unlike a value that's already on a notch).
    await tester.enterText(find.byKey(const Key('gym-weight-field')), '97');
    await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
    await tester.ensureVisible(find.byKey(const Key('gym-log-set-btn')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('gym-log-set-btn')));
    // The rest timer runs after logging — pump frames, don't settle.
    await tester.pump();
    await tester.pump();
    // Cancel the rest timer so the tree can settle for the finish tap.
    await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
    await tester.pumpAndSettle();

    // Finish → the session is a real, finished workout in the repo.
    await tester.ensureVisible(find.byKey(const Key('gym-finish-btn')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('gym-finish-btn')));
    await tester.pumpAndSettle();

    final workouts = await h.workoutRepo.all();
    expect(workouts, hasLength(1));
    expect(workouts.single.finished, isTrue);
    // The set was persisted, honestly snapped to a real machine notch: 97 kg is
    // not a valid 5 kg-stack notch, so it was stored as the nearest real one, 95.
    final sets = workouts.single.exercises.single.sets;
    expect(sets.single.weightKg, 95.0);
    expect(sets.single.reps, 10);

    // The Brain's TRAIN insight is now REAL: the setup prompt is gone and the
    // insight cites the real "last trained" fact.
    expect(find.byKey(const Key('insight-card-train-setup')), findsNothing);
    expect(find.byKey(const Key('insight-card-train')), findsOneWidget);
    // Expand its "why" — it names the real last-trained fact from the session.
    await tester.ensureVisible(find.byKey(const Key('insight-why-train')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('insight-why-train')));
    await tester.pumpAndSettle();
    expect(find.text('Last trained'), findsOneWidget);
    expect(find.text('today'), findsOneWidget);
  });

  // ── Journey 3: pantry BUY insight → add to Cart from the insight ───────────
  //
  // Proves the restock→cart loop end-to-end across screens: a low pantry item
  // surfaces a BUY insight on Food; tapping its add-to-list action writes the
  // REAL item to the SAME grocery list the Cart reads; the item lands on the
  // Cart list and the Cart tab's badge reflects it. The interconnection: an
  // action on Food changes what Cart shows, via one shared store + the Brain.
  testWidgets(
      'low pantry item → BUY insight on Food → add lands on the Cart list + badge',
      (tester) async {
    final h = JourneyHarness(pantry: [lowPantryItem('Milk')]);
    await tester.pumpWidget(
      ProviderScope(overrides: h.overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();

    // Home surfaces the real BUY insight in "For you" (a low item is genuine).
    expect(find.byKey(const Key('home-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-buy-milk')), findsOneWidget);

    // Go to Food — the BUY insight is woven there too, with its restock "why".
    await tester.tap(find.text('Food'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('food-brain')), findsOneWidget);
    final buyCard = find.byKey(const Key('insight-card-buy-milk'));
    expect(buyCard, findsOneWidget);
    expect(find.text('Restock Milk'), findsOneWidget);

    // The "why" cites the real in-stock quantity (20 g) — not an invented one.
    await tester.ensureVisible(find.byKey(const Key('insight-why-buy-milk')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('insight-why-buy-milk')));
    await tester.pumpAndSettle();
    expect(find.text('20 g'), findsOneWidget);

    // Nothing on the Cart list yet.
    expect(await h.groceryRepo.all(), isEmpty);

    // Tap the insight's "Add to list" action.
    await tester.ensureVisible(find.byKey(const Key('insight-action-buy-milk')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('insight-action-buy-milk')));
    await tester.pumpAndSettle();

    // Interconnection proof #1: the REAL grocery list — the SAME store the Cart
    // reads — now holds the item. The write crossed screens through shared state.
    final list = await h.groceryRepo.all();
    expect(list.map((i) => i.name), contains('Milk'));

    // Interconnection proof #2: the Cart tab's live badge reflects the new count.
    // The badge reads the reactive groceryListProvider, so it updated the moment
    // the item was added — no tab-switch needed. The count is REAL (1), not faked.
    final badge = tester.widget<Badge>(
      find.ancestor(
        of: find.byIcon(Icons.shopping_cart_outlined),
        matching: find.byType(Badge),
      ),
    );
    expect(badge.isLabelVisible, isTrue);
    expect((badge.label as Text).data, '1');

    // Interconnection proof #3: switch to the Cart tab and the item is a REAL,
    // LIVE list row — even though the Cart page stayed alive under the nav's
    // IndexedStack the whole time. This is the fix for the old stale-list gap:
    // the page watches the reactive grocery list, so the add on Food shows here.
    await tester.tap(find.text('Cart'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cart-page')), findsOneWidget);
    expect(find.text('Milk'), findsWidgets); // a genuine, freshly-rendered row

    // Interconnection proof #4: the BUY suggestion no longer nags on Cart — the
    // item is on the (live) list now, so the Brain-fed suggestions drop it (never
    // a duplicate). The honest restock→cart loop has fully closed, across screens.
    expect(find.byKey(const Key('insight-card-buy-milk')), findsNothing);
  });

  // ── Journey 4: a fuller day — seeded history + fresh actions coexist ───────
  //
  // Proves the Brain composes MULTIPLE real insights across kinds on one screen
  // (Home's "For you"), each grounded, honestly ordered (EAT first, then BUY),
  // and that a mid-journey cart add updates the shared state the way the
  // per-screen loop does — but here inside the real full-app nav.
  testWidgets(
      'Home weaves EAT + BUY together from real state, ordered and honest',
      (tester) async {
    final h = JourneyHarness(
      goals: const NutritionGoals(caloriesKcal: 2200).toJson(),
      food: [
        FoodLogEntry(
          id: 'seed-breakfast',
          name: 'Oats',
          at: DateTime.now(),
          kcal: 400,
          proteinG: 20,
          tier: AccuracyTier.exact,
          source: 'manual',
        ),
      ],
      pantry: [lowPantryItem('Eggs')],
      // A finished session yesterday keeps TRAIN as an info insight (not "due"),
      // so it does not crowd Home's top slots — EAT + BUY lead.
      workouts: [
        WorkoutSession(
          id: 'seed-session',
          at: DateTime.now().subtract(const Duration(days: 1)),
          finished: true,
          exercises: const [],
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(overrides: h.overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();

    // Home's "For you" section is present and carries BOTH a real EAT and a real
    // BUY card — the Brain woven multiple kinds from one user's real data.
    expect(find.byKey(const Key('home-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-eat')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-buy-eggs')), findsOneWidget);

    // The EAT insight's real arithmetic: 2200 − 400 = 1800 kcal left.
    expect(find.textContaining('1800 kcal left today'), findsOneWidget);

    // EAT (priority 100) is ordered ABOVE BUY (priority 80): the EAT card sits
    // higher on the screen than the BUY card — honest, most-actionable-first.
    final eatY = tester.getTopLeft(find.byKey(const Key('insight-card-eat'))).dy;
    final buyY =
        tester.getTopLeft(find.byKey(const Key('insight-card-buy-eggs'))).dy;
    expect(eatY, lessThan(buyY));

    // Add the low item from Home's BUY insight → it writes the real list and
    // switches to the Cart tab (Home's addToCart action calls onOpenCart).
    await tester.ensureVisible(find.byKey(const Key('insight-action-buy-eggs')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('insight-action-buy-eggs')));
    await tester.pumpAndSettle();

    // The shared list genuinely holds it, and the app navigated to Cart (Home's
    // addToCart action wrote the real list, then called onOpenCart → Cart tab).
    expect((await h.groceryRepo.all()).map((i) => i.name), contains('Eggs'));
    expect(find.byKey(const Key('cart-page')), findsOneWidget);
    // The Cart badge reflects the real new count — the interconnection is live.
    final badge = tester.widget<Badge>(
      find.ancestor(
        of: find.byIcon(Icons.shopping_cart_outlined),
        matching: find.byType(Badge),
      ),
    );
    expect(badge.isLabelVisible, isTrue);
    expect((badge.label as Text).data, '1');
    // And the item is a REAL, live row on the Cart page (reactive grocery list),
    // with its BUY suggestion dropped — the loop closes here just like journey 3.
    expect(find.text('Eggs'), findsWidgets);
    expect(find.byKey(const Key('insight-card-buy-eggs')), findsNothing);
  });
}
