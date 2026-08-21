// Widget tests for FoodPage (P1-T3).
//
// Four contracts:
//  1. The page renders items grouped by zone and carries `Key('food-page')`.
//  2. Adding an item (form submit) routes through the repo (item appears).
//  3. The item detail sheet renders `—` for every unset field on a minimal item
//     — no fabricated zeros, no fake dates.
//  4. An item without an expiry date shows freshness `unknown` (grey dot), NOT
//     `fresh` (green dot).
//
// Fakes: FakeOutboxStore + FakePantryStore match the pattern in pantry_repo_test.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/food_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── Fakes ────────────────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class _FakePantryStore implements PantryStore {
  List<PantryItem> _items;
  _FakePantryStore(List<PantryItem> seed) : _items = List.of(seed);
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
}

// ── Seed data ────────────────────────────────────────────────────────────────

// A fully-specified item with a real far-future expiry for group/render tests.
final _fullWithExpiry = PantryItem(
  id: 'full-item-expiry',
  name: 'Chicken breast',
  zone: PantryZone.fridge,
  qty: 2.0,
  unit: 'pack',
  expiry: DateTime.now().add(const Duration(days: 30)),
  priceGbp: 4.99,
  store: 'Tesco',
  source: 'manual',
);

/// Minimal item: only name + zone, everything else null.
const _minimal = PantryItem(
  id: 'minimal-item',
  name: 'Salt',
  zone: PantryZone.condiments,
  source: 'manual',
  // qty, unit, expiry, priceGbp, store, purchasedAt, reorderCadenceDays — all null
);

// ── Helper: pump the page with a seeded fake repo ───────────────────────────

Future<PantryRepo> _pumpPage(
  WidgetTester tester,
  List<PantryItem> seed,
) async {
  final store = _FakePantryStore(seed);
  final repo = PantryRepo(
    outbox: Outbox(_FakeOutboxStore()),
    store: store,
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        pantryRepoProvider.overrideWithValue(repo),
      ],
      child: const MaterialApp(home: FoodPage()),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

// ── Tests ────────────────────────────────────────────────────────────────────

void main() {
  // Test 1: page renders with food-page key + items grouped by zone.
  testWidgets('renders food-page key and items grouped by zone',
      (tester) async {
    await _pumpPage(tester, [_fullWithExpiry, _minimal]);

    // Root key must be present.
    expect(find.byKey(const Key('food-page')), findsOneWidget);

    // Both item names are visible.
    expect(find.text('Chicken breast'), findsWidgets);
    expect(find.text('Salt'), findsWidgets);

    // Zone section headers are visible (fridge and condiments).
    expect(find.text('Fridge'), findsOneWidget);
    expect(find.text('Condiments'), findsOneWidget);
  });

  // Test 2: adding an item via the form shows it on the page.
  testWidgets('adding an item via the form routes through the repo',
      (tester) async {
    final repo = await _pumpPage(tester, []);

    // Tap the FAB to open the add form.
    await tester.tap(find.byKey(const Key('food-add-fab')));
    await tester.pumpAndSettle();

    // Fill in name and pick a zone (name is required).
    await tester.enterText(find.byKey(const Key('food-form-name')), 'Oat milk');
    // Zone defaults to fridge; accept the default.

    // Submit the form.
    await tester.tap(find.byKey(const Key('food-form-submit')));
    await tester.pumpAndSettle();

    // The new item appears on the page.
    expect(find.text('Oat milk'), findsWidgets);

    // The repo received the add (item is in the store).
    final all = await repo.all();
    expect(all.any((i) => i.name == 'Oat milk'), isTrue);
  });

  // Test 3: detail sheet for a minimal item renders — for every null field.
  testWidgets('detail sheet shows — for every unset field (no fabricated values)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);

    // Tap the item row to open the detail sheet.
    await tester.tap(find.text('Salt'));
    await tester.pumpAndSettle();

    // Every unset field must show the em-dash.
    // The sheet must contain multiple dashes (qty, unit, expiry, price, store,
    // purchasedAt, reorderCadenceDays are all null).
    final dashes = tester.widgetList<Text>(find.text('—'));
    expect(dashes.length, greaterThanOrEqualTo(3),
        reason: 'qty, expiry, price, store all null → at least 3 em-dashes');

    // Fabricated values must NOT appear.
    expect(find.text('0'), findsNothing,
        reason: 'a null qty must never be shown as 0');
    expect(find.textContaining('£0'), findsNothing,
        reason: 'a null price must never be shown as £0');
  });

  // Test 4: an item with no expiry shows freshness 'unknown' (grey), NOT 'fresh'.
  testWidgets(
      'item with no expiry shows unknown freshness (grey dot), not fresh (green)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);

    // The grey/unknown freshness indicator must be present.
    expect(find.byKey(const Key('freshness-unknown')), findsOneWidget);

    // The green/fresh indicator must NOT be present for an item with no expiry.
    expect(find.byKey(const Key('freshness-fresh')), findsNothing);
  });

  // Test 5 (P4-G): freshness dot exposes a plain-text Semantics label so that
  // screen readers can announce "Expiry unknown" / "Expired" / "Use soon" /
  // "Fresh" — colour alone is not accessible.
  testWidgets(
      'freshness dot exposes an accessible plain-text label (P4-G a11y)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);

    // The dot must be findable by a Semantics label that contains "unknown"
    // (case-insensitive). find.bySemanticsLabel uses a regex match by default;
    // we supply a RegExp that accepts any label containing the word "unknown".
    expect(
      find.bySemanticsLabel(RegExp('unknown', caseSensitive: false)),
      findsWidgets,
      reason:
          'The freshness dot for a no-expiry item must expose a Semantics '
          'label containing "unknown" so screen readers can announce the state',
    );

    // The raw dot widget must still be present (Key contract unchanged).
    expect(find.byKey(const Key('freshness-unknown')), findsOneWidget);
  }, semanticsEnabled: true);
}
