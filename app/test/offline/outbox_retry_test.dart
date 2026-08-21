// Tests for the Outbox retry/reject + surfaced-failed-state machinery (P4-E).
//
// Everything runs through in-memory fakes — no I/O, no network. The load-bearing
// integrity guarantees under test:
//   • sent            → removed from the queue;
//   • retryEnvironment (offline/no-auth) → stays, NO tries bump, STOPS the flush;
//   • retryTransient  (5xx/timeout) → BUMPS tries, retried, and at kMaxTries →
//                       MOVED to failed (never wedges the queue);
//   • rejectPermanent → MOVED to failed IMMEDIATELY, and a good mutation behind
//                       it in the FIFO queue STILL syncs (no head-of-line block);
//   • the failed list PERSISTS across an Outbox reload (a write is never lost);
//   • the SyncSnapshot reports pending/failed/synced honestly;
//   • concurrency: the _synchronized lock still loses no write.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/offline/failed_store.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/sync/send_result.dart';

// ── In-memory fakes (persist across an Outbox rebuild if shared) ─────────────

class FakeOutboxStore implements OutboxStore {
  FakeOutboxStore([List<PendingMutation>? seed]) : _items = seed ?? [];
  List<PendingMutation> _items;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class FakeFailedStore implements FailedStore {
  FakeFailedStore([List<PendingMutation>? seed]) : _items = seed ?? [];
  List<PendingMutation> _items;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

PendingMutation _mut(
  String id, {
  String? dedupeKey,
  int tries = 0,
}) =>
    PendingMutation(
      id: id,
      dedupeKey: dedupeKey ?? id,
      method: 'POST',
      path: '/food',
      body: {'id': id},
      createdAt: 0,
      tries: tries,
    );

/// A classifier keyed by mutation id, so each id can be given a distinct outcome.
Future<SendResult> Function(PendingMutation) _byId(
  Map<String, SendResult> table, {
  SendResult fallback = SendResult.sent,
  List<String>? seen,
}) =>
    (m) async {
      seen?.add(m.id);
      return table[m.id] ?? fallback;
    };

void main() {
  group('flushClassified — sent', () {
    test('a sent mutation is removed from the queue', () async {
      final outbox = Outbox(FakeOutboxStore([_mut('a')]),
          failedStore: FakeFailedStore());
      await outbox.flushClassified(_byId({'a': SendResult.sent}));
      expect(await outbox.pending(), isEmpty);
      expect(await outbox.failed(), isEmpty);
    });
  });

  group('flushClassified — retryEnvironment (offline / no-auth)', () {
    test('stays queued, does NOT bump tries, and STOPS the flush', () async {
      final seen = <String>[];
      final outbox = Outbox(FakeOutboxStore([_mut('a'), _mut('b')]),
          failedStore: FakeFailedStore());
      await outbox.flushClassified(
        _byId({'a': SendResult.retryEnvironment}, seen: seen),
      );
      // Only 'a' was attempted; the flush stopped before 'b'.
      expect(seen, ['a']);
      final pending = await outbox.pending();
      expect(pending.map((m) => m.id), ['a', 'b']); // both intact, order kept
      expect(pending.first.tries, 0); // NOT bumped — environmental, not a fault
      expect(await outbox.failed(), isEmpty); // never surfaced as failed
    });

    test('a thrown classifier is treated as environmental (stay, stop)',
        () async {
      final outbox = Outbox(FakeOutboxStore([_mut('a'), _mut('b')]),
          failedStore: FakeFailedStore());
      await outbox.flushClassified((m) async {
        if (m.id == 'a') throw Exception('network down');
        return SendResult.sent;
      });
      expect((await outbox.pending()).map((m) => m.id), ['a', 'b']);
      expect(await outbox.failed(), isEmpty);
    });
  });

  group('flushClassified — retryTransient (5xx / timeout)', () {
    test('bumps tries and CONTINUES to the next item (no stop)', () async {
      final seen = <String>[];
      final outbox = Outbox(FakeOutboxStore([_mut('a'), _mut('b')]),
          failedStore: FakeFailedStore());
      await outbox.flushClassified(
        _byId({'a': SendResult.retryTransient, 'b': SendResult.sent},
            seen: seen),
      );
      // Both attempted — a transient failure on 'a' did NOT stop 'b'.
      expect(seen, ['a', 'b']);
      final pending = await outbox.pending();
      expect(pending.map((m) => m.id), ['a']); // 'b' sent; 'a' retained
      expect(pending.single.tries, 1); // bumped once
      expect(await outbox.failed(), isEmpty);
    });

    test('at kMaxTries a transient failure MOVES the item to failed', () async {
      // Seed one try below the ceiling; one more bump reaches kMaxTries.
      final outbox = Outbox(
        FakeOutboxStore([_mut('a', tries: kMaxTries - 1)]),
        failedStore: FakeFailedStore(),
      );
      await outbox.flushClassified(_byId({'a': SendResult.retryTransient}));
      expect(await outbox.pending(), isEmpty); // out of the pending queue
      final failed = await outbox.failed();
      expect(failed.single.id, 'a'); // surfaced, never dropped
      expect(failed.single.tries, kMaxTries);
    });

    test('a chronically-transient item does not wedge later items', () async {
      final outbox = Outbox(
        FakeOutboxStore([_mut('a', tries: kMaxTries - 1), _mut('b')]),
        failedStore: FakeFailedStore(),
      );
      await outbox.flushClassified(
        _byId({'a': SendResult.retryTransient, 'b': SendResult.sent}),
      );
      // 'a' expired → failed; 'b' behind it still synced.
      expect(await outbox.pending(), isEmpty);
      expect((await outbox.failed()).map((m) => m.id), ['a']);
    });
  });

  group('flushClassified — rejectPermanent (no head-of-line block)', () {
    test('a permanent reject moves to failed IMMEDIATELY', () async {
      final outbox = Outbox(FakeOutboxStore([_mut('a')]),
          failedStore: FakeFailedStore());
      await outbox.flushClassified(_byId({'a': SendResult.rejectPermanent}));
      expect(await outbox.pending(), isEmpty);
      expect((await outbox.failed()).single.id, 'a'); // surfaced, not dropped
    });

    test('a good mutation BEHIND a permanent reject still syncs', () async {
      // The classic head-of-line-block bug: 'bad' is permanently rejected but
      // must not trap 'good' behind it in the FIFO queue.
      final seen = <String>[];
      final outbox = Outbox(
        FakeOutboxStore([_mut('bad'), _mut('good')]),
        failedStore: FakeFailedStore(),
      );
      await outbox.flushClassified(
        _byId({'bad': SendResult.rejectPermanent, 'good': SendResult.sent},
            seen: seen),
      );
      expect(seen, ['bad', 'good']); // both attempted — no block
      expect(await outbox.pending(), isEmpty); // 'good' sent, 'bad' removed
      expect((await outbox.failed()).map((m) => m.id), ['bad']); // surfaced
    });
  });

  group('failed state persistence', () {
    test('the failed list survives an Outbox reload (shared stores)', () async {
      final pendingStore = FakeOutboxStore([_mut('a')]);
      final failedStore = FakeFailedStore();

      final outbox1 = Outbox(pendingStore, failedStore: failedStore);
      await outbox1.flushClassified(_byId({'a': SendResult.rejectPermanent}));
      expect((await outbox1.failed()).single.id, 'a');
      await outbox1.dispose();

      // A brand-new Outbox over the SAME durable stores (a restart) still sees
      // the failed write — it was never lost.
      final outbox2 = Outbox(pendingStore, failedStore: failedStore);
      expect((await outbox2.failed()).single.id, 'a');
      expect(await outbox2.pending(), isEmpty);
      await outbox2.dispose();
    });
  });

  group('retryFailed', () {
    test('requeues failed items (tries reset) and clears the failed list',
        () async {
      final outbox = Outbox(
        FakeOutboxStore([_mut('a', tries: kMaxTries - 1)]),
        failedStore: FakeFailedStore(),
      );
      // Push 'a' to failed via an exhausted transient.
      await outbox.flushClassified(_byId({'a': SendResult.retryTransient}));
      expect((await outbox.failed()).single.id, 'a');

      await outbox.retryFailed();
      final pending = await outbox.pending();
      expect(pending.single.id, 'a'); // back in the queue
      expect(pending.single.tries, 0); // counter reset for a fresh attempt
      expect(await outbox.failed(), isEmpty); // failed list cleared

      // And it can now succeed on the retry.
      await outbox.flushClassified(_byId({'a': SendResult.sent}));
      expect(await outbox.pending(), isEmpty);
      expect(await outbox.failed(), isEmpty);
    });
  });

  group('SyncSnapshot honesty', () {
    test('status is synced only when nothing is pending or failed', () {
      expect(const SyncSnapshot(pendingCount: 0, failedCount: 0).status,
          SyncStatus.synced);
    });
    test('pending writes → pending; a failure takes precedence → failed', () {
      expect(const SyncSnapshot(pendingCount: 2, failedCount: 0).status,
          SyncStatus.pending);
      // Even with items still pending, a failure is surfaced (never a fake
      // "synced" / "all pending" while a write couldn't sync).
      expect(const SyncSnapshot(pendingCount: 2, failedCount: 1).status,
          SyncStatus.failed);
      expect(const SyncSnapshot(pendingCount: 0, failedCount: 1).status,
          SyncStatus.failed);
    });

    test('Outbox.snapshot reports the real pending + failed counts', () async {
      final outbox = Outbox(
        FakeOutboxStore([_mut('a'), _mut('bad'), _mut('c')]),
        failedStore: FakeFailedStore(),
      );
      await outbox.flushClassified(_byId({
        'a': SendResult.sent,
        'bad': SendResult.rejectPermanent,
        'c': SendResult.retryTransient, // stays pending (bumped once)
      }));
      final snap = await outbox.snapshot();
      expect(snap.pendingCount, 1); // 'c'
      expect(snap.failedCount, 1); // 'bad'
      expect(snap.status, SyncStatus.failed);
      await outbox.dispose();
    });

    test('snapshots stream emits after a flush changes the state', () async {
      final outbox = Outbox(FakeOutboxStore([_mut('a')]),
          failedStore: FakeFailedStore());
      final emitted = <SyncSnapshot>[];
      final sub = outbox.snapshots.listen(emitted.add);
      await outbox.flushClassified(_byId({'a': SendResult.rejectPermanent}));
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();
      // The last emission reflects the real end state: 0 pending, 1 failed.
      expect(emitted.last.pendingCount, 0);
      expect(emitted.last.failedCount, 1);
      await outbox.dispose();
    });
  });

  group('concurrency — the lock still loses no write', () {
    test('a concurrent enqueue during a flushClassified is not lost', () async {
      final outbox = Outbox(
        FakeOutboxStore([_mut('1', dedupeKey: 'a'), _mut('2', dedupeKey: 'b')]),
        failedStore: FakeFailedStore(),
      );
      final flushFut =
          outbox.flushClassified(_byId({'1': SendResult.sent, '2': SendResult.sent}));
      final enqFut = outbox.enqueue(_mut('3', dedupeKey: 'c'));
      await Future.wait([flushFut, enqFut]);

      final ids = (await outbox.pending()).map((m) => m.id).toSet();
      expect(ids, contains('3')); // concurrent enqueue survived
      expect(ids, isNot(contains('1'))); // sent → not resurrected
      expect(ids, isNot(contains('2')));
      await outbox.dispose();
    });
  });
}
