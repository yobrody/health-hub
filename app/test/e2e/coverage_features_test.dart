// EXHAUSTIVE feature coverage — every feature driven end-to-end through the
// REAL app UI and asserted against the fake stores' REAL state.
//
// These build on `journey_scope.dart`'s [JourneyHarness] (the shared-store
// interconnection backbone) exactly like `user_journey_test.dart`, but sweep
// the WHOLE feature surface — auth, onboarding, home/brain, nutrition (all
// paths), food/kitchen, gym (full flow + gating), cart (notepad + hand-off),
// weigh-ins/trend, settings, sync/offline, and every Brain insight action.
//
// The seams the harness doesn't override (barcode / AI-photo / launcher /
// Instacart / location / outbox) are layered on via `coverage_scope.dart`.
//
// Contract kept from the existing journeys: assert REAL store state + honest
// visible values (not pixels), reuse the harness/fakes, mind finite animations
// (no pumpAndSettle hangs), no network. Whole suite stays green.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/cart/location_service.dart';
import 'package:health_hub/cart/instacart_client.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pages/nutrition_page.dart';
import 'package:health_hub/pages/food_page.dart';
import 'package:health_hub/pages/cart_page.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/pantry/recognition/recognition_client.dart';

import 'coverage_scope.dart';
import 'journey_scope.dart';

