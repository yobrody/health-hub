import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
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
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes so the first-run gate resolves to the app (a profile "exists") and no
//    page hits a platform channel (secure storage / shared_preferences). ───────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class _FakeProfileStore implements ProfileStore {
  _FakeProfileStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _FakeProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

// A repo whose store already holds a profile → hasProfile() == true → the gate
// shows the app immediately (the contract this test relies on).
ProfileRepo _repoWithProfile() => ProfileRepo(
      api: _FakeProfileApi(),
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakeProfileStore({'weight_kg': 62.5}),
    );

// In-memory workout store so GymPage's initState async never hits a platform
// channel → pumpAndSettle does not time out.
class _FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> _sessions = [];
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_sessions);
  @override
  Future<void> save(List<WorkoutSession> sessions) async =>
      _sessions = List.of(sessions);
}

WorkoutRepo _workoutRepo() => WorkoutRepo(
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakeWorkoutStore(),
    );

// In-memory stores for the remaining repos so TodayPage's initState async loads
// resolve (SharedPreferences is unavailable in the bare test harness, so the
// real stores' getInstance() never completes and the page would stay loading).
class _FakePantryStore implements PantryStore {
  List<PantryItem> _items = [];
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
}

class _FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> _items = [];
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<FoodLogEntry> items) async => _items = List.of(items);
}

class _FakeGoalsStore implements NutritionGoalsStore {
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async => _saved = json;
}

class _FakeWeighInStore implements WeighInStore {
  List<WeighIn> _items = [];
  @override
  Future<List<WeighIn>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<WeighIn> items) async => _items = List.of(items);
}

class _FakeGroceryStore implements GroceryListStore {
  List<GroceryItem> _items = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<GroceryItem> items) async => _items = List.of(items);
}

// A signed-in user so the auth gate resolves past the auth screen.
const _signedIn =
    AuthUser(id: 'u1', email: 'brody@example.com', emailConfirmed: true);

void main() {
  testWidgets('root nav switches tabs', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authServiceProvider.overrideWithValue(
            FakeAuthService(initialUser: _signedIn),
          ),
          profileRepoProvider.overrideWithValue(_repoWithProfile()),
          workoutRepoProvider.overrideWithValue(_workoutRepo()),
          pantryRepoProvider.overrideWithValue(
            PantryRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakePantryStore()),
          ),
          nutritionRepoProvider.overrideWithValue(
            NutritionRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakeNutritionStore()),
          ),
          nutritionGoalsRepoProvider.overrideWithValue(
            NutritionGoalsRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakeGoalsStore()),
          ),
          weighInRepoProvider.overrideWithValue(
            WeighInRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakeWeighInStore()),
          ),
          groceryListRepoProvider.overrideWithValue(
            GroceryListRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakeGroceryStore()),
          ),
        ],
        child: const HealthHubApp(),
      ),
    );
    await tester.pumpAndSettle();
    // starts on Home/Today (first-run gate resolved to the app, not onboarding)
    expect(find.byKey(const Key('today-page')), findsOneWidget);
    // The R-1 bottom bar has exactly the 4 new destinations …
    for (final label in ['Home', 'Food', 'Gym', 'Cart']) {
      expect(find.text(label), findsWidgets);
    }
    // … and Settings / Nutrition are NO LONGER tabs (relocated onto Home).
    expect(find.widgetWithText(NavigationDestination, 'Settings'), findsNothing);
    expect(find.widgetWithText(NavigationDestination, 'Nutrition'), findsNothing);

    // Home carries the relocated affordances: settings (top-left) + log-meal.
    expect(find.byKey(const Key('home-settings-btn')), findsOneWidget);
    expect(find.byKey(const Key('home-log-meal-btn')), findsOneWidget);

    // tapping Gym shows the gym page
    await tester.tap(find.text('Gym'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gym-page')), findsOneWidget);

    // tapping Cart shows the new cart page
    await tester.tap(find.text('Cart'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cart-page')), findsOneWidget);
  });
}
