import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide AuthUser;

import 'api/client.dart';
import 'auth/auth_service.dart';
import 'auth/fake_auth_service.dart';
import 'auth/supabase_auth_service.dart';
import 'cart/grocery_item.dart';
import 'cart/grocery_list_repo.dart';
import 'core/config.dart';
import 'core/secrets.dart';
import 'core/secure_store.dart';
import 'gym/workout_repo.dart';
import 'kitchen/kitchen_layout.dart';
import 'meals/eat_in_service.dart';
import 'metrics/weigh_in_repo.dart';
import 'nutrition/nutrition_goals_repo.dart';
import 'nutrition/nutrition_repo.dart';
import 'nutrition/off_client.dart';
import 'offline/failed_store.dart';
import 'offline/outbox.dart';
import 'offline/outbox_store.dart';
import 'pantry/acquisition_service.dart';
import 'pantry/pantry_repo.dart';
import 'pantry/purchase_history.dart';
import 'profile/profile_repo.dart';
import 'sync/connectivity_monitor.dart';
import 'sync/supabase_hydrator.dart';
import 'sync/supabase_sync_sender.dart';
import 'sync/supabase_writer.dart';
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
/// any repo is the SAME queue [syncServiceProvider] later flushes. A durable
/// [SharedPrefsFailedStore] backs the failed list, so a write the server
/// permanently rejects (or one that exhausts its retries) survives a restart and
/// is surfaced to the user — never silently dropped.
final outboxProvider = Provider<Outbox>((ref) {
  final outbox = Outbox(
    const SharedPrefsOutboxStore(),
    failedStore: const SharedPrefsFailedStore(),
  );
  ref.onDispose(outbox.dispose);
  return outbox;
});

/// The live, honest sync state for the UI: a [SyncSnapshot] of the real pending
/// and failed counts. Seeds with a one-shot [Outbox.snapshot] so the first frame
/// is accurate, then tracks the Outbox's [Outbox.snapshots] stream. Never fakes
/// a "synced" state — a failure present yields [SyncStatus.failed].
final syncStatusProvider = StreamProvider<SyncSnapshot>((ref) async* {
  final outbox = ref.watch(outboxProvider);
  yield await outbox.snapshot();
  yield* outbox.snapshots;
});

/// Local profile persistence (drives first-run detection + survives restart).
final profileStoreProvider = Provider<ProfileStore>((ref) {
  return const SharedPrefsProfileStore();
});

/// The [ProfileApi] the profile repo writes THROUGH.
///
/// When Supabase is configured (P4-D3), profile writes must land in the
/// `profile` table, not the retired HTTP backend. Rather than special-case the
/// profile in the sender, we route it exactly like every other repo: the
/// profile PUT is ALWAYS queued into the shared [Outbox], and the
/// [SupabaseSyncSender] flushes it to the `profile` table (mapped from
/// `/tdee/profile`). [OutboxOnlyProfileApi] is the tiny [ProfileApi] that makes
/// the repo queue every write (it returns a non-online status), so the profile
/// rides the same offline-first path as pantry/nutrition/workout.
///
/// When Supabase is NOT configured, we keep the legacy behaviour: the REAL
/// [ApiClient] tries the HTTP PUT (and queues only on failure).
final profileApiProvider = Provider<ProfileApi>((ref) {
  if (Config.supabaseConfigured) {
    return const OutboxOnlyProfileApi();
  }
  return ref.watch(apiClientProvider);
});

