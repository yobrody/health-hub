// Widget tests for the eat-in cross-link on the Nutrition page (P4-F).
//
// When the user attaches pantry ingredients to an In (home) meal, logging it
// must ALSO deduct those ingredients from the pantry via EatInService, log the
// nutrition entry, and surface a shortfall HONESTLY. Logging with NO ingredients
// must still work exactly as before (the existing path unchanged).
//
// Honesty invariants under test:
//  • Deduction goes through the SAME pantry repo (outbox-queued = success).
//  • A shortfall is surfaced truthfully; stock is clamped at 0, never negative.
//  • The plain "log a meal with no pantry ingredients" path is untouched.

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/meals/eat_in_service.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/nutrition/off_client.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/nutrition_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class _FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> _items = [];
  List<FoodLogEntry> get items => List.unmodifiable(_items);
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<FoodLogEntry> items) async => _items = List.of(items);
}

class _FakePantryStore implements PantryStore {
  _FakePantryStore([List<PantryItem>? seed]) : _items = seed ?? [];
  List<PantryItem> _items;
  List<PantryItem> get items => List.unmodifiable(_items);
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
}

class _StubOffClient extends OffClient {
  _StubOffClient() : super(Dio());
  @override
  Future<PackagedFood?> lookupBarcode(String code) async => null;
}

PantryItem _pantryItem(String id, {double? qty, String unit = 'g'}) =>
    PantryItem(
      id: id,
      name: id,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      source: 'manual',
    );

Widget _buildPage({
  required _FakeNutritionStore nutritionStore,
  required _FakePantryStore pantryStore,
}) {
  final outbox = Outbox(_FakeOutboxStore());
  final nutritionRepo = NutritionRepo(outbox: outbox, store: nutritionStore);
  final pantryRepo = PantryRepo(outbox: outbox, store: pantryStore);

  return ProviderScope(
    overrides: [
      nutritionRepoProvider.overrideWithValue(nutritionRepo),
      pantryRepoProvider.overrideWithValue(pantryRepo),
      eatInServiceProvider.overrideWithValue(EatInService(pantryRepo)),
      offClientProvider.overrideWithValue(_StubOffClient()),
    ],
    child: const MaterialApp(home: NutritionPage()),
  );
}

Future<void> _pickIngredient(
  WidgetTester tester, {
  required PantryItem item,
  required String grams,
}) async {
  await tester.ensureVisible(find.byKey(const Key('nutrition-add-ingredient')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('nutrition-add-ingredient')));
  await tester.pumpAndSettle();

  // Select the item in the dropdown.
  await tester.tap(find.byKey(const Key('nutrition-ingredient-item')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(item.name).last);
  await tester.pumpAndSettle();

  await tester.enterText(
    find.byKey(const Key('nutrition-ingredient-grams')),
    grams,
  );
  await tester.tap(find.byKey(const Key('nutrition-ingredient-confirm')));
  await tester.pumpAndSettle();
}

void main() {
  group('NutritionPage — eat-in cross-link', () {
    testWidgets(
        'attaching a pantry ingredient logs the meal AND deducts stock',
        (tester) async {
      final nutritionStore = _FakeNutritionStore();
      final pantryStore = _FakePantryStore([
        _pantryItem('chicken', qty: 200, unit: 'g'),
      ]);
      await tester.pumpWidget(
        _buildPage(nutritionStore: nutritionStore, pantryStore: pantryStore),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Chicken lunch');
      await _pickIngredient(
        tester,
        item: pantryStore.items.first,
        grams: '120',
      );

      // The chosen ingredient row is shown.
      expect(find.byKey(const Key('nutrition-ingredient-chicken')),
          findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      // Nutrition entry logged as an In (home) meal.
      expect(nutritionStore.items, hasLength(1));
      expect(nutritionStore.items.first.name, 'Chicken lunch');
      expect(nutritionStore.items.first.ateOut, isFalse);

      // Pantry deducted: 200 - 120 = 80 g, clamped and persisted.
      final chicken = pantryStore.items.firstWhere((i) => i.id == 'chicken');
      expect(chicken.qty, 80);

      // No shortfall → the calm confirmation, not a false "short" note.
      expect(find.byKey(const Key('nutrition-eatin-snackbar')), findsOneWidget);
      expect(find.textContaining('short'), findsNothing);
    });

    testWidgets('a shortfall is surfaced honestly (stock clamps at 0)',
        (tester) async {
      final nutritionStore = _FakeNutritionStore();
      final pantryStore = _FakePantryStore([
        _pantryItem('rice', qty: 50, unit: 'g'),
      ]);
      await tester.pumpWidget(
        _buildPage(nutritionStore: nutritionStore, pantryStore: pantryStore),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Big rice bowl');
      // Ask for more than is on hand → shortfall.
      await _pickIngredient(
        tester,
        item: pantryStore.items.first,
        grams: '200',
      );

      await tester.ensureVisible(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      // Meal still logged (a shortfall never blocks the log).
      expect(nutritionStore.items, hasLength(1));

      // Stock clamped to 0 — never negative.
      final rice = pantryStore.items.firstWhere((i) => i.id == 'rice');
      expect(rice.qty, 0);

      // Honest shortfall surfaced — never pretends the pantry covered it.
      expect(find.textContaining('short on 1 ingredient'), findsOneWidget);
    });

    testWidgets('logging a meal with NO pantry ingredients still works',
        (tester) async {
      final nutritionStore = _FakeNutritionStore();
      final pantryStore = _FakePantryStore([
        _pantryItem('chicken', qty: 200, unit: 'g'),
      ]);
      await tester.pumpWidget(
        _buildPage(nutritionStore: nutritionStore, pantryStore: pantryStore),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Plain snack');
      await tester.enterText(find.byKey(const Key('nutrition-grams')), '100');

      await tester.ensureVisible(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      // Entry logged.
      expect(nutritionStore.items, hasLength(1));
      expect(nutritionStore.items.first.name, 'Plain snack');

      // Pantry untouched — no deduction happened.
      expect(pantryStore.items.first.qty, 200);
      // No eat-in note (the existing path is unchanged).
      expect(find.byKey(const Key('nutrition-eatin-snackbar')), findsNothing);
    });

    testWidgets('the eat-in section is hidden in Out mode', (tester) async {
      final nutritionStore = _FakeNutritionStore();
      final pantryStore = _FakePantryStore([]);
      await tester.pumpWidget(
        _buildPage(nutritionStore: nutritionStore, pantryStore: pantryStore),
      );
      await tester.pumpAndSettle();

      // In mode → section shown.
      expect(find.byKey(const Key('nutrition-eatin-section')), findsOneWidget);

      // Switch to Out → the eat-in section (a pantry concept) disappears.
      await tester.tap(find.byKey(const Key('nutrition-toggle-out')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nutrition-eatin-section')), findsNothing);
    });
  });
}
