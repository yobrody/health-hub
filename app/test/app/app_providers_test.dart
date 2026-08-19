// Tests for the composition root (P1 Task 1).
//
// app_providers.dart is the single place the P0 layers are wired into one
// shared object graph. These tests assert the providers build without throwing
// and — crucially — that profileRepoProvider is backed by the REAL ApiClient
// (not the offline-only _OfflineProfileApi fallback the pages used to construct
// themselves). That fallback is exactly what made the app "offline-only".

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/client.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_repo.dart';

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

void main() {
  test('all providers build without throwing', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    expect(() => container.read(dioProvider), returnsNormally);
    expect(() => container.read(secretsProvider), returnsNormally);
    expect(() => container.read(apiClientProvider), returnsNormally);
    expect(() => container.read(outboxProvider), returnsNormally);
    expect(() => container.read(profileRepoProvider), returnsNormally);
  });

  test('apiClientProvider yields a real ApiClient', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(apiClientProvider), isA<ApiClient>());
  });

  test('profileRepoProvider is wired to the REAL ApiClient (not offline stub)',
      () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final repo = container.read(profileRepoProvider);
    expect(repo, isA<ProfileRepo>());
    // The repo's ProfileApi must BE the shared ApiClient — proving the pages no
    // longer construct a local-only _OfflineProfileApi.
    expect(repo.api, same(container.read(apiClientProvider)));
  });

  test('the Outbox is a single shared instance across reads', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(outboxProvider), same(container.read(outboxProvider)));
    // And the repo uses that same shared Outbox (so a queued write is the same
    // queue the SyncService later flushes).
    final repo = container.read(profileRepoProvider);
    expect(repo.outbox, same(container.read(outboxProvider)));
  });

  test('providers are overridable for tests', () {
    final sharedOutbox = Outbox(_FakeOutboxStore());
    final container = ProviderContainer(
      overrides: [
        // A concrete override proves the graph is injectable end-to-end: the
        // repo must pick up the overridden Outbox, not the default one.
        outboxProvider.overrideWithValue(sharedOutbox),
      ],
    );
    addTearDown(container.dispose);
    expect(() => container.read(profileRepoProvider), returnsNormally);
    expect(container.read(profileRepoProvider).outbox, same(sharedOutbox));
  });
}