/// The profile repository, wired to the [profileApiProvider] (Supabase-routed
/// via the Outbox when configured, else the REAL [ApiClient]), the shared
/// [Outbox], and the real local store.
final profileRepoProvider = Provider<ProfileRepo>((ref) {
  return ProfileRepo(
    api: ref.watch(profileApiProvider),
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

/// Local purchase-history persistence — the append-only real repeat-buy log that
/// the honest reorder-cadence learner reads. Device-local, survives restart.
final purchaseHistoryStoreProvider = Provider<PurchaseHistoryStore>((ref) {
  return const SharedPrefsPurchaseHistoryStore();
});

/// The purchase-history repository — the append-only log of REAL acquisitions
/// per item (keyed by normalized name). Overridable in tests.
final purchaseHistoryRepoProvider = Provider<PurchaseHistoryRepo>((ref) {
  return PurchaseHistoryRepo(store: ref.watch(purchaseHistoryStoreProvider));
});

/// The acquisition service — the WRITE half of the honest reorder-cadence
/// learner. On a genuine re-buy it appends to the purchase history and, once ≥2
/// real buys exist, stamps a learned [reorderCadenceDays] + [lastBought] onto the
/// matching pantry item (via the SAME [pantryRepoProvider]), so `restockSoon`'s
/// reorder-due signal fires organically. Cadence is NEVER guessed. Overridable
/// in tests via `ProviderScope(overrides: [...])`.
final acquisitionServiceProvider = Provider<AcquisitionService>((ref) {
  return AcquisitionService(
    historyRepo: ref.watch(purchaseHistoryRepoProvider),
    pantryRepo: ref.watch(pantryRepoProvider),
  );
});

/// Local kitchen-layout persistence — the single/double appliance display
/// preference for the interactive kitchen (R-3). A device-local, COSMETIC-only
/// config (survives restart). Deliberately NOT wired to the Outbox: it's a
/// display preference, not user data worth syncing (mirrors [GroceryListRepo]).
final kitchenLayoutStoreProvider = Provider<KitchenLayoutStore>((ref) {
  return const SharedPrefsKitchenLayoutStore();
});

/// The kitchen-layout repository — the single/double appliance preference for
/// the interactive kitchen. Cosmetic only: it never touches item data or invents
/// stock. Overridable in tests via `ProviderScope(overrides: [...])`.
final kitchenLayoutRepoProvider = Provider<KitchenLayoutRepo>((ref) {
  return KitchenLayoutRepo(store: ref.watch(kitchenLayoutStoreProvider));
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

/// Local nutrition-goals persistence — the user's daily targets (a singleton,
/// survives restart).
final nutritionGoalsStoreProvider = Provider<NutritionGoalsStore>((ref) {
  return const SharedPrefsNutritionGoalsStore();
});

/// The nutrition-goals repository — the daily-targets data layer (singleton per
/// user). Wired to the SAME shared [Outbox] every other repo uses, so a saved
/// goal is replayed by [syncServiceProvider] into the `nutrition_goals` table.
/// An unset target stays null (honest empty ring). Overridable in tests.
final nutritionGoalsRepoProvider = Provider<NutritionGoalsRepo>((ref) {
  return NutritionGoalsRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(nutritionGoalsStoreProvider),
  );
});

/// Local weigh-in history persistence (survives restart).
final weighInStoreProvider = Provider<WeighInStore>((ref) {
  return const SharedPrefsWeighInStore();
});

/// The weigh-in repository — the weight-history data layer (many rows per user).
/// Wired to the SAME shared [Outbox] every other repo uses, so a logged weigh-in
/// is replayed by [syncServiceProvider] into the `weigh_ins` table. Powers the
/// dashboard's real weight trend (via weight_trend.dart). Overridable in tests.
final weighInRepoProvider = Provider<WeighInRepo>((ref) {
  return WeighInRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(weighInStoreProvider),
  );
});

/// Local grocery-list persistence — the Cart notepad (survives restart).
final groceryListStoreProvider = Provider<GroceryListStore>((ref) {
  return const SharedPrefsGroceryListStore();
});

/// The grocery-list repository — the Cart notepad data layer. Wired to the
/// shared [Outbox] like every other synced repo: each mutation persists locally
/// AND queues a write to the `grocery_list` table, so the list syncs per-user
/// across devices (offline-safe — a queued write is never lost). Overridable in
/// tests via `ProviderScope(overrides: [...])`.
final groceryListRepoProvider = Provider<GroceryListRepo>((ref) {
  return GroceryListRepo(
    outbox: ref.watch(outboxProvider),
    store: ref.watch(groceryListStoreProvider),
  );
});

/// The live grocery list — the reactive source of truth for BOTH the Cart page's
/// rows and the nav's Cart badge. A [FutureProvider] over [GroceryListRepo.all]
/// so any widget can `watch` it and re-render when the list changes; after every
/// mutation (add / toggle / remove / clearDone) callers `ref.invalidate` it to
/// refresh everyone (mirrors how the Brain's `brainInputsProvider` is
/// invalidated). This is what makes the list survive tab-switches under the
/// nav's `IndexedStack`: the page no longer caches items in a one-shot
/// `initState` load that goes stale when an item is added from another screen.
final groceryListProvider = FutureProvider<List<GroceryItem>>((ref) {
  return ref.watch(groceryListRepoProvider).all();
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

/// The Supabase read/write seam. Only meaningful when Supabase is configured;
/// null otherwise so the composition root falls back to the HTTP [ApiClient].
/// Built once, over the initialized `Supabase.instance.client`.
final supabaseWriterProvider = Provider<SupabaseWriter?>((ref) {
  if (!Config.supabaseConfigured) return null;
  return RealSupabaseWriter(Supabase.instance.client);
});

/// The mutation sender the [syncServiceProvider] flushes through.
///
/// When Supabase is configured, this is the [SupabaseSyncSender] — the shared
/// [Outbox]'s queued writes now flush to the per-user Supabase tables. Every
/// row carries `user_id` = the current session user; with no session the sender
/// keeps the write queued (never lost). When Supabase is NOT configured, we
/// keep the legacy HTTP [ApiClient] sender.
final mutationSenderProvider = Provider<MutationSender>((ref) {
  final writer = ref.watch(supabaseWriterProvider);
  if (writer != null) {
    return SupabaseSyncSender(
      writer: writer,
      auth: ref.watch(authServiceProvider),
    );
  }
  return ref.watch(apiClientProvider);
});

/// The outbox-flush driver: replays queued mutations through the
/// [mutationSenderProvider] (Supabase-backed when configured) whenever
/// connectivity is (re)gained. Disposed with the provider container.
final syncServiceProvider = Provider<SyncService>((ref) {
  final service = SyncService(
    outbox: ref.watch(outboxProvider),
    sender: ref.watch(mutationSenderProvider),
    monitor: ref.watch(connectivityMonitorProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});

/// Login-time hydrator: pulls the signed-in user's rows from Supabase into the
/// local stores. Null when Supabase isn't configured (nothing to hydrate from).
/// The auth gate calls `hydrate(userId)` once when a user signs in.
final supabaseHydratorProvider = Provider<SupabaseHydrator?>((ref) {
  final writer = ref.watch(supabaseWriterProvider);
  if (writer == null) return null;
  return SupabaseHydrator(
    writer: writer,
    profileStore: ref.watch(profileStoreProvider),
    pantryStore: ref.watch(pantryStoreProvider),
    nutritionStore: ref.watch(nutritionStoreProvider),
    workoutStore: ref.watch(workoutStoreProvider),
    goalsStore: ref.watch(nutritionGoalsStoreProvider),
    weighInStore: ref.watch(weighInStoreProvider),
    groceryStore: ref.watch(groceryListStoreProvider),
  );
});

/// First-run detection: `true` when a profile has already been saved on this
/// device, `false` when onboarding should be shown. A `FutureProvider` so the
/// gate can await it and tests can override it deterministically.
final hasProfileProvider = FutureProvider<bool>((ref) {
  return ref.watch(profileRepoProvider).hasProfile();
});

/// The auth service — the SWAPPABLE seam for accounts.
///
/// In the running app this wraps the initialised Supabase client
/// (`Supabase.instance.client.auth`) when config is present. If Supabase was
/// NOT initialised (empty `env.local.json` / no dart-defines, e.g. a bare
/// `flutter test` or a mis-provisioned build), we fall back to a
/// [FakeAuthService] so the app runs in a clearly-degraded LOCAL mode instead
/// of crashing — it never fabricates a signed-in state. Tests override this
/// with their own [FakeAuthService].
final authServiceProvider = Provider<AuthService>((ref) {
  if (!Config.supabaseConfigured) {
    // Degraded local mode — no real backend to authenticate against.
    return FakeAuthService(autoConfirm: false);
  }
  return SupabaseAuthService(Supabase.instance.client.auth);
});

/// The reactive auth state: emits the current [AuthUser] (or null) and every
/// change (sign-in / sign-out / session restore / token refresh). The gate
/// watches this to decide between the auth screen and the app. A
/// `StreamProvider` so tests can override it, and so the gate settles
/// deterministically (the fake replays its current value on listen).
final authStateProvider = StreamProvider<AuthUser?>((ref) {
  return ref.watch(authServiceProvider).authState();
});
