// Unit tests for GroceryListRepo — the Cart notepad's data layer, now
// per-user cloud-synced through the shared offline Outbox.
//
// Contracts:
//  • add/toggle/remove/clearDone each persist locally and return the updated
//    list (the reactive provider's source of truth stays LOCAL).
//  • EVERY mutation also enqueues the right Outbox mutation (path + method), and
//    a blank name enqueues nothing (never an empty line).
//  • remove enqueues a DELETE /grocery/{id} (an honest cross-device delete — no
//    ghost row); clearDone enqueues a DELETE per removed item.
//  • a queued write is a SUCCESS — offline/no-auth never loses a line.
//  • the [_synchronized] lock: concurrent mutations never lose a write.
//  • an absent store → an empty list (honest "nothing added yet").

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

class _FakeStore implements GroceryListStore {
  List<GroceryItem> _items = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<GroceryItem> items) async => _items = List.of(items);
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _m = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_m);
  @override
  Future<void> save(List<PendingMutation> m) async => _m = List.of(m);
}

({GroceryListRepo repo, GroceryListStore store, Outbox outbox}) _build() {
  final store = _FakeStore();
  final outbox = Outbox(_FakeOutboxStore());
  return (
    repo: GroceryListRepo(outbox: outbox, store: store),
    store: store,
    outbox: outbox,
  );
}

void main() {
  test('starts empty', () async {
    final b = _build();
    expect(await b.repo.all(), isEmpty);
  });

  test('add appends a real item and persists', () async {
    final b = _build();

    final after = await b.repo.add('Milk');
    expect(after, hasLength(1));
    expect(after.first.name, 'Milk');
    expect(after.first.done, isFalse);
    // Persisted through the LOCAL store (the reactive provider's source).
    expect(await b.store.load(), hasLength(1));
  });

  test('add trims and rejects a blank name (no empty lines, no enqueue)',
      () async {
    final b = _build();
    await b.repo.add('   ');
    expect(await b.repo.all(), isEmpty);
    // A blank name must NOT queue a phantom write.
    expect(await b.outbox.pending(), isEmpty);

    final after = await b.repo.add('  Eggs  ');
    expect(after.single.name, 'Eggs');
  });

  test('toggle flips done and persists', () async {
    final b = _build();
    final list = await b.repo.add('Bread');
    final id = list.single.id;

    final toggled = await b.repo.toggle(id);
    expect(toggled.single.done, isTrue);

    final back = await b.repo.toggle(id);
    expect(back.single.done, isFalse);
  });

  test('remove deletes by id', () async {
    final b = _build();
    await b.repo.add('A');
    final list = await b.repo.add('B');
    final idA = list.firstWhere((i) => i.name == 'A').id;

    final after = await b.repo.remove(idA);
    expect(after.map((i) => i.name), ['B']);
  });

  test('clearDone removes only checked items', () async {
    final b = _build();
    await b.repo.add('A');
    final list = await b.repo.add('B');
    final idA = list.firstWhere((i) => i.name == 'A').id;

    await b.repo.toggle(idA); // check A
    final after = await b.repo.clearDone();
    expect(after.map((i) => i.name), ['B']);
  });

  test('an unknown id toggle/remove is a no-op (nothing persisted or enqueued)',
      () async {
    final b = _build();
    await b.repo.add('A');
    final before = await b.outbox.pending();

    expect((await b.repo.toggle('nope')).single.name, 'A');
    expect((await b.repo.remove('nope')).single.name, 'A');
    // No phantom mutation for an id that isn't on the list.
    expect(await b.outbox.pending(), hasLength(before.length));
  });

  // ── Sync wiring (mirrors pantry/nutrition) ──────────────────────────────────

  test('add enqueues POST /grocery carrying the item body', () async {
    final b = _build();
    final list = await b.repo.add('Milk');
    final id = list.single.id;

    final pending = await b.outbox.pending();
    final mut = pending.single;
    expect(mut.method, 'POST');
    expect(mut.path, '/grocery');
    expect(mut.dedupeKey, 'grocery:$id');
    expect(mut.body?['name'], 'Milk');
    expect(mut.body?['done'], isFalse);
    // Return is a queued-success — the caller never sees "failed".
    // (WriteOutcome isn't returned by the list-returning API, but a completed
    // enqueue IS the success signal — asserted by the presence above.)
  });

  test('toggle enqueues PUT /grocery/{id} with the new checked state',
      () async {
    final b = _build();
    final list = await b.repo.add('Bread');
    final id = list.single.id;

    await b.repo.toggle(id);
    final pending = await b.outbox.pending();
    // add + toggle share the dedupeKey → the toggle supersedes the add (latest
    // intent), so exactly ONE mutation remains for this item.
    final mut = pending.single;
    expect(mut.method, 'PUT');
    expect(mut.path, '/grocery/$id');
    expect(mut.body?['done'], isTrue);
  });

  test('remove enqueues a real DELETE /grocery/{id} (no ghost row)', () async {
    final b = _build();
    final list = await b.repo.add('Eggs');
    final id = list.single.id;

    await b.repo.remove(id);
    final pending = await b.outbox.pending();
    // add + remove share the dedupeKey → the DELETE supersedes the POST.
    final mut = pending.single;
    expect(mut.method, 'DELETE');
    expect(mut.path, '/grocery/$id');
    expect(mut.body, isNull);
  });

  test('clearDone enqueues a DELETE for each removed (checked) item', () async {
    final b = _build();
    final a = (await b.repo.add('A')).single.id;
    final bId = (await b.repo.add('B')).last.id;
    await b.repo.toggle(a);
    await b.repo.toggle(bId);

    await b.repo.clearDone();
    final pending = await b.outbox.pending();
    final deletes =
        pending.where((m) => m.method == 'DELETE').map((m) => m.path).toSet();
    expect(deletes, {'/grocery/$a', '/grocery/$bId'});
  });

  test('_synchronized serializes concurrent adds — no lost write', () async {
    final b = _build();
    // Fire many adds without awaiting between them; the lock must apply each in
    // order so none clobbers another (both locally AND in the queue).
    await Future.wait([
      for (var i = 0; i < 20; i++) b.repo.add('item-$i'),
    ]);

    final items = await b.repo.all();
    expect(items, hasLength(20));
    expect(items.map((i) => i.name).toSet(), {
      for (var i = 0; i < 20; i++) 'item-$i',
    });
    // Each add is a distinct item id → a distinct dedupeKey → 20 queued writes.
    expect(await b.outbox.pending(), hasLength(20));
  });
}
