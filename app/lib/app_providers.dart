import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/client.dart';
import 'core/config.dart';
import 'core/secrets.dart';
import 'core/secure_store.dart';
import 'gym/workout_repo.dart';
import 'meals/eat_in_service.dart';
import 'nutrition/nutrition_repo.dart';
import 'nutrition/off_client.dart';
import 'offline/outbox.dart';
import 'offline/outbox_store.dart';
import 'pantry/pantry_repo.dart';
import 'profile/profile_repo.dart';
import 'sync/connectivity_monitor.dart';
import 'sync/sync_service.dart';

/// The composition root.
///
/// Every provider here builds ONE shared object graph and wires the P0 layers
/// together end-to-end. Before this existed, the pages each constructed a
/// local-only `_OfflineProfileApi` and nobody ever flushed the [Outbox], so the
/// app ran offline-only. Now:
///   - the pages read [profileRepoProvider] (backed by the REAL [ApiClient]),
///   - a single shared [Outbox] is used for every queued write,
///   - [syncServiceProvider] flushes that Outbox when connectivity returns.
///
/// All providers are plain `Provider`s, so any of them can be overridden in
/// tests (and in `main`) via `ProviderScope(overrides: [...])`.

/// The single [Dio] instance. `baseUrl` is applied per-request by the API layer
/// (it prefixes [Config.baseUrl]); we still set it here for completeness.
final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(baseUrl: Config.baseUrl));
});

/// Device secret storage (the `X-Health-Key`), backed by secure storage.
final secretsProvider = Provider<Secrets>((ref) {
  return Secrets(FlutterSecureStoreAdapter());
});

/// The real backend client — the thing that was never instantiated before.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(dioProvider), ref.watch(secretsProvider));
});

/// The single shared offline queue. One instance app-wide so a write queued by
/// any repo is the SAME queue [syncServiceProvider] later flushes.
final outboxProvider = Provider<Outbox>((ref) {
  return Outbox(const SharedPrefsOutboxStore());
});

/// Local profile persistence (drives first-run detection + survives restart).
final profileStoreProvider = Provider<ProfileStore>((ref) {
  return const SharedPrefsProfileStore();
});

/// The profile repository, wired to the REAL [ApiClient] as its [ProfileApi],
/// the shared [Outbox], and the real local store. This replaces the offline-only
/// default the pages used to build for themselves.
final profileRepoProvider = Provider<ProfileRepo>((ref) {
  return ProfileRepo(
    api: ref.watch(apiClientProvider),
    outbox: ref.watch(outboxProvider),
    store: ref.watch(profileStoreProvider),
  );
});

/// Local pantry persistence (the inventory list, survives restart).
final pantryStoreProvider = Provider<PantryStore>((ref) {
  return const SharedPrefsPantryStore();
});

/// The pantry repository — the inventory keystone. Wired to the SAME shared
/// [Outbox] every other repo uses (so its queued mutations are replayed by
/// [syncServiceProvider] once a `/pantry` backend exists) and the real local
/// store. Overridable in tests via `ProviderScope(overrides: [...])`.
final pantryRepoProvider = Provider<PantryRepo>((ref) {
  return PantryRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(pantryStoreProvider),
  );
});

/// Local nutrition/food-log persistence (survives restart).
final nutritionStoreProvider = Provider<NutritionStore>((ref) {
  return const SharedPrefsNutritionStore();
});

/// The nutrition repository — the food-log data layer. Wired to the SAME shared
/// [Outbox] every other repo uses (so its queued mutations are replayed by
/// [syncServiceProvider] once a `/nutrition` backend exists) and the real local
/// store. Deliberately pantry-agnostic: an eating-out entry records spend and
/// never touches the pantry (deduction lives in [eatInServiceProvider]).
/// Overridable in tests via `ProviderScope(overrides: [...])`.
final nutritionRepoProvider = Provider<NutritionRepo>((ref) {
  return NutritionRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(nutritionStoreProvider),
  );
});

/// Local workout persistence — live gym sessions that must survive an app
/// restart (an interrupted session is never lost). Overridable in tests.
final workoutStoreProvider = Provider<WorkoutStore>((ref) {
  return const SharedPrefsWorkoutStore();
});

/// The workout repository — the gym data layer. Wired to the SAME shared
/// [Outbox] every other repo uses (so its queued mutations are replayed by
/// [syncServiceProvider] once a `/workouts` backend exists) and the real local
/// store. Overridable in tests via `ProviderScope(overrides: [...])`.
final workoutRepoProvider = Provider<WorkoutRepo>((ref) {
  return WorkoutRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(workoutStoreProvider),
  );
});

/// Open Food Facts barcode-lookup client. Uses its OWN [Dio] (NOT [dioProvider]/
/// the authed [ApiClient]) because OFF is a separate public host — no
/// `X-Health-Key`, no [Config.baseUrl] prefix. A dedicated instance keeps the
/// OFF User-Agent + host isolated from the Health Hub backend client.
final offClientProvider = Provider<OffClient>((ref) {
  return OffClient(Dio());
});

/// The eating-in service — the WRITE half of the ingredient graph. Wired to the
/// same [pantryRepoProvider], so a logged home meal deducts its ingredients
/// through the SAME outbox-queued repo everything else uses. Overridable in
/// tests via `ProviderScope(overrides: [...])`. (No UI wires this yet — a later
/// phase calls it from the nutrition/meal-log flow.)
final eatInServiceProvider = Provider<EatInService>((ref) {
  return EatInService(ref.watch(pantryRepoProvider));
});

/// Device connectivity, wrapped behind a testable interface.
final connectivityMonitorProvider = Provider<ConnectivityMonitor>((ref) {
  return ConnectivityPlusMonitor();
});

/// The outbox-flush driver: replays queued mutations through the real
/// [ApiClient] whenever connectivity is (re)gained. This is the first real
/// flush caller. Disposed with the provider container.
final syncServiceProvider = Provider<SyncService>((ref) {
  final service = SyncService(
    outbox: ref.watch(outboxProvider),
    sender: ref.watch(apiClientProvider),
    monitor: ref.watch(connectivityMonitorProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});

/// First-run detection: `true` when a profile has already been saved on this
/// device, `false` when onboarding should be shown. A `FutureProvider` so the
/// gate can await it and tests can override it deterministically.
final hasProfileProvider = FutureProvider<bool>((ref) {
  return ref.watch(profileRepoProvider).hasProfile();
});
