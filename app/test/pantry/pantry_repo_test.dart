// Tests for PantryRepo (P1-T2).
//
// Contract (mirrors ProfileRepo):
//  • add/update/delete/adjustQty ALL persist locally AND enqueue a
//    PendingMutation via the shared Outbox → a queued-success outcome, never
//    "failed".
//  • byZone filters correctly.
//  • adjustQty never writes a negative qty: a delta that would go below 0 is
//    clamped to 0 and the result flags a shortfall (never silently negative,
//    never a silent lie).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── In-memory fake OutboxStore (mirrors other repo tests) ────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

// ── In-memory fake PantryStore ───────────────────────────────────────────────

class FakePantryStore implements PantryStore {
  List<PantryItem> _items = [];

  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PantryItem> items) async {
    _items = List.of(items);
  }
}

PantryRepo buildRepo({FakeOutboxStore? outboxStore, FakePantryStore? store}) {
  return PantryRepo(
    outbox: Outbox(outboxStore ?? FakeOutboxStore()),
    store: store ?? FakePantryStore(),
  );
}

const _eggs = PantryItem(
  id: 'eggs',
  name: 'Eggs',
  zone: PantryZone.fridge,
  qty: 12,
  unit: 'unit',
  source: 'manual',
);

const _rice = PantryItem(
  id: 'rice',
  name: 'Rice',
  zone: PantryZone.pantry,
  qty: 1000,
  unit: 'g',
  source: 'manual',
);

void main() {
  group('PantryRepo.add', () {
    test('persists locally and appears in all()', () async {
      final store = FakePantryStore();
      final repo = buildRepo(store: store);
      await repo.add(_eggs);
      final all = await repo.all();
      expect(all, hasLength(1));
      expect(all.first.id, 'eggs');
      // Persisted to the store, not just in memory.
      expect((await store.load()).single.id, 'eggs');
    });

    test('enqueues a POST /pantry mutation (queued, not failed)', () async {
      final outboxStore = FakeOutboxStore();
      final outbox = Outbox(outboxStore);
      final repo = PantryRepo(outbox: outbox, store: FakePantryStore());

      final outcome = await repo.add(_eggs);

      expect(outcome, WriteOutcome.queued);
      expect(outcome, isNot(WriteOutcome.failed));
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.first.method, 'POST');
      expect(pending.first.path, '/pantry');
      expect(pending.first.dedupeKey, 'pantry:eggs');
      expect(pending.first.body!['id'], 'eggs');
      expect(pending.first.body!['name'], 'Eggs');
    });
  });

  group('PantryRepo.byZone', () {
    test('filters items to the requested zone', () async {
      final repo = buildRepo();
      await repo.add(_eggs); // fridge
      await repo.add(_rice); // pantry
      expect((await repo.byZone(PantryZone.fridge)).map((i) => i.id), ['eggs']);
      expect((await repo.byZone(PantryZone.pantry)).map((i) => i.id), ['rice']);
      expect(await repo.byZone(PantryZone.freezer), isEmpty);
    });
  });

  group('PantryRepo.update', () {
    test('replaces the item and enqueues PUT /pantry/{id}', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = PantryRepo(outbox: outbox, store: FakePantryStore());
      await repo.add(_eggs);

      final outcome = await repo.update(_eggs.copyWith(qty: 6));

      expect(outcome, WriteOutcome.queued);
      expect((await repo.all()).single.qty, 6);
      final pending = await outbox.pending();
      // add + update share the same dedupeKey → deduped to the latest.
      expect(pending, hasLength(1));
      expect(pending.first.method, 'PUT');
      expect(pending.first.path, '/pantry/eggs');
      expect(pending.first.body!['qty'], 6);
    });
  });

  group('PantryRepo.delete', () {
    test('removes the item and enqueues DELETE /pantry/{id}', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = PantryRepo(outbox: outbox, store: FakePantryStore());
      await repo.add(_eggs);

      final outcome = await repo.delete('eggs');

      expect(outcome, WriteOutcome.queued);
      expect(await repo.all(), isEmpty);
      final pending = await outbox.pending();
      expect(pending.single.method, 'DELETE');
      expect(pending.single.path, '/pantry/eggs');
      expect(pending.single.body, isNull);
    });
  });

  group('PantryRepo.adjustQty — qty never goes negative', () {
    test('a normal decrement applies and flags no shortfall', () async {
      final repo = buildRepo();
      await repo.add(_eggs); // qty 12
      final result = await repo.adjustQty('eggs', -2);
      expect(result.shortfall, isFalse);
      expect(result.item!.qty, 10);
      expect(result.outcome, WriteOutcome.queued);
      expect((await repo.all()).single.qty, 10);
    });

    test('an increment applies', () async {
      final repo = buildRepo();
      await repo.add(_eggs); // qty 12
      final result = await repo.adjustQty('eggs', 3);
      expect(result.item!.qty, 15);
      expect(result.shortfall, isFalse);
    });

    test('a delta below 0 CLAMPS to 0 and flags a shortfall (never negative)',
        () async {
      final repo = buildRepo();
      await repo.add(_eggs); // qty 12
      final result = await repo.adjustQty('eggs', -20);
      expect(result.item!.qty, 0); // clamped, NOT -8
      expect(result.shortfall, isTrue);
      expect(result.shortfallAmount, 8); // how much we couldn't cover
      // Persisted value is 0, never negative.
      expect((await repo.all()).single.qty, 0);
      expect((await repo.all()).single.qty! >= 0, isTrue);
    });

    test('adjustQty enqueues a PUT (queued, not failed)', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = PantryRepo(outbox: outbox, store: FakePantryStore());
      await repo.add(_eggs);
      final result = await repo.adjustQty('eggs', -1);
      expect(result.outcome, WriteOutcome.queued);
      expect(result.outcome, isNot(WriteOutcome.failed));
      final pending = await outbox.pending();
      expect(pending.single.method, 'PUT');
      expect(pending.single.path, '/pantry/eggs');
      expect(pending.single.body!['qty'], 11);
    });

    test('adjusting an unknown id returns a not-found result (no crash)',
        () async {
      final repo = buildRepo();
      final result = await repo.adjustQty('ghost', -1);
      expect(result.item, isNull);
      expect(result.outcome, isNull); // nothing queued for a nonexistent item
      expect(result.shortfall, isFalse);
    });

    test('adjusting an item with null qty treats the base as 0', () async {
      const noQty = PantryItem(
        id: 'salt',
        name: 'Salt',
        zone: PantryZone.condiments,
        source: 'manual',
      );
      final repo = buildRepo();
      await repo.add(noQty);
      // From an unknown (null) base, a decrement can't go negative.
      final result = await repo.adjustQty('salt', -5);
      expect(result.item!.qty, 0);
      expect(result.shortfall, isTrue);
      expect(result.shortfallAmount, 5);
      // An increment from null base establishes the qty.
      final up = await repo.adjustQty('salt', 3);
      expect(up.item!.qty, 3);
      expect(up.shortfall, isFalse);
    });
  });
}
