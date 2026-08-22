// Per-screen weaving tests for The Brain.
//
// These override the composition-root providers the Brain reads (goals /
// nutrition / pantry / workouts / weigh-ins / profile) with in-memory fakes, so
// insightsForScreen sees REAL seeded data. They assert each screen surfaces the
// right kind of insight, that an action genuinely wires the flow (add-to-cart
// writes the real grocery list), and that Home omits its section when there's
// nothing to show.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/cart_page.dart';
import 'package:health_hub/pages/food_page.dart';
import 'package:health_hub/pages/gym_page.dart';
import 'package:health_hub/pages/nutrition_page.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/kitchen/kitchen_layout.dart';
import 'package:health_hub/api/probe_status.dart';

// ── Fakes / stores ────────────────────────────────────────────────────────────

class _Outbox implements OutboxStore {
  List<PendingMutation> _i = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PendingMutation> items) async => _i = List.of(items);
}

class _Goals implements NutritionGoalsStore {
  _Goals([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async => _saved = json;
}

class _Nutrition implements NutritionStore {
  _Nutrition([List<FoodLogEntry>? seed]) : _i = seed ?? [];
  List<FoodLogEntry> _i;
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<FoodLogEntry> items) async => _i = List.of(items);
}

class _Pantry implements PantryStore {
  _Pantry([List<PantryItem>? seed]) : _i = seed ?? [];
  List<PantryItem> _i;
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PantryItem> items) async => _i = List.of(items);
}

class _WeighIns implements WeighInStore {
  @override
  Future<List<WeighIn>> load() async => const [];
  @override
  Future<void> save(List<WeighIn> items) async {}
}

class _Grocery implements GroceryListStore {
  List<GroceryItem> _i = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<GroceryItem> items) async => _i = List.of(items);
}

class _ProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class _ProfileStore implements ProfileStore {
  @override
  Future<Map<String, dynamic>?> load() async => null;
  @override
  Future<void> save(Map<String, dynamic> json) async {}
}

class _Workouts implements WorkoutStore {
  @override
  Future<List<WorkoutSession>> load() async => const [];
  @override
  Future<void> save(List<WorkoutSession> sessions) async {}
}

class _KitchenLayout implements KitchenLayoutStore {
  @override
  Future<KitchenLayout> load() async => KitchenLayout.initial;
  @override
  Future<void> save(KitchenLayout layout) async {}
}

// ── Scope ──────────────────────────────────────────────────────────────────────

/// A single shared grocery repo so a test can inspect what was actually written.
GroceryListRepo _sharedGrocery = GroceryListRepo(store: _Grocery());

Widget _app({
  required Widget child,
  Map<String, dynamic>? goals,
  List<FoodLogEntry>? food,
  List<PantryItem>? pantry,
  GroceryListRepo? grocery,
}) {
  return ProviderScope(
    overrides: [
      nutritionGoalsRepoProvider.overrideWithValue(
        NutritionGoalsRepo(outbox: Outbox(_Outbox()), store: _Goals(goals)),
      ),
      nutritionRepoProvider.overrideWithValue(
        NutritionRepo(outbox: Outbox(_Outbox()), store: _Nutrition(food)),
      ),
      pantryRepoProvider.overrideWithValue(
        PantryRepo(outbox: Outbox(_Outbox()), store: _Pantry(pantry)),
      ),
      workoutRepoProvider.overrideWithValue(
        WorkoutRepo(outbox: Outbox(_Outbox()), store: _Workouts()),
      ),
      weighInRepoProvider.overrideWithValue(
        WeighInRepo(outbox: Outbox(_Outbox()), store: _WeighIns()),
      ),
      profileRepoProvider.overrideWithValue(
        ProfileRepo(
          api: _ProfileApi(),
          outbox: Outbox(_Outbox()),
          store: _ProfileStore(),
        ),
      ),
      groceryListRepoProvider.overrideWithValue(grocery ?? _sharedGrocery),
      kitchenLayoutRepoProvider.overrideWithValue(
        KitchenLayoutRepo(store: _KitchenLayout()),
      ),
    ],
    child: MaterialApp(theme: lightTheme, home: child),
  );
}

