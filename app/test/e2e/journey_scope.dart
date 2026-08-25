// Shared harness for the end-to-end user-journey tests.
//
// This is the capstone counterpart to `test/brain/brain_scope.dart`: where that
// helper seeds the Brain's repos for a single screen, THIS one wires the WHOLE
// composition root to in-memory fakes and hands back the live store instances so
// a journey test can (a) drive the REAL app widget tree and (b) assert against
// the real persisted state after each step.
//
// The critical property: every repo override shares ONE store instance for its
// data, and the Brain reads those SAME repos via `brainInputsProvider`. So a
// write the user makes on one screen (log a meal, log a workout, add to cart) is
// genuinely visible to the Brain and to every other screen — that's the
// interconnection the journey proves, not a per-screen mock.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/app_providers.dart';

import '../analytics/fake_analytics.dart';
import '../monitoring/fake_error_reporter.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/kitchen/kitchen_layout.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/nutrition/plan/meal_plan_client.dart';
import 'package:health_hub/nutrition/plan/meal_plan_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/pantry/purchase_history.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/sync/connectivity_monitor.dart';

// ── In-memory stores (one instance each; hold the journey's real state) ───────

class _MemOutboxStore implements OutboxStore {
  List<PendingMutation> _i = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PendingMutation> items) async => _i = List.of(items);
}

class _MemProfileStore implements ProfileStore {
  _MemProfileStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _MemProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class _MemNutritionStore implements NutritionStore {
  _MemNutritionStore([List<FoodLogEntry>? seed]) : _i = seed ?? [];
  List<FoodLogEntry> _i;
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<FoodLogEntry> items) async => _i = List.of(items);
}

class _MemGoalsStore implements NutritionGoalsStore {
  _MemGoalsStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _MemPantryStore implements PantryStore {
  _MemPantryStore([List<PantryItem>? seed]) : _i = seed ?? [];
  List<PantryItem> _i;
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PantryItem> items) async => _i = List.of(items);
}

class _MemWorkoutStore implements WorkoutStore {
  _MemWorkoutStore([List<WorkoutSession>? seed]) : _i = seed ?? [];
  List<WorkoutSession> _i;
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<WorkoutSession> sessions) async =>
      _i = List.of(sessions);
}

class _MemWeighInStore implements WeighInStore {
  _MemWeighInStore([List<WeighIn>? seed]) : _i = seed ?? [];
  List<WeighIn> _i;
  @override
  Future<List<WeighIn>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<WeighIn> items) async => _i = List.of(items);
}

class _MemGroceryStore implements GroceryListStore {
  List<GroceryItem> _i = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<GroceryItem> items) async => _i = List.of(items);
}

class _MemMealPlanStore implements MealPlanStore {
  _MemMealPlanStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
  @override
  Future<void> clear() async => _saved = null;
}

class _MemKitchenLayoutStore implements KitchenLayoutStore {
  KitchenLayout _layout = KitchenLayout.initial;
  @override
  Future<KitchenLayout> load() async => _layout;
  @override
  Future<void> save(KitchenLayout layout) async => _layout = layout;
}

class _MemPurchaseHistoryStore implements PurchaseHistoryStore {
  List<PurchaseHistory> _i = [];
  @override
  Future<List<PurchaseHistory>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PurchaseHistory> h) async => _i = List.of(h);
}

/// A connectivity monitor that never emits — keeps `syncServiceProvider.start()`
/// (subscribed at the app root) inert in tests, so nothing tries to flush over a
/// real network and `pumpAndSettle` isn't kept awake by a live stream.
class _SilentConnectivityMonitor implements ConnectivityMonitor {
  @override
  Stream<bool> get onOnline => const Stream<bool>.empty();
}

// ── The journey harness ───────────────────────────────────────────────────────

