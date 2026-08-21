// Unit tests for GroceryListRepo (R-1) — the Cart notepad's local data layer.
//
// Contracts:
//  • add/toggle/remove/clearDone each persist and return the updated list.
//  • a blank name is a no-op (never persists an empty line).
//  • load reflects what was saved (survives via the injected store).
//  • an absent store → an empty list (honest "nothing added yet").

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';

class _FakeStore implements GroceryListStore {
  List<GroceryItem> _items = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<GroceryItem> items) async => _items = List.of(items);
}

void main() {
  test('starts empty', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    expect(await repo.all(), isEmpty);
  });

  test('add appends a real item and persists', () async {
    final store = _FakeStore();
    final repo = GroceryListRepo(store: store);

    final after = await repo.add('Milk');
    expect(after, hasLength(1));
    expect(after.first.name, 'Milk');
    expect(after.first.done, isFalse);
    // Persisted through the store.
    expect(await store.load(), hasLength(1));
  });

  test('add trims and rejects a blank name (no empty lines)', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    await repo.add('   ');
    expect(await repo.all(), isEmpty);

    final after = await repo.add('  Eggs  ');
    expect(after.single.name, 'Eggs');
  });

  test('toggle flips done and persists', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    final list = await repo.add('Bread');
    final id = list.single.id;

    final toggled = await repo.toggle(id);
    expect(toggled.single.done, isTrue);

    final back = await repo.toggle(id);
    expect(back.single.done, isFalse);
  });

  test('remove deletes by id', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    await repo.add('A');
    final list = await repo.add('B');
    final idA = list.firstWhere((i) => i.name == 'A').id;

    final after = await repo.remove(idA);
    expect(after.map((i) => i.name), ['B']);
  });

  test('clearDone removes only checked items', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    await repo.add('A');
    final list = await repo.add('B');
    final idA = list.firstWhere((i) => i.name == 'A').id;

    await repo.toggle(idA); // check A
    final after = await repo.clearDone();
    expect(after.map((i) => i.name), ['B']);
  });

  test('an unknown id toggle/remove is a no-op', () async {
    final repo = GroceryListRepo(store: _FakeStore());
    await repo.add('A');
    expect((await repo.toggle('nope')).single.name, 'A');
    expect((await repo.remove('nope')).single.name, 'A');
  });
}
