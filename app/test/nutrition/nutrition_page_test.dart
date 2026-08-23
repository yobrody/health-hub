// Widget tests for NutritionPage (P2-T4) — barcode + manual + Guess + In/Out.
//
// Uses fake implementations of NutritionRepo's backing store and a stub
// OffClient subclass so no camera or network is needed in tests.
//
// The scanner seam is NutritionPageState.handleBarcodeResult(String code),
// which is called directly in tests; MobileScanner is never instantiated.
//
// Honesty invariants under test:
//  • Macros filled → AccuracyTier.exact
//  • Guess button → AccuracyTier.estimate, name prefixed with ~
//  • Unmeasured macro → null in repo (not 0)
//  • Out mode: ateOut==true + spendGbp set; no pantry interaction
//  • Barcode path: OffClient result prefills form + scales to serving size

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/nutrition/off_client.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/nutrition_page.dart';

// ── Fake outbox store (in-memory) ────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

// ── Fake nutrition store (in-memory, records adds) ────────────────────────────

class _FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> _items = [];

  List<FoodLogEntry> get items => List.unmodifiable(_items);

  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<FoodLogEntry> items) async {
    _items = List.of(items);
  }
}

// ── Stub OffClient — returns a fixed PackagedFood? without Dio ───────────────

class _StubOffClient extends OffClient {
  final PackagedFood? food;

  _StubOffClient(this.food) : super(Dio());

  @override
  Future<PackagedFood?> lookupBarcode(String code) async => food;
}

// ── Helper: build the page in a ProviderScope with in-memory fakes ───────────

Widget _buildPage(
  _FakeNutritionStore store, [
  PackagedFood? food,
]) {
  final repo = NutritionRepo(
    outbox: Outbox(_FakeOutboxStore()),
    store: store,
  );
  final offClient = _StubOffClient(food);

  return ProviderScope(
    overrides: [
      nutritionRepoProvider.overrideWithValue(repo),
      offClientProvider.overrideWithValue(offClient),
    ],
    child: const MaterialApp(home: NutritionPage()),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Scroll the page's list until [key] is on-screen, then tap it. The Log/Guess
/// buttons live deep in the (lazy) ListView — with the "Plan my week" entry now
/// at the top, they can start below the build range, so a bare tap wouldn't find
/// them.
Future<void> _scrollAndTap(WidgetTester tester, Key key) async {
  await tester.scrollUntilVisible(
    find.byKey(key),
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.tap(find.byKey(key));
}

void main() {
  group('NutritionPage', () {
    // 1. Page renders with the required Key.
    testWidgets('renders with Key nutrition-page', (tester) async {
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store));
      await tester.pump();
      expect(find.byKey(const Key('nutrition-page')), findsOneWidget);
    });

    // 2. Manual add with macros → exact entry added to repo.
    testWidgets('manual Log with macros → exact entry in repo', (tester) async {
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store));
      await tester.pump();

      // Fill in name
      await tester.enterText(find.byKey(const Key('nutrition-name')), 'Eggs');
      // Fill in grams
      await tester.enterText(find.byKey(const Key('nutrition-grams')), '150');
      // Fill in kcal
      await tester.enterText(find.byKey(const Key('nutrition-kcal')), '214');
      // Fill in protein
      await tester.enterText(
          find.byKey(const Key('nutrition-protein')), '18');

      // Tap Log
      await _scrollAndTap(tester, const Key('nutrition-log-btn'));
      await tester.pump();

      final items = store.items;
      expect(items, hasLength(1));
      final entry = items.first;
      expect(entry.name, 'Eggs');
      expect(entry.tier, AccuracyTier.exact);
      expect(entry.kcal, 214.0);
      expect(entry.proteinG, 18.0);
      // carbs/fat not filled → null (not 0)
      expect(entry.carbsG, isNull);
      expect(entry.fatG, isNull);
    });

    // 3. Guess button → estimate tier, name prefixed with ~.
    testWidgets('Guess button → estimate tier + ~ prefix', (tester) async {
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store));
      await tester.pump();

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Pasta');
      await tester.enterText(find.byKey(const Key('nutrition-grams')), '200');

      // Tap Guess (no macros filled → estimate)
      await _scrollAndTap(tester, const Key('nutrition-guess-btn'));
      await tester.pump();

      final items = store.items;
      expect(items, hasLength(1));
      final entry = items.first;
      expect(entry.tier, AccuracyTier.estimate);
      // The UI prefixes the name with '~' to signal estimate
      expect(entry.name, startsWith('~'));
      // Macros are null (not fabricated)
      expect(entry.kcal, isNull);
      expect(entry.proteinG, isNull);
    });

    // 4. Out mode → ateOut==true + spendGbp set.
    testWidgets('Out mode → ateOut true + spendGbp', (tester) async {
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store));
      await tester.pump();

      // Switch to Out
      await tester.tap(find.byKey(const Key('nutrition-toggle-out')));
      await tester.pump();

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Burger');
      await tester.enterText(
          find.byKey(const Key('nutrition-restaurant')), 'Five Guys');
      await tester.enterText(
          find.byKey(const Key('nutrition-spend')), '14.50');

      await _scrollAndTap(tester, const Key('nutrition-log-btn'));
      await tester.pump();

      final items = store.items;
      expect(items, hasLength(1));
      final entry = items.first;
      expect(entry.ateOut, isTrue);
      expect(entry.restaurant, 'Five Guys');
      expect(entry.spendGbp, 14.50);
      // Macros unknown when eating out without filling them → estimate tier
      expect(entry.tier, AccuracyTier.estimate);
    });

    // 5. Barcode path: stub OffClient → prefills form + scaled exact entry.
    testWidgets('barcode lookup prefills form and logs scaled exact entry',
        (tester) async {
      // A product with known per-100g values and a 250g serving.
      const food = PackagedFood(
        barcode: '5000112637922',
        name: 'Coca-Cola',
        brand: 'Coca-Cola',
        servingGrams: 250.0,
        kcalPer100g: 42.0,
        proteinPer100g: 0.0,
        carbsPer100g: 10.6,
        fatPer100g: 0.0,
      );
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store, food));
      await tester.pump();

      // Simulate the scanner seam — call handleBarcodeResult directly via
      // the public state accessor on NutritionPageState.
      final state =
          tester.state<NutritionPageState>(find.byType(NutritionPage));
      await state.handleBarcodeResult('5000112637922');
      await tester.pump();

      // The form should now be prefilled with the product name.
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('nutrition-name')))
            .controller
            ?.text,
        'Coca-Cola',
      );

      // Tap Log to submit
      await _scrollAndTap(tester, const Key('nutrition-log-btn'));
      await tester.pump();

      final items = store.items;
      expect(items, hasLength(1));
      final entry = items.first;
      expect(entry.tier, AccuracyTier.exact);
      expect(entry.barcode, '5000112637922');
      // Scaled: 42 * 250 / 100 = 105 kcal
      expect(entry.kcal, closeTo(105.0, 0.01));
      // Scaled: 10.6 * 250 / 100 = 26.5 g carbs
      expect(entry.carbsG, closeTo(26.5, 0.01));
    });
  });
}