/// A signed-in fake user + all composition-root repos wired to shared in-memory
/// stores. Build once per test, spread [overrides] into a `ProviderScope`, then
/// pump `const HealthHubApp()`. After driving the UI, read the repos back to
/// assert the REAL persisted state.
class JourneyHarness {
  JourneyHarness({
    Map<String, dynamic>? profile,
    Map<String, dynamic>? goals,
    List<FoodLogEntry>? food,
    List<PantryItem>? pantry,
    List<WorkoutSession>? workouts,
    List<WeighIn>? weighIns,
    MealPlan? mealPlan,
    MealPlan? planResult,
    bool noProfile = false,
  }) {
    profileRepo = ProfileRepo(
      api: _MemProfileApi(),
      outbox: Outbox(_MemOutboxStore()),
      // A profile must exist so the first-run gate lands in the app, not
      // onboarding. The `weight_kg` here is an ARBITRARY sentinel whose ONLY job
      // is to satisfy that gate — it is never asserted, and no journey derives a
      // visible number from it. If a test needs a real weight-derived value, seed
      // a `WeighIn` via `JourneyHarness(weighIns: [...])` instead, so the number
      // the Brain shows traces to genuinely-entered data.
      //
      // Pass `noProfile: true` for a genuinely first-run device: the store holds
      // null, so `hasProfile()` is false and the gate lands on ONBOARDING. A
      // profile saved during onboarding then persists to this same repo, so the
      // gate flips into the app on `hasProfileProvider` invalidation.
      store: _MemProfileStore(noProfile ? null : (profile ?? {'weight_kg': 70.0})),
    );
    goalsRepo = NutritionGoalsRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemGoalsStore(goals),
    );
    nutritionRepo = NutritionRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemNutritionStore(food),
    );
    pantryRepo = PantryRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemPantryStore(pantry),
    );
    workoutRepo = WorkoutRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemWorkoutStore(workouts),
    );
    weighInRepo = WeighInRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemWeighInStore(weighIns),
    );
    groceryRepo =
        GroceryListRepo(outbox: Outbox(_MemOutboxStore()), store: _MemGroceryStore());
    mealPlanRepo = MealPlanRepo(
      outbox: Outbox(_MemOutboxStore()),
      store: _MemMealPlanStore(mealPlan?.toJson()),
    );
    planClient = FakeMealPlanClient(result: planResult);
    kitchenLayoutRepo = KitchenLayoutRepo(store: _MemKitchenLayoutStore());
    purchaseHistoryRepo =
        PurchaseHistoryRepo(store: _MemPurchaseHistoryStore());
  }

  /// The signed-in user the fake auth service reports — resolves the auth gate
  /// past the sign-in screen.
  static const signedIn =
      AuthUser(id: 'journey-user', email: 'brody@example.com', emailConfirmed: true);

  late final ProfileRepo profileRepo;
  late final NutritionGoalsRepo goalsRepo;
  late final NutritionRepo nutritionRepo;
  late final PantryRepo pantryRepo;
  late final WorkoutRepo workoutRepo;
  late final WeighInRepo weighInRepo;
  late final GroceryListRepo groceryRepo;
  late final MealPlanRepo mealPlanRepo;
  late final FakeMealPlanClient planClient;
  late final KitchenLayoutRepo kitchenLayoutRepo;
  late final PurchaseHistoryRepo purchaseHistoryRepo;

  /// The fake analytics recorder. Tests can assert on [analytics.events] or
  /// use [analytics.propsFor] to check event props.
  final FakeAnalytics analytics = FakeAnalytics();

  /// The fake error reporter. Tests can assert on [errorReporter.captured] to
  /// check which exceptions were reported without touching Sentry.
  final FakeErrorReporter errorReporter = FakeErrorReporter();

  /// The full override set: signed-in fake auth, a silent connectivity monitor,
  /// every data repo on a shared in-memory store, and a [FakeAnalytics] so
  /// journey tests can assert analytics events without a real PostHog key.
  /// Spread into a `ProviderScope` wrapping `const HealthHubApp()`.
  List<Override> get overrides => [
        authServiceProvider
            .overrideWithValue(FakeAuthService(initialUser: signedIn)),
        connectivityMonitorProvider
            .overrideWithValue(_SilentConnectivityMonitor()),
        profileRepoProvider.overrideWithValue(profileRepo),
        nutritionGoalsRepoProvider.overrideWithValue(goalsRepo),
        nutritionRepoProvider.overrideWithValue(nutritionRepo),
        pantryRepoProvider.overrideWithValue(pantryRepo),
        workoutRepoProvider.overrideWithValue(workoutRepo),
        weighInRepoProvider.overrideWithValue(weighInRepo),
        groceryListRepoProvider.overrideWithValue(groceryRepo),
        mealPlanRepoProvider.overrideWithValue(mealPlanRepo),
        mealPlanClientProvider.overrideWithValue(planClient),
        kitchenLayoutRepoProvider.overrideWithValue(kitchenLayoutRepo),
        // The honest reorder-cadence learner: its acquisitionServiceProvider
        // reads the pantryRepo override above + this shared in-memory history
        // repo, so a real add / check-off records a genuine acquisition and can
        // stamp a learned cadence onto the harness's own pantry items.
        purchaseHistoryRepoProvider.overrideWithValue(purchaseHistoryRepo),
        // Analytics: always a FakeAnalytics in tests — no PostHog key needed,
        // no network, and the harness can assert which events fired.
        analyticsProvider.overrideWithValue(analytics),
        // Error reporting: always a FakeErrorReporter in tests — no Sentry DSN
        // needed, no network, and the harness can assert which errors fired.
        errorReporterProvider.overrideWithValue(errorReporter),
      ];
}

/// A genuinely-low pantry item (below the 100 g low-stock threshold) — surfaces
/// a real BUY insight from the Brain.
PantryItem lowPantryItem(String name) => PantryItem(
      id: name.toLowerCase(),
      name: name,
      zone: PantryZone.fridge,
      qty: 20,
      unit: 'g',
      source: 'manual',
    );