FoodLogEntry _food(String n, {double? kcal, double? protein}) => FoodLogEntry(
      id: 'f-$n',
      name: n,
      at: DateTime.now(),
      kcal: kcal,
      proteinG: protein,
      tier: AccuracyTier.exact,
      source: 'manual',
    );

PantryItem _low(String n) => PantryItem(
      id: n.toLowerCase(),
      name: n,
      zone: PantryZone.fridge,
      qty: 10,
      unit: 'g',
      source: 'manual',
    );

void main() {
  setUp(() {
    _sharedGrocery = GroceryListRepo(store: _Grocery());
  });

  testWidgets('Nutrition surfaces an EAT insight from a real goal',
      (tester) async {
    await tester.pumpWidget(_app(
      child: const NutritionPage(),
      goals: {'caloriesKcal': 2000},
      food: [_food('Lunch', kcal: 500)],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('nutrition-brain')), findsOneWidget);
    // 2000 - 500 = 1500 kcal left — a real number.
    expect(find.textContaining('1500 kcal'), findsOneWidget);
    expect(find.byKey(const Key('insight-card-eat')), findsOneWidget);
  });

  testWidgets('Nutrition shows the honest EAT setup prompt with no goal',
      (tester) async {
    await tester.pumpWidget(_app(child: const NutritionPage()));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('insight-card-eat-setup')), findsOneWidget);
    expect(find.text('Set a daily goal to see what to eat'), findsOneWidget);
  });

  testWidgets('Food surfaces a BUY insight for a low item', (tester) async {
    await tester.pumpWidget(_app(
      child: const FoodPage(),
      pantry: [_low('Milk')],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('food-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-buy-milk')), findsOneWidget);
    expect(find.text('Restock Milk'), findsOneWidget);
  });

  testWidgets('Food BUY action really adds the item to the grocery list',
      (tester) async {
    final grocery = GroceryListRepo(store: _Grocery());
    await tester.pumpWidget(_app(
      child: const FoodPage(),
      pantry: [_low('Eggs')],
      grocery: grocery,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('insight-action-buy-eggs')));
    await tester.pumpAndSettle();

    // The REAL grocery list now contains the item — a genuine cross-screen flow.
    final list = await grocery.all();
    expect(list.map((i) => i.name), contains('Eggs'));
  });

  testWidgets('Gym surfaces the honest TRAIN setup prompt with no history',
      (tester) async {
    await tester.pumpWidget(_app(child: const GymPage()));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('gym-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-train-setup')), findsOneWidget);
    expect(find.text('Log a workout to get training guidance'), findsOneWidget);
  });

  testWidgets('Home shows a For-you section when there is real BUY data',
      (tester) async {
    await tester.pumpWidget(_app(
      child: const TodayPage(),
      pantry: [_low('Butter')],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-brain')), findsOneWidget);
    expect(find.byKey(const Key('insight-card-buy-butter')), findsOneWidget);
  });

  testWidgets('Home OMITS the For-you section when there is nothing real',
      (tester) async {
    // A brand-new user: no goal, no pantry, no workouts → only setup prompts,
    // which Home excludes. The section must be absent entirely (no filler).
    await tester.pumpWidget(_app(child: const TodayPage()));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-brain')), findsNothing);
    // The rest of Home still renders (the page itself is present).
    expect(find.byKey(const Key('today-page')), findsOneWidget);
  });

  testWidgets('Cart shows BUY insight cards; adding removes it and lists it',
      (tester) async {
    final grocery = GroceryListRepo(store: _Grocery());
    await tester.pumpWidget(_app(
      child: CartPage(
        pantryRepo: PantryRepo(outbox: Outbox(_Outbox()), store: _Pantry([_low('Kale')])),
        repo: grocery,
      ),
      pantry: [_low('Kale')],
      grocery: grocery,
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('insight-card-buy-kale')), findsOneWidget);
    await tester.tap(find.byKey(const Key('insight-action-buy-kale')));
    await tester.pumpAndSettle();

    // It left the suggestions (now on the list) and is a real list row.
    expect(find.byKey(const Key('insight-card-buy-kale')), findsNothing);
    final list = await grocery.all();
    expect(list.map((i) => i.name), contains('Kale'));
  });
}
