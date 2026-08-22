// Widget tests for FoodPage — the interactive kitchen (R-3) + preserved
// contracts (gate, add form, honest item facts, freshness).
//
// Contracts covered:
//  1. Post-gate, the Food page renders the KITCHEN scene: four appliance panels
//     (fridge/pantry/freezer/spices) with REAL item counts + Key('food-page').
//  2. Tapping a zone panel opens that zone's REAL items (kitchen-zone-view);
//     tapping an item opens the facts sheet with `—` for unset fields.
//  3. A zone with no items shows an honest empty ("Fridge is empty").
//  4. An item without an expiry shows freshness `unknown` (grey), not `fresh`.
//  5. The single/double appliance toggle persists + changes the layout state.
//  6. The gate still shows on an empty pantry; add-item still works.
//
// Fakes: FakeOutboxStore + FakePantryStore + FakeKitchenLayoutStore match the
// pattern in pantry_repo_test.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/kitchen/kitchen_layout.dart';
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

/// In-memory kitchen-layout store — records saves so a test can assert the
/// single/double toggle persisted.
class _FakeKitchenLayoutStore implements KitchenLayoutStore {
  KitchenLayout _layout = KitchenLayout.initial;
  final List<KitchenLayout> saves = [];
  @override
  Future<KitchenLayout> load() async => _layout;
  @override
  Future<void> save(KitchenLayout layout) async {
    _layout = layout;
    saves.add(layout);
  }
}

// ── Seed data ────────────────────────────────────────────────────────────────

// A fully-specified fridge item with a real far-future expiry.
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

/// A fridge item expiring within the use-soon window (real expiry → honest
/// "expiring" badge).
final _expiringSoon = PantryItem(
  id: 'expiring-item',
  name: 'Milk',
  zone: PantryZone.fridge,
  expiry: DateTime.now().add(const Duration(days: 1)),
  source: 'manual',
);

/// Minimal item: only name + zone, everything else null. Lives in condiments
/// (the "Spices" appliance).
const _minimal = PantryItem(
  id: 'minimal-item',
  name: 'Salt',
  zone: PantryZone.condiments,
  source: 'manual',
);

// ── Helper: pump the page with seeded fakes ─────────────────────────────────

Future<(PantryRepo, _FakeKitchenLayoutStore)> _pumpPage(
  WidgetTester tester,
  List<PantryItem> seed, {
  _FakeKitchenLayoutStore? layoutStore,
}) async {
  final repo = PantryRepo(
    outbox: Outbox(_FakeOutboxStore()),
    store: _FakePantryStore(seed),
  );
  final ls = layoutStore ?? _FakeKitchenLayoutStore();

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        pantryRepoProvider.overrideWithValue(repo),
        kitchenLayoutRepoProvider
            .overrideWithValue(KitchenLayoutRepo(store: ls)),
      ],
      child: const MaterialApp(home: FoodPage()),
    ),
  );
  await tester.pumpAndSettle();
  return (repo, ls);
}

// ── Tests ────────────────────────────────────────────────────────────────────

