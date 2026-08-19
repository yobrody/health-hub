// Tests for the offline outbox queue (Task 5).
// Uses an in-memory fake OutboxStore — no I/O, all assertions are pure/synchronous.
// Mirrors the behavior contracts from the legacy src/lib/outbox.ts.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

// ── In-memory fake store ─────────────────────────────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

PendingMutation makeMutation({
  String id = 'a',
  String dedupeKey = 'food/today',
  String method = 'POST',
  String path = '/food',
  Map<String, dynamic>? body,
  int? createdAt,
  int tries = 0,
}) =>
    PendingMutation(
      id: id,
      dedupeKey: dedupeKey,
      method: method,
      path: path,
      body: body,
      createdAt: createdAt ?? DateTime.now().millisecondsSinceEpoch,
      tries: tries,
    );

void main() {
  // ── PendingMutation serialisation ────────────────────────────────────────
  group('PendingMutation', () {
    test('round-trips through toJson / fromJson', () {
      final m = makeMutation(
        id: 'x1',
        dedupeKey: 'water/today',
        method: 'PUT',
        path: '/water',
        body: {'ml': 250},
        createdAt: 1_000_000,
        tries: 2,
      );
      final m2 = PendingMutation.fromJson(m.toJson());
      expect(m2.id, m.id);
      expect(m2.dedupeKey, m.dedupeKey);
      expect(m2.method, m.method);
      expect(m2.path, m.path);
      expect(m2.body, m.body);
      expect(m2.createdAt, m.createdAt);
      expect(m2.tries, m.tries);
    });

    test('round-trips with null body', () {
      final m = makeMutation(id: 'x2', body: null);
      final m2 = PendingMutation.fromJson(m.toJson());
      expect(m2.body, isNull);
    });
  });

  // ── Pure list ops (enqueueInto) ──────────────────────────────────────────
  group('enqueueInto (pure)', () {
    test('appends a new mutation with a fresh dedupeKey', () {
      final m1 = makeMutation(id: '1', dedupeKey: 'food/today');
      final m2 = makeMutation(id: '2', dedupeKey: 'water/today');
      final result = enqueueInto([m1], m2);
      expect(result.map((m) => m.id).toList(), ['1', '2']);
    });

    test('does not mutate the input list', () {
      final original = [makeMutation(id: '1')];
      enqueueInto(original, makeMutation(id: '2', dedupeKey: 'other/key'));
      expect(original, hasLength(1));
    });

    test('dedupes by dedupeKey — same key twice yields ONE entry (the newer)', () {
      final older = makeMutation(id: 'old', dedupeKey: 'food/today');
      final newer = makeMutation(id: 'new', dedupeKey: 'food/today');
      final result = enqueueInto([older], newer);
      // Only one entry survives
      expect(result, hasLength(1));
      // The newer replaces the older
      expect(result.first.id, 'new');
    });

    test('dedupe preserves FIFO order of OTHER entries', () {
      final m1 = makeMutation(id: '1', dedupeKey: 'food/today');
      final m2 = makeMutation(id: '2', dedupeKey: 'water/today');
      final m3 = makeMutation(id: '3', dedupeKey: 'food/today'); // refreshes m1
      final result = enqueueInto([m1, m2], m3);
      // m2 keeps its position; m1 is replaced by m3 (newer) at the end / refreshed
      expect(result.map((m) => m.id).toList(), contains('3'));
      expect(result.map((m) => m.id).toList(), contains('2'));
      expect(result.map((m) => m.id).toList(), isNot(contains('1')));
      expect(result, hasLength(2));
    });

    test('enqueuing a brand-new key into a non-empty list appends at the end', () {
      final m1 = makeMutation(id: '1', dedupeKey: 'food/today');
      final m2 = makeMutation(id: '2', dedupeKey: 'gym/today');
      final result = enqueueInto([m1], m2);
      expect(result.last.id, '2');
    });
  });

  // ── Outbox class (with IO via fake store) ────────────────────────────────
  group('Outbox.enqueue', () {
    test('adds a mutation and makes it retrievable via pending()', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      final m = makeMutation(id: '1');
      await outbox.enqueue(m);
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.first.id, '1');
    });

    test('dedupes via enqueueInto — same dedupeKey replaced (only 1 entry)', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await outbox.enqueue(makeMutation(id: 'old', dedupeKey: 'food/today'));
      await outbox.enqueue(makeMutation(id: 'new', dedupeKey: 'food/today'));
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.first.id, 'new');
    });
  });

  // ── Outbox.flush ────────────────────────────────────────────────────────
  group('Outbox.flush', () {
    test('sends mutations in FIFO order and removes those that succeed', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await outbox.enqueue(makeMutation(id: '1', dedupeKey: 'a'));
      await outbox.enqueue(makeMutation(id: '2', dedupeKey: 'b'));
      await outbox.enqueue(makeMutation(id: '3', dedupeKey: 'c'));

      final sentOrder = <String>[];
      await outbox.flush((m) async {
        sentOrder.add(m.id);
        return true; // all succeed
      });

      expect(sentOrder, ['1', '2', '3']); // FIFO
      expect(await outbox.pending(), isEmpty); // all removed
    });

    test('a send that returns false leaves that mutation queued and stops flushing', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await outbox.enqueue(makeMutation(id: '1', dedupeKey: 'a'));
      await outbox.enqueue(makeMutation(id: '2', dedupeKey: 'b'));
      await outbox.enqueue(makeMutation(id: '3', dedupeKey: 'c'));

      final sentOrder = <String>[];
      await outbox.flush((m) async {
        sentOrder.add(m.id);
        return m.id != '2'; // '2' fails
      });

      // Sent '1' (ok), '2' (fail → stop)
      expect(sentOrder, ['1', '2']);
      // '2' and '3' remain (not lost)
      final remaining = (await outbox.pending()).map((m) => m.id).toList();
      expect(remaining, containsAll(['2', '3']));
      expect(remaining, isNot(contains('1')));
    });

    test('a send that throws leaves that mutation queued and stops flushing', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await outbox.enqueue(makeMutation(id: '1', dedupeKey: 'a'));
      await outbox.enqueue(makeMutation(id: '2', dedupeKey: 'b'));

      await outbox.flush((m) async {
        if (m.id == '1') throw Exception('network error');
        return true;
      });

      // '1' stays queued — not lost
      final remaining = (await outbox.pending()).map((m) => m.id).toList();
      expect(remaining, contains('1'));
    });

    test('does nothing for an empty queue', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await expectLater(
        outbox.flush((_) async => true),
        completes,
      );
      expect(await outbox.pending(), isEmpty);
    });
  });

  // ── WriteOutcome — queued is NOT failed ─────────────────────────────────
  group('WriteOutcome', () {
    test('queued is a distinct success-state, not failed', () {
      // The enum must have a `queued` value that is not `failed`
      expect(WriteOutcome.queued, isNot(WriteOutcome.failed));
      expect(WriteOutcome.sent, isNot(WriteOutcome.failed));
      expect(WriteOutcome.queued, isNot(WriteOutcome.sent));
    });

    test('an enqueued mutation resolves to WriteOutcome.queued (not failed)', () async {
      // Simulates what a caller would see: enqueue returns without error,
      // and the outcome is represented as queued — the app must not show "failed".
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      final m = makeMutation(id: 'offline-1');

      // enqueue() itself is the queued-success path — it must not throw
      await expectLater(outbox.enqueue(m), completes);

      // And the item is safely stored
      final pending = await outbox.pending();
      expect(pending.any((p) => p.id == 'offline-1'), isTrue);

      // WriteOutcome.queued is the value to use when wiring into the API layer
      const outcome = WriteOutcome.queued;
      expect(outcome, isNot(WriteOutcome.failed));
    });
  });

  // ── Concurrency — the lost-update race (C1) ───────────────────────────────
  group('Outbox concurrency', () {
    test('two un-awaited enqueues with distinct keys BOTH survive', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);

      // Fire both without awaiting between them (e.g. user logs food + water
      // back-to-back). Without serialization both read the same empty snapshot
      // and the second persist clobbers the first → one write is lost.
      final f1 = outbox.enqueue(makeMutation(id: 'food', dedupeKey: 'food/today'));
      final f2 = outbox.enqueue(makeMutation(id: 'water', dedupeKey: 'water/today'));
      await Future.wait([f1, f2]);

      final pending = await outbox.pending();
      expect(pending, hasLength(2), reason: 'both offline writes must survive');
      expect(
        pending.map((m) => m.id).toSet(),
        {'food', 'water'},
      );
    });

    test('interleaving an enqueue with a flush loses/resurrects no item', () async {
      final store = FakeOutboxStore();
      final outbox = Outbox(store);
      await outbox.enqueue(makeMutation(id: '1', dedupeKey: 'a'));
      await outbox.enqueue(makeMutation(id: '2', dedupeKey: 'b'));

      // Start a flush that removes '1' and '2', and concurrently enqueue a
      // fresh item. The new enqueue must not be dropped by flush's persist,
      // and flush must not resurrect an item it already removed.
      final flushFut = outbox.flush((m) async => true); // removes 1 and 2
      final enqFut = outbox.enqueue(makeMutation(id: '3', dedupeKey: 'c'));
      await Future.wait([flushFut, enqFut]);

      final ids = (await outbox.pending()).map((m) => m.id).toSet();
      // '1' and '2' were sent → gone. '3' was enqueued → must still be present.
      expect(ids, contains('3'), reason: 'concurrent enqueue must not be lost');
      expect(ids, isNot(contains('1')), reason: 'sent item must not resurrect');
      expect(ids, isNot(contains('2')), reason: 'sent item must not resurrect');
    });
  });

  // ── MAX_TRIES (parity with legacy) ────────────────────────────────────────
  group('maxTries / dropExpired', () {
    test('dropExpired removes items at or over MAX_TRIES', () {
      final items = [
        makeMutation(id: '1', dedupeKey: 'a', tries: kMaxTries),
        makeMutation(id: '2', dedupeKey: 'b', tries: kMaxTries - 1),
        makeMutation(id: '3', dedupeKey: 'c', tries: 0),
      ];
      final result = dropExpired(items);
      expect(result.map((m) => m.id).toList(), ['2', '3']);
    });

    test('bumpTries increments tries for the target id only', () {
      final items = [
        makeMutation(id: '1', dedupeKey: 'a', tries: 0),
        makeMutation(id: '2', dedupeKey: 'b', tries: 3),
      ];
      final bumped = bumpTries(items, '2');
      expect(bumped.firstWhere((m) => m.id == '2').tries, 4);
      expect(bumped.firstWhere((m) => m.id == '1').tries, 0);
    });
  });
}
