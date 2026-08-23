// Shared test helper: ProviderScope overrides for the composition-root
// providers the Brain reads, all backed by in-memory fakes. Lets any widget
// test seed the Brain's real state (pantry / goals / food / workouts) without
// touching SharedPreferences.
//
// Use [brainOverrides] in a `ProviderScope(overrides: [...])` to make
// insightsForScreen see the seeded data.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/kitchen/kitchen_layout.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/pantry/purchase_history.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';

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

class _Workouts implements WorkoutStore {
  @override
  Future<List<WorkoutSession>> load() async => const [];
  @override
  Future<void> save(List<WorkoutSession> sessions) async {}
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

class _KitchenLayout implements KitchenLayoutStore {
  @override
  Future<KitchenLayout> load() async => KitchenLayout.initial;
  @override
  Future<void> save(KitchenLayout layout) async {}
}

class _Grocery implements GroceryListStore {
  List<GroceryItem> _i = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<GroceryItem> items) async => _i = List.of(items);
}

class _PurchaseHistory implements PurchaseHistoryStore {
  List<PurchaseHistory> _i = [];
  @override
  Future<List<PurchaseHistory>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PurchaseHistory> h) async => _i = List.of(h);
}

/// The full set of overrides the Brain needs, seeded with the given real data.
/// Pass a shared [grocery] repo when a test needs to inspect what was written.
List<Override> brainOverrides({
  Map<String, dynamic>? goals,
  List<FoodLogEntry>? food,
  List<PantryItem>? pantry,
  GroceryListRepo? grocery,
}) =>
    [
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
      kitchenLayoutRepoProvider.overrideWithValue(
        KitchenLayoutRepo(store: _KitchenLayout()),
      ),
      groceryListRepoProvider.overrideWithValue(
        grocery ?? GroceryListRepo(outbox: Outbox(_Outbox()), store: _Grocery()),
      ),
      // In-memory purchase-history store so the honest reorder-cadence learner
      // (acquisitionServiceProvider, which reads the SAME overridden pantry repo
      // above) works in widget tests without touching SharedPreferences.
      purchaseHistoryStoreProvider.overrideWithValue(_PurchaseHistory()),
    ];
