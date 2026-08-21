// Widget tests for CartPage (R-1) — the grocery-list notepad.
//
// Contracts:
//  • renders with Key('cart-page') and an honest empty state.
//  • add / check / remove / clear-done work and persist through the repo.
//  • "Share / Export" REALLY copies the list to the clipboard (not a stub).
//  • "Restock soon" suggestions come from REAL pantry data only; adding one
//    puts it on the list; absent when the pantry has nothing due.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/cart_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class _FakeGroceryStore implements GroceryListStore {
  List<GroceryItem> _items = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<GroceryItem> items) async => _items = List.of(items);
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class _FakePantryStore implements PantryStore {
  _FakePantryStore(this._items);
  final List<PantryItem> _items;
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async {}
}

PantryRepo _pantryRepo(List<PantryItem> seed) => PantryRepo(
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakePantryStore(seed),
    );

Widget _cart({GroceryListRepo? repo, List<PantryItem> pantry = const []}) {
  return MaterialApp(
    theme: lightTheme,
    home: CartPage(
      repo: repo ?? GroceryListRepo(store: _FakeGroceryStore()),
      pantryRepo: _pantryRepo(pantry),
    ),
  );
}

void main() {
  testWidgets('renders with cart-page key + honest empty state', (tester) async {
    await tester.pumpWidget(_cart());
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('cart-page')), findsOneWidget);
    expect(find.text('Your list is empty'), findsOneWidget);
  });

  testWidgets('add an item persists and renders', (tester) async {
    final repo = GroceryListRepo(store: _FakeGroceryStore());
    await tester.pumpWidget(_cart(repo: repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('cart-add-field')), 'Milk');
    await tester.tap(find.byKey(const Key('cart-add-btn')));
    await tester.pumpAndSettle();

    expect(find.text('Milk'), findsOneWidget);
    expect((await repo.all()).single.name, 'Milk');
  });

  testWidgets('check + clear-done removes the checked item', (tester) async {
    final store = _FakeGroceryStore();
    final repo = GroceryListRepo(store: store);
    final list = await repo.add('Bread');
    final id = list.single.id;

    await tester.pumpWidget(_cart(repo: repo));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(Key('cart-check-$id')));
    await tester.pumpAndSettle();
    expect((await repo.all()).single.done, isTrue);

    await tester.tap(find.byKey(const Key('cart-clear-done')));
    await tester.pumpAndSettle();
    expect(await repo.all(), isEmpty);
  });

  testWidgets('remove deletes the item', (tester) async {
    final repo = GroceryListRepo(store: _FakeGroceryStore());
    final list = await repo.add('Eggs');
    final id = list.single.id;

    await tester.pumpWidget(_cart(repo: repo));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(Key('cart-remove-$id')));
    await tester.pumpAndSettle();
    expect(await repo.all(), isEmpty);
    expect(find.text('Eggs'), findsNothing);
  });

  testWidgets('share REALLY copies the list to the clipboard', (tester) async {
    // Capture Clipboard.setData calls via the mock platform channel.
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );

    final repo = GroceryListRepo(store: _FakeGroceryStore());
    await repo.add('Milk');
    await repo.add('Bread');

    await tester.pumpWidget(_cart(repo: repo));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-share')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('cart-share-snackbar')), findsOneWidget);
    // The REAL list text landed on the clipboard — not a stub.
    expect(copied, contains('Milk'));
    expect(copied, contains('Bread'));

    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  testWidgets('restock-soon suggestions come from REAL pantry data',
      (tester) async {
    await tester.pumpWidget(_cart(
      pantry: [
        PantryItem(
          id: 'butter',
          name: 'Butter',
          zone: PantryZone.fridge,
          qty: 20,
          unit: 'g',
          source: 'manual',
        ),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('cart-restock-suggestions')), findsOneWidget);
    expect(find.text('Butter'), findsOneWidget);

    // Adding the suggestion puts it on the list (and it leaves the suggestions).
    await tester.tap(find.byKey(const Key('cart-restock-add-butter')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cart-restock-suggestions')), findsNothing);
    // Now on the grocery list (a real checkbox row exists for it).
    expect(find.byType(Checkbox), findsOneWidget);
    expect(find.text('Butter'), findsOneWidget);
  });

  testWidgets('no restock suggestions when the pantry has nothing due',
      (tester) async {
    await tester.pumpWidget(_cart(
      pantry: [
        PantryItem(
          id: 'rice',
          name: 'Rice',
          zone: PantryZone.pantry,
          qty: 900,
          unit: 'g',
          source: 'manual',
        ),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('cart-restock-suggestions')), findsNothing);
  });
}