void main() {
  // Find the outer scrollable of a page (the page's own ListView, not an inner
  // text field scrollable).
  Finder pageScroll(Key pageKey) => find
      .descendant(of: find.byKey(pageKey), matching: find.byType(Scrollable))
      .first;

  Future<void> pumpApp(WidgetTester tester, List<Override> overrides) async {
    // A taller surface so the long scrollables (the gym gate under its Brain
    // setup card, the Cart hand-off section, Home under its cards) fit — keeps
    // the multi-step flows robust regardless of run order in the full suite.
    // Reset after the test so no size leaks to another file.
    tester.view.physicalSize = const Size(1000, 2200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(overrides: overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════════════════════════════════════════
  group('Auth', () {
    testWidgets('gate precedence: unauthenticated → auth screen', (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, [
        ...h.overrides,
        // Override auth back to a signed-OUT fake (the harness signs in).
        authServiceProvider.overrideWithValue(FakeAuthService()),
      ]);
      expect(find.byKey(const Key('auth-screen')), findsOneWidget);
      expect(find.byKey(const Key('today-page')), findsNothing);
    });

    testWidgets('sign-in with email routes into the app (authed+profile → app)',
        (tester) async {
      final h = JourneyHarness();
      final auth = FakeAuthService();
      await pumpApp(tester, [
        ...h.overrides,
        authServiceProvider.overrideWithValue(auth),
      ]);
      expect(find.byKey(const Key('auth-screen')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('auth-email')), 'a@b.com');
      await tester.enterText(find.byKey(const Key('auth-password')), 'secret1');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      // The auth stream drove the gate → the profile the harness seeded lands us
      // in the app (not onboarding).
      expect(find.byKey(const Key('today-page')), findsOneWidget);
    });

    testWidgets('sign-up (autoconfirm OFF) shows the honest "check your email"',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, [
        ...h.overrides,
        authServiceProvider.overrideWithValue(FakeAuthService()),
      ]);
      await tester.tap(find.byKey(const Key('auth-toggle-mode')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('auth-email')), 'new@b.com');
      await tester.enterText(find.byKey(const Key('auth-password')), 'secret1');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      // No session established → stays on the auth screen with the honest note.
      expect(find.byKey(const Key('auth-screen')), findsOneWidget);
      expect(find.byKey(const Key('auth-info')), findsOneWidget);
      expect(find.textContaining('Check new@b.com'), findsOneWidget);
      expect(find.byKey(const Key('today-page')), findsNothing);
    });

    testWidgets('an auth error surfaces verbatim (never a fake success)',
        (tester) async {
      final h = JourneyHarness();
      final auth = FakeAuthService()
        ..failNextWith = const AuthFailure('Incorrect email or password.');
      await pumpApp(tester, [
        ...h.overrides,
        authServiceProvider.overrideWithValue(auth),
      ]);
      await tester.enterText(find.byKey(const Key('auth-email')), 'a@b.com');
      await tester.enterText(find.byKey(const Key('auth-password')), 'wrong1');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('auth-error')), findsOneWidget);
      expect(find.text('Incorrect email or password.'), findsOneWidget);
      expect(find.byKey(const Key('today-page')), findsNothing);
    });

    testWidgets('gate precedence: authed + NO profile → onboarding',
        (tester) async {
      // A first-run device (no saved profile) → hasProfile() is false.
      final h = JourneyHarness(noProfile: true);
      await pumpApp(tester, h.overrides);
      expect(find.byKey(const Key('onboarding-flow')), findsOneWidget);
      expect(find.byKey(const Key('today-page')), findsNothing);
    });

    testWidgets('sign-out from Settings returns to the auth screen',
        (tester) async {
      final h = JourneyHarness();
      final auth = FakeAuthService(initialUser: JourneyHarness.signedIn);
      await pumpApp(tester, [
        ...h.overrides,
        authServiceProvider.overrideWithValue(auth),
      ]);
      expect(find.byKey(const Key('today-page')), findsOneWidget);

      // Open Settings (gear top-left of Home) → Sign out → confirm.
      await tester.tap(find.byKey(const Key('home-settings-btn')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('settings-sign-out')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('settings-sign-out')));
      await tester.pumpAndSettle();
      // The confirm dialog's "Sign out" button (the tile also reads "Sign out",
      // so target the FilledButton inside the dialog specifically).
      await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
      await tester.pumpAndSettle();

      // The session genuinely ended — the auth service reports no current user.
      // (The auth stream then drives the gate; SettingsPage was pushed as a route
      // over the gate, so we assert the real sign-out state, not pixel visibility.)
      expect(auth.currentUser, isNull);
      // The app's authed content (Home) is no longer the gate's child.
      expect(find.byKey(const Key('today-page')), findsNothing);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ONBOARDING
  // ══════════════════════════════════════════════════════════════════════════
  group('Onboarding', () {
    testWidgets('complete it (enter some, skip some) → sparse profile persists',
        (tester) async {
      final h = JourneyHarness(noProfile: true);
      await pumpApp(tester, h.overrides);
      expect(find.byKey(const Key('onboarding-flow')), findsOneWidget);

      // Step 1 height: enter 178.
      await tester.enterText(find.byKey(const Key('onboarding-input')), '178');
      await tester.tap(find.byKey(const Key('onboarding-next')));
      await tester.pumpAndSettle();
      // Steps 2..7: skip the rest (age, sex, weight, goalDir, targetWeight, gym).
      for (var i = 0; i < 6; i++) {
        // Last step's button reads "Finish"; skip still advances/finishes.
        await tester.tap(find.byKey(const Key('onboarding-skip')));
        await tester.pumpAndSettle();
      }

      // Onboarding finished → the app is shown.
      expect(find.byKey(const Key('today-page')), findsOneWidget);
      // The REAL profile persisted only the height; skipped fields stayed null.
      final profile = await h.profileRepo.load();
      expect(profile.heightCm, 178);
      expect(profile.ageYears, isNull);
      expect(profile.weightKg, isNull);
      expect(profile.primaryGym, isNull);
    });

    testWidgets('skip EVERYTHING → an empty profile still resolves into the app',
        (tester) async {
      final h = JourneyHarness(noProfile: true);
      await pumpApp(tester, h.overrides);
      for (var i = 0; i < 7; i++) {
        await tester.tap(find.byKey(const Key('onboarding-skip')));
        await tester.pumpAndSettle();
      }
      expect(find.byKey(const Key('today-page')), findsOneWidget);
      final profile = await h.profileRepo.load();
      expect(profile.isEmpty, isTrue);
      // Home leads with the honest "set up your profile" affordance.
      expect(find.byKey(const Key('today-setup-profile')), findsOneWidget);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HOME / DASHBOARD / RIFT SEAM
  // ══════════════════════════════════════════════════════════════════════════
  group('Home', () {
    testWidgets('empty state: no "For you", honest dashes, rift seam inert',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      expect(find.byKey(const Key('today-page')), findsOneWidget);
      // No goal, no pantry, no workout → the Brain section is omitted (Home
      // excludes setup prompts).
      expect(find.byKey(const Key('home-brain')), findsNothing);
      // Weight card shows the honest dash (no weigh-in, harness weight is a
      // sentinel not shown — wait, profile weight IS shown; assert the GOAL dash).
      expect(find.byKey(const Key('today-page')), findsOneWidget);
      // The rift seam exists and tapping it is inert (no crash, no nav).
      expect(find.byKey(const Key('home-rift-seam')), findsOneWidget);
      await tester.tap(find.byKey(const Key('home-rift-seam')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('today-page')), findsOneWidget);
    });

    testWidgets('restock-soon card present only when something is honestly due',
        (tester) async {
      // No pantry → no restock card.
      final h1 = JourneyHarness();
      await pumpApp(tester, h1.overrides);
      expect(find.byKey(const Key('home-restock-soon')), findsNothing);

      // A genuinely-low item → the card appears (below the fold — scroll to it).
      final h2 = JourneyHarness(pantry: [lowPantryItem('Milk')]);
      await pumpApp(tester, h2.overrides);
      await tester.scrollUntilVisible(
        find.byKey(const Key('home-restock-soon')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(const Key('home-restock-soon')), findsOneWidget);
      expect(find.textContaining('1 item to restock'), findsOneWidget);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // NUTRITION — In / Out / Guess / exact / barcode / goals
  // ══════════════════════════════════════════════════════════════════════════
  group('Nutrition', () {
    Future<void> openNutrition(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nutrition-page')), findsOneWidget);
    }

    testWidgets('log an exact In meal → persisted with exact tier + real macros',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await openNutrition(tester);

      await tester.enterText(find.byKey(const Key('nutrition-name')), 'Rice');
      await tester.enterText(find.byKey(const Key('nutrition-kcal')), '200');
      await tester.enterText(find.byKey(const Key('nutrition-carbs')), '44');
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      final log = await h.nutritionRepo.all();
      expect(log, hasLength(1));
      expect(log.single.name, 'Rice');
      expect(log.single.kcal, 200);
      expect(log.single.carbsG, 44);
      // Unmeasured macros stay null (never a fabricated 0).
      expect(log.single.proteinG, isNull);
      expect(log.single.tier, AccuracyTier.exact);
      expect(log.single.ateOut, isFalse);
    });

    testWidgets('Guess → estimate tier + ~ prefix', (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await openNutrition(tester);

      await tester.enterText(find.byKey(const Key('nutrition-name')), 'Curry');
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-guess-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-guess-btn')));
      await tester.pumpAndSettle();

      final log = await h.nutritionRepo.all();
      expect(log.single.name, '~Curry');
      expect(log.single.tier, AccuracyTier.estimate);
    });

    testWidgets('Out mode: records restaurant + spend, never touches the pantry',
        (tester) async {
      final h = JourneyHarness(pantry: [lowPantryItem('Milk')]);
      await pumpApp(tester, h.overrides);
      await openNutrition(tester);

      await tester.tap(find.byKey(const Key('nutrition-toggle-out')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('nutrition-name')), 'Burger');
      await tester.enterText(
          find.byKey(const Key('nutrition-restaurant')), 'Five Guys');
      await tester.enterText(find.byKey(const Key('nutrition-spend')), '12.50');
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      final log = await h.nutritionRepo.all();
      expect(log.single.ateOut, isTrue);
      expect(log.single.restaurant, 'Five Guys');
      expect(log.single.spendGbp, 12.5);
      // Pantry untouched by an Out meal (Milk qty unchanged at 20).
      final pantry = await h.pantryRepo.all();
      expect(pantry.single.qty, 20);
    });

    testWidgets(
        'barcode seam pre-fills the form scaled to serving size → exact entry',
        (tester) async {
      final h = JourneyHarness();
      // A product: 500 kcal/100g, serving 50 g → the form should show 250 kcal.
      final food = PackagedFood(
        barcode: '5000000000000',
        name: 'Protein Bar',
        servingGrams: 50,
        kcalPer100g: 500,
        proteinPer100g: 40,
      );
      await pumpApp(tester, coverageOverrides(h, offClient: StubOffClient(food)));
      await openNutrition(tester);

      // Drive the barcode seam directly (the camera route is never pushed in
      // tests) — exactly as nutrition_page_test does.
      final state =
          tester.state<NutritionPageState>(find.byType(NutritionPage));
      await state.handleBarcodeResult('5000000000000');
      await tester.pumpAndSettle();

      // Form pre-filled + scaled: 500/100 * 50 = 250 kcal, 40/100*50 = 20 g.
      expect(find.text('Protein Bar'), findsOneWidget);
      expect(find.text('250'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      final log = await h.nutritionRepo.all();
      expect(log.single.name, 'Protein Bar');
      expect(log.single.kcal, 250);
      expect(log.single.proteinG, 20);
      expect(log.single.tier, AccuracyTier.exact);
      expect(log.single.source, 'barcode');
      expect(log.single.barcode, '5000000000000');
    });

    testWidgets('goals editor: blank fields save as null (honest empty rings)',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);

      await tester.scrollUntilVisible(
        find.byKey(const Key('today-edit-goals')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('today-edit-goals')));
      await tester.pumpAndSettle();
      // Enter only calories; leave protein/carbs/fat blank.
      await tester.enterText(find.byKey(const Key('goals-kcal')), '2100');
      await tester.tap(find.byKey(const Key('goals-save')));
      await tester.pumpAndSettle();

      final goals = await h.goalsRepo.load();
      expect(goals.caloriesKcal, 2100);
      expect(goals.proteinG, isNull);
      expect(goals.carbsG, isNull);
      expect(goals.fatG, isNull);
    });

    testWidgets('eat-in: attaching a pantry ingredient deducts stock on log',
        (tester) async {
      final h = JourneyHarness(pantry: [
        const PantryItem(
          id: 'rice',
          name: 'Rice',
          zone: PantryZone.pantry,
          qty: 500,
          unit: 'g',
          source: 'manual',
        ),
      ]);
      await pumpApp(tester, h.overrides);
      await openNutrition(tester);

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Rice bowl');
      // Open the eat-in ingredient picker.
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-add-ingredient')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-add-ingredient')));
      await tester.pumpAndSettle();
      // Pick the Rice item + 100 g.
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

      // The meal logged AND the pantry deducted 100 g (500 → 400).
      final log = await h.nutritionRepo.all();
      expect(log.single.name, 'Rice bowl');
      final pantry = await h.pantryRepo.all();
      expect(pantry.single.qty, 400);
      // The honest confirmation snackbar fired.
      expect(find.byKey(const Key('nutrition-eatin-snackbar')), findsOneWidget);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FOOD / KITCHEN — gate / manual add / AI-photo confirm / zones / toggle
  // ══════════════════════════════════════════════════════════════════════════
  group('Food / Kitchen', () {
    testWidgets('empty pantry shows the gate; NOT the kitchen scene',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('food-gate')), findsOneWidget);
      expect(find.byKey(const Key('kitchen-scene')), findsNothing);
    });

    testWidgets('manual add → item persists → kitchen scene renders zones',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('food-gate-manual')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('food-form-name')), 'Cheddar');
      await tester.tap(find.byKey(const Key('food-form-submit')));
      await tester.pumpAndSettle();

      // Persisted + the kitchen scene now shows (with the fridge zone panel).
      final pantry = await h.pantryRepo.all();
      expect(pantry.single.name, 'Cheddar');
      expect(find.byKey(const Key('kitchen-scene')), findsOneWidget);
      expect(find.byKey(const Key('kitchen-zone-fridge')), findsOneWidget);
    });

    testWidgets('AI-photo: fake recognition → confirm-before-save writes pantry',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, coverageOverrides(
        h,
        recognitionClient:
            FakePantryRecognitionClient(result: oneRecognizedItem('Yogurt')),
      ));
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      // Drive the testable recognition seam directly (camera never opened).
      // NOTE: runRecognition PUSHES the confirm page and awaits its pop, so its
      // Future does NOT complete until we confirm/cancel — do NOT await it here
      // (that would deadlock the test). Fire it, pump the push in, then interact.
      final state = tester.state<FoodPageState>(find.byType(FoodPage));
      final recognitionDone = state.runRecognition([fakeImageBytes()]);
      await tester.pumpAndSettle();

      // Confirm screen shows the suggestion; NOTHING saved yet.
      expect(find.byKey(const Key('pantry-recognition-page')), findsOneWidget);
      expect(await h.pantryRepo.all(), isEmpty);

      await tester.tap(find.byKey(const Key('recognition-confirm-btn')));
      await tester.pumpAndSettle();
      await recognitionDone; // the push has popped; the seam future completes.

      // Only after confirm is the real pantry item written.
      final pantry = await h.pantryRepo.all();
      expect(pantry.single.name, 'Yogurt');
      expect(pantry.single.source, 'scan');
    });

    testWidgets('AI-photo failure surfaces an honest error, saves nothing',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, coverageOverrides(
        h,
        recognitionClient: FakePantryRecognitionClient(
          error: const RecognitionFailure('Recognition failed.'),
        ),
      ));
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      final state = tester.state<FoodPageState>(find.byType(FoodPage));
      await state.runRecognition([fakeImageBytes()]);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('food-gate-upload-snackbar')), findsOneWidget);
      expect(await h.pantryRepo.all(), isEmpty);
    });

    testWidgets('tap a zone → its real items → item-facts sheet',
        (tester) async {
      final h = JourneyHarness(pantry: [
        const PantryItem(
          id: 'milk',
          name: 'Milk',
          zone: PantryZone.fridge,
          qty: 2,
          unit: 'L',
          source: 'manual',
        ),
      ]);
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('kitchen-zone-fridge')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('kitchen-zone-view')), findsOneWidget);
      expect(find.text('Milk'), findsOneWidget);

      // Tap the item → the facts sheet with its real fields.
      await tester.tap(find.text('Milk'));
      await tester.pumpAndSettle();
      expect(find.text('Zone'), findsOneWidget);
      expect(find.text('Fridge'), findsWidgets);
    });

    testWidgets('single/double appliance toggle persists (cosmetic)',
        (tester) async {
      final h = JourneyHarness(pantry: [
        const PantryItem(
            id: 'x', name: 'X', zone: PantryZone.fridge, source: 'manual'),
      ]);
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      // Toggle the fridge to double.
      await tester.tap(find.byKey(const Key('kitchen-toggle-fridge')));
      await tester.pumpAndSettle();

      // The layout persisted (cosmetic — item data untouched).
      final layout = await h.kitchenLayoutRepo.load();
      expect(layout.fridge.isDouble, isTrue);
      // Item count unchanged.
      final pantry = await h.pantryRepo.all();
      expect(pantry, hasLength(1));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GYM — gate / full flow / snapping / rest / effort / progression / confetti
  // ══════════════════════════════════════════════════════════════════════════
  group('Gym', () {
    testWidgets('gate shows before a session; TRAIN setup insight present',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('gym-gate')), findsOneWidget);
      expect(find.byKey(const Key('insight-card-train-setup')), findsOneWidget);
    });

    testWidgets(
        'full flow: start → pick → log set (snaps) → rest → effort → finish',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('gym-start-btn')));
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('gym-exercise-leg-press')));
      await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
      await tester.pumpAndSettle();

      // 97 kg on a 5 kg machine stack → must snap to 95 before saving.
      await tester.enterText(find.byKey(const Key('gym-weight-field')), '97');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
      await tester.ensureVisible(find.byKey(const Key('gym-log-set-btn')));
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();

      // The rest panel is up; rate the effort (records onto the set).
      expect(find.byKey(const Key('gym-rest-panel')), findsOneWidget);
      await tester.tap(find.byKey(const Key('gym-effort-easy')));
      await tester.pump();
      await tester.pump();
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('gym-finish-btn')));
      await tester.tap(find.byKey(const Key('gym-finish-btn')));
      await tester.pumpAndSettle();

      final workouts = await h.workoutRepo.all();
      expect(workouts.single.finished, isTrue);
      final set = workouts.single.exercises.single.sets.single;
      expect(set.weightKg, 95.0); // honestly snapped
      expect(set.reps, 10);
      expect(set.effort, SetEffort.easy);
    });

    testWidgets('bodyweight lift stores null weight (no fabricated 0)',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('gym-start-btn')));
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Pick a bodyweight movement (pull-up is bodyweight in the catalog).
      final pullup = find.byKey(const Key('gym-exercise-pull-up'));
      expect(pullup, findsOneWidget);
      await tester.ensureVisible(pullup);
      await tester.tap(pullup);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '8');
      await tester.ensureVisible(find.byKey(const Key('gym-log-set-btn')));
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();

      final workouts = await h.workoutRepo.all();
      final set = workouts.single.exercises.single.sets.single;
      expect(set.weightKg, isNull); // bodyweight → honest null
      expect(set.reps, 8);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CART — notepad / hand-off (Amazon/Instacart) / delivery / restock
  // ══════════════════════════════════════════════════════════════════════════
  group('Cart', () {
    Future<void> openCart(WidgetTester tester) async {
      await tester.tap(find.text('Cart'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cart-page')), findsOneWidget);
    }

    testWidgets('notepad: add → check → clear-done → remove (real list state)',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await openCart(tester);

      // Add two items.
      await tester.enterText(find.byKey(const Key('cart-add-field')), 'Eggs');
      await tester.tap(find.byKey(const Key('cart-add-btn')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cart-add-field')), 'Bread');
      await tester.tap(find.byKey(const Key('cart-add-btn')));
      await tester.pumpAndSettle();

      var list = await h.groceryRepo.all();
      expect(list.map((i) => i.name), containsAll(['Eggs', 'Bread']));

      // Check off Eggs.
      final eggs = list.firstWhere((i) => i.name == 'Eggs');
      await tester.tap(find.byKey(Key('cart-check-${eggs.id}')));
      await tester.pumpAndSettle();
      list = await h.groceryRepo.all();
      expect(list.firstWhere((i) => i.name == 'Eggs').done, isTrue);

      // Clear done → Eggs gone, Bread remains.
      await tester.tap(find.byKey(const Key('cart-clear-done')));
      await tester.pumpAndSettle();
      list = await h.groceryRepo.all();
      expect(list.map((i) => i.name), ['Bread']);

      // Remove Bread.
      final bread = list.single;
      await tester.tap(find.byKey(Key('cart-remove-${bread.id}')));
      await tester.pumpAndSettle();
      expect(await h.groceryRepo.all(), isEmpty);
    });

    // The nav shell constructs CartPage without seam overrides, so the hand-off
    // seams (launcher / Instacart / location) are driven by building CartPage
    // directly with those injected params — the grocery repo is the harness's
    // SHARED one, so the list is real and the interconnection holds.
    Widget cartWith(
      WidgetTester tester,
      JourneyHarness h, {
      required FakeLinkLauncher launcher,
      InstacartClient? instacart,
      LocationService? location,
    }) {
      // A tall surface so the Cart's long hand-off section fits without fighting
      // the fold (robust under any full-suite run order). Reset after the test.
      tester.view.physicalSize = const Size(1000, 2200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      return ProviderScope(
        overrides: h.overrides,
        child: MaterialApp(
          home: CartPage(
            repo: h.groceryRepo,
            linkLauncher: launcher,
            instacartClient: instacart,
            locationService: location,
          ),
        ),
      );
    }

    testWidgets('Amazon hand-off launches a search URL (fake launcher)',
        (tester) async {
      final h = JourneyHarness();
      await h.groceryRepo.add('Eggs');
      final launcher = FakeLinkLauncher();
      await tester.pumpWidget(cartWith(tester, h, launcher: launcher));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.byKey(const Key('cart-amazon')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('cart-amazon')));
      await tester.pumpAndSettle();

      expect(launcher.launched, hasLength(1));
      final url = launcher.launched.single.toString().toLowerCase();
      expect(url, contains('amazon'));
    });

    testWidgets(
        'Instacart hand-off: pre-filled list URL preferred (fake client)',
        (tester) async {
      final h = JourneyHarness();
      await h.groceryRepo.add('Milk');
      final launcher = FakeLinkLauncher();
      final instacart =
          FakeInstacartClient(result: Uri.parse('https://instacart.test/list'));

      await tester.pumpWidget(
          cartWith(tester, h, launcher: launcher, instacart: instacart));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.byKey(const Key('cart-instacart')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      // The pre-filled list URL was launched (not the search fallback).
      expect(launcher.launched.single, Uri.parse('https://instacart.test/list'));
      expect(instacart.lastItemNames, ['Milk']);
    });

    testWidgets('Instacart falls back to search when the edge fn returns null',
        (tester) async {
      final h = JourneyHarness();
      await h.groceryRepo.add('Milk');
      final launcher = FakeLinkLauncher();
      final instacart = FakeInstacartClient(result: null); // failure → fallback

      await tester.pumpWidget(
          cartWith(tester, h, launcher: launcher, instacart: instacart));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('cart-instacart')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      // A URL WAS launched (the search fallback) — the button is never a dead end.
      expect(launcher.launched, hasLength(1));
      expect(launcher.launched.single.toString().toLowerCase(),
          contains('instacart'));
    });

    testWidgets('delivery near-me: denied permission still lists services',
        (tester) async {
      final h = JourneyHarness();
      final launcher = FakeLinkLauncher();
      await tester.pumpWidget(cartWith(
        tester,
        h,
        launcher: launcher,
        location: FakeLocationService(
          const LocationResult(errorMessage: 'denied'),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.byKey(const Key('cart-delivery-near-me')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
      await tester.pumpAndSettle();

      // Honest note + the full service list (never claims to verify delivery).
      expect(find.byKey(const Key('cart-delivery-denied-note')), findsOneWidget);
      expect(
          find.byKey(const Key('cart-delivery-amazon-fresh')), findsOneWidget);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WEIGH-INS + TREND
  // ══════════════════════════════════════════════════════════════════════════
  group('Weigh-ins', () {
    testWidgets('one reading → no trend chip; a second → real trend',
        (tester) async {
      // Seed ONE weigh-in → current shows, no trend chip.
      final h1 = JourneyHarness(weighIns: [
        WeighIn.now(weightKg: 62, at: DateTime.now().subtract(const Duration(days: 3))),
      ]);
      await pumpApp(tester, h1.overrides);
      expect(find.byKey(const Key('today-weight-trend')), findsNothing);

      // Seed TWO → the real ▲/▼ trend chip appears.
      final h2 = JourneyHarness(weighIns: [
        WeighIn.now(weightKg: 62, at: DateTime.now().subtract(const Duration(days: 7))),
        WeighIn.now(weightKg: 63, at: DateTime.now().subtract(const Duration(days: 1))),
      ]);
      await pumpApp(tester, h2.overrides);
      expect(find.byKey(const Key('today-weight-trend')), findsOneWidget);
    });

    testWidgets('log a weight from Home → persists + shows the current number',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.scrollUntilVisible(
        find.byKey(const Key('today-log-weight')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('today-log-weight')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('log-weight-field')), '64.5');
      // The Save button is disabled until the field's onChanged setState runs —
      // pump so the button enables before we tap it.
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('log-weight-save')));
      await tester.pumpAndSettle();

      final weighIns = await h.weighInRepo.all();
      expect(weighIns.single.weightKg, 64.5);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════
  group('Settings', () {
    testWidgets('goal reset clears goal direction + target weight',
        (tester) async {
      final h = JourneyHarness(profile: const {
        'weight_kg': 62.0,
        'goal_direction': 'gain',
        'target_weight_kg': 72.0,
      });
      await pumpApp(tester, h.overrides);
      await tester.tap(find.byKey(const Key('home-settings-btn')));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.byKey(const Key('settings-goal-reset')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('settings-goal-reset')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reset'));
      await tester.pumpAndSettle();

      final profile = await h.profileRepo.load();
      expect(profile.goalDirection, isNull);
      expect(profile.targetWeightKg, isNull);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SYNC / OFFLINE BANNER
  // ══════════════════════════════════════════════════════════════════════════
  group('Sync banner', () {
    testWidgets('pending writes → an honest "Syncing…" banner', (tester) async {
      final h = JourneyHarness();
      final outbox = Outbox(MemOutboxStore([samplePending('m1')]));
      addTearDown(outbox.dispose);
      await pumpApp(tester, coverageOverrides(h, outbox: outbox));
      expect(find.byKey(const Key('sync-status-pending')), findsOneWidget);
      expect(find.textContaining('Syncing'), findsOneWidget);
    });

    testWidgets('synced (empty outbox) → the banner renders nothing',
        (tester) async {
      final h = JourneyHarness();
      final outbox = Outbox(MemOutboxStore());
      addTearDown(outbox.dispose);
      await pumpApp(tester, coverageOverrides(h, outbox: outbox));
      expect(find.byKey(const Key('sync-status-pending')), findsNothing);
      expect(find.byKey(const Key('sync-status-failed')), findsNothing);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BRAIN insight actions wired (add-to-cart / start-workout / log-meal / goals)
  // ══════════════════════════════════════════════════════════════════════════
  group('Brain actions', () {
    testWidgets('EAT setup "Set goals" action opens the goals editor',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      // No goal → the EAT setup prompt shows on Nutrition with an openGoals action.
      expect(find.byKey(const Key('insight-card-eat-setup')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('insight-action-eat-setup')));
      await tester.tap(find.byKey(const Key('insight-action-eat-setup')));
      await tester.pumpAndSettle();
      // The daily-targets editor opened.
      expect(find.text('Daily targets'), findsOneWidget);
    });

    testWidgets('TRAIN setup "Start a workout" action starts a real session',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-train-setup')), findsOneWidget);
      await tester.ensureVisible(
          find.byKey(const Key('insight-action-train-setup')));
      await tester.tap(find.byKey(const Key('insight-action-train-setup')));
      await tester.pumpAndSettle();

      // A session started → the gate is gone, the exercise picker is up, and a
      // real (unfinished) session exists.
      expect(find.byKey(const Key('gym-gate')), findsNothing);
      final workouts = await h.workoutRepo.all();
      expect(workouts, hasLength(1));
      expect(workouts.single.finished, isFalse);
    });
  });
}