void main() {
  // Test 1: post-gate, the kitchen scene renders 4 zone panels with REAL counts.
  testWidgets('renders the kitchen scene with 4 zone panels + real counts',
      (tester) async {
    await _pumpPage(tester, [_fullWithExpiry, _minimal]);

    expect(find.byKey(const Key('food-page')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-scene')), findsOneWidget);

    // All four appliance panels are present.
    expect(find.byKey(const Key('kitchen-zone-fridge')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-zone-pantry')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-zone-freezer')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-zone-condiments')), findsOneWidget);

    // Appliance labels (condiments reads as "Spices" on the scene).
    expect(find.text('Fridge'), findsOneWidget);
    expect(find.text('Spices'), findsOneWidget);

    // REAL counts: 1 item in fridge, 1 in spices, the other two empty.
    expect(find.text('1 item'), findsNWidgets(2));
    expect(find.text('Empty'), findsNWidgets(2));

    // Item names are NOT on the scene — they live behind a tap.
    expect(find.text('Chicken breast'), findsNothing);
  });

  // Test 2: an "N expiring" badge shows only from real expiry data.
  testWidgets('expiring badge reflects real expiry data (honest urgency)',
      (tester) async {
    // Fridge has one expiring-soon item and one far-future item → "1 expiring".
    await _pumpPage(tester, [_fullWithExpiry, _expiringSoon]);
    expect(find.text('1 expiring'), findsOneWidget);
  });

  testWidgets('no expiring badge when no item is actually expiring',
      (tester) async {
    await _pumpPage(tester, [_fullWithExpiry]); // far-future only
    expect(find.textContaining('expiring'), findsNothing);
  });

  // Test 3: tapping a zone opens its real items; tapping an item → facts sheet.
  testWidgets('tapping a zone opens its real items + item-facts sheet with —',
      (tester) async {
    await _pumpPage(tester, [_minimal]); // Salt lives in condiments/Spices

    // Open the Spices zone.
    await tester.tap(find.byKey(const Key('kitchen-zone-condiments')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('kitchen-zone-view')), findsOneWidget);
    expect(find.text('Salt'), findsWidgets);

    // Tap the item → facts sheet renders `—` for every unset field.
    await tester.tap(find.text('Salt'));
    await tester.pumpAndSettle();

    final dashes = tester.widgetList<Text>(find.text('—'));
    expect(dashes.length, greaterThanOrEqualTo(3),
        reason: 'qty, expiry, price, store all null → at least 3 em-dashes');
    expect(find.text('0'), findsNothing,
        reason: 'a null qty must never be shown as 0');
    expect(find.textContaining('£0'), findsNothing,
        reason: 'a null price must never be shown as £0');
  });

  // Test 4: an empty zone shows an honest empty state.
  testWidgets('an empty zone shows an honest empty state', (tester) async {
    await _pumpPage(tester, [_minimal]); // nothing in the freezer

    await tester.tap(find.byKey(const Key('kitchen-zone-freezer')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('kitchen-zone-view')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-zone-empty')), findsOneWidget);
    expect(find.text('Freezer is empty'), findsOneWidget);
  });

  // Test 5: an item with no expiry shows freshness 'unknown' (grey), not fresh.
  testWidgets(
      'item with no expiry shows unknown freshness (grey), not fresh (green)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);

    // Open the zone the item lives in to reach its tile.
    await tester.tap(find.byKey(const Key('kitchen-zone-condiments')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('freshness-unknown')), findsOneWidget);
    expect(find.byKey(const Key('freshness-fresh')), findsNothing);
  });

  // Test 6: the freshness dot exposes an accessible plain-text Semantics label.
  testWidgets('freshness dot exposes an accessible plain-text label (a11y)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);
    await tester.tap(find.byKey(const Key('kitchen-zone-condiments')));
    await tester.pumpAndSettle();

    expect(
      find.bySemanticsLabel(RegExp('unknown', caseSensitive: false)),
      findsWidgets,
    );
    expect(find.byKey(const Key('freshness-unknown')), findsOneWidget);
  }, semanticsEnabled: true);

  // ── Single/double appliance toggle ─────────────────────────────────────────

  testWidgets(
      'single/double toggle persists + changes the layout (fridge → double)',
      (tester) async {
    final ls = _FakeKitchenLayoutStore();
    await _pumpPage(tester, [_fullWithExpiry], layoutStore: ls);

    // Starts single — no "Double" badge on the fridge yet.
    expect(find.text('Double'), findsNothing);

    // Toggle the fridge to double.
    await tester.tap(find.byKey(const Key('kitchen-toggle-fridge')));
    await tester.pumpAndSettle();

    // Layout state changed: a "Double" badge now shows, and it persisted.
    expect(find.text('Double'), findsOneWidget);
    expect(ls.saves, isNotEmpty);
    expect(ls.saves.last.fridge, ApplianceSize.double_);
    expect(ls.saves.last.pantry, ApplianceSize.single,
        reason: 'toggling fridge must not change other appliances');

    // Toggling again flips it back to single (state persists both ways).
    await tester.tap(find.byKey(const Key('kitchen-toggle-fridge')));
    await tester.pumpAndSettle();
    expect(find.text('Double'), findsNothing);
    expect(ls.saves.last.fridge, ApplianceSize.single);
  });

  testWidgets('spices (condiments) has no single/double toggle',
      (tester) async {
    await _pumpPage(tester, [_minimal]);
    expect(find.byKey(const Key('kitchen-toggle-fridge')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-toggle-pantry')), findsOneWidget);
    expect(find.byKey(const Key('kitchen-toggle-freezer')), findsOneWidget);
    // Spices is always a single rack.
    expect(find.byKey(const Key('kitchen-toggle-condiments')), findsNothing);
  });

  // Test: the toggle is COSMETIC only — it never changes item data.
  testWidgets('single/double toggle never changes item data (cosmetic only)',
      (tester) async {
    final (repo, _) = await _pumpPage(tester, [_fullWithExpiry]);
    final before = await repo.all();

    await tester.tap(find.byKey(const Key('kitchen-toggle-fridge')));
    await tester.pumpAndSettle();

    final after = await repo.all();
    expect(after.length, before.length);
    expect(after.single.qty, before.single.qty);
    expect(after.single.name, before.single.name);
    // Count on the panel is still the REAL 1 item (no phantom stock).
    expect(find.text('1 item'), findsOneWidget);
  });

  // ── First-run gate (R-1) — preserved ───────────────────────────────────────

  testWidgets('empty pantry shows the NON-BLOCKING first-run gate',
      (tester) async {
    await _pumpPage(tester, []);

    expect(find.byKey(const Key('food-gate')), findsOneWidget);
    expect(find.byKey(const Key('food-gate-upload')), findsOneWidget);
    expect(find.byKey(const Key('food-gate-manual')), findsOneWidget);
    expect(find.textContaining('Upload photos of your fridge'), findsOneWidget);
    expect(find.byKey(const Key('food-add-fab')), findsOneWidget);
    // No kitchen scene on an empty pantry.
    expect(find.byKey(const Key('kitchen-scene')), findsNothing);
  });

  testWidgets('gate upload button is the real capture entry, fabricates nothing',
      (tester) async {
    final (repo, _) = await _pumpPage(tester, []);
    expect(find.byKey(const Key('food-gate-upload')), findsOneWidget);
    expect(find.text('Snap photos'), findsOneWidget);
    final all = await repo.all();
    expect(all, isEmpty);
  });

  testWidgets('gate "Add manually" opens the real add-item flow → kitchen',
      (tester) async {
    final (repo, _) = await _pumpPage(tester, []);

    await tester.tap(find.byKey(const Key('food-gate-manual')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('food-form-name')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('food-form-name')), 'Eggs');
    // Zone defaults to fridge.
    await tester.tap(find.byKey(const Key('food-form-submit')));
    await tester.pumpAndSettle();

    // The gate is gone and the kitchen scene shows the fridge now has 1 item.
    expect(find.byKey(const Key('food-gate')), findsNothing);
    expect(find.byKey(const Key('kitchen-scene')), findsOneWidget);
    expect(find.text('1 item'), findsOneWidget);
    final all = await repo.all();
    expect(all.any((i) => i.name == 'Eggs'), isTrue);
  });

  testWidgets('adding an item via the FAB routes through the repo',
      (tester) async {
    final (repo, _) = await _pumpPage(tester, [_minimal]);

    await tester.tap(find.byKey(const Key('food-add-fab')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('food-form-name')), 'Oat milk');
    await tester.tap(find.byKey(const Key('food-form-submit')));
    await tester.pumpAndSettle();

    final all = await repo.all();
    expect(all.any((i) => i.name == 'Oat milk'), isTrue);
    // Fridge (default zone) now shows 1 item on the panel.
    expect(find.text('1 item'), findsWidgets);
  });

  testWidgets('with items present, the kitchen scene shows (no gate)',
      (tester) async {
    await _pumpPage(tester, [_minimal]);
    expect(find.byKey(const Key('food-gate')), findsNothing);
    expect(find.byKey(const Key('kitchen-scene')), findsOneWidget);
  });
}
