// Widget tests for the home "Restock soon" card (R-1 — supersedes the old
// P4-F pantry-glance card).
//
// The dashboard surfaces a calm RESTOCK SOON card ONLY when real pantry data has
// items low / expiring / reorder-due — and omits it otherwise (never an invented
// urgency card). Tapping it opens the Food page (via onOpenPantry).
//
// Honesty invariants under test:
//  • Low/expiring derived from REAL qty/expiry; a null-data item is not shown.
//  • The card is absent when nothing qualifies.
//  • Tapping invokes the open-pantry callback.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class _FakeProfileStore implements ProfileStore {
  _FakeProfileStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _FakeProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class _FakeNutritionStore implements NutritionStore {
  @override
  Future<List<FoodLogEntry>> load() async => const [];
  @override
  Future<void> save(List<FoodLogEntry> items) async {}
}


class _FakeGoalsStore implements NutritionGoalsStore {
  @override
  Future<Map<String, dynamic>?> load() async => null;
  @override
  Future<void> save(Map<String, dynamic> json) async {}
}

class _FakeWeighInStore implements WeighInStore {
  @override
  Future<List<WeighIn>> load() async => const [];
  @override
  Future<void> save(List<WeighIn> items) async {}
}

class _FakePantryStore implements PantryStore {
  _FakePantryStore(this._items);
  final List<PantryItem> _items;
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async {}
}

Outbox _ob() => Outbox(_FakeOutboxStore());

Widget _dashboard(List<PantryItem> pantry, {VoidCallback? onOpenPantry}) {
  return ProviderScope(
    child: MaterialApp(
      theme: lightTheme,
      home: TodayPage(
        repo: ProfileRepo(
          api: _FakeProfileApi(),
          outbox: _ob(),
          store: _FakeProfileStore({'weight_kg': 62.5}),
        ),
        nutritionRepo: NutritionRepo(outbox: _ob(), store: _FakeNutritionStore()),
        goalsRepo: NutritionGoalsRepo(outbox: _ob(), store: _FakeGoalsStore()),
        weighInRepo: WeighInRepo(outbox: _ob(), store: _FakeWeighInStore()),
        pantryRepo: PantryRepo(outbox: _ob(), store: _FakePantryStore(pantry)),
        onOpenPantry: onOpenPantry,
      ),
    ),
  );
}

PantryItem _item(String id, {double? qty, String? unit, DateTime? expiry}) =>
    PantryItem(
      id: id,
      name: id,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      expiry: expiry,
      source: 'manual',
    );

Future<void> _scrollToRestock(WidgetTester tester) async {
  await tester.dragUntilVisible(
    find.byKey(const Key('home-restock-soon')),
    find.byType(Scrollable),
    const Offset(0, -300),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the restock card when an item is expiring soon',
      (tester) async {
    final soon = DateTime.now().add(const Duration(days: 1));
    await tester.pumpWidget(_dashboard([_item('milk', expiry: soon)]));
    await tester.pumpAndSettle();
    await _scrollToRestock(tester);

    expect(find.byKey(const Key('home-restock-soon')), findsOneWidget);
    expect(find.textContaining('restock soon'), findsOneWidget);
    expect(find.text('milk'), findsOneWidget);
  });

  testWidgets('shows the restock card when an item is genuinely low',
      (tester) async {
    await tester.pumpWidget(_dashboard([_item('chicken', qty: 30, unit: 'g')]));
    await tester.pumpAndSettle();
    await _scrollToRestock(tester);

    expect(find.byKey(const Key('home-restock-soon')), findsOneWidget);
    expect(find.text('chicken'), findsOneWidget);
  });

  testWidgets('omits the card when nothing is expiring or low (no urgency)',
      (tester) async {
    await tester.pumpWidget(_dashboard([
      // Fresh + plenty; and a no-data item that must never be flagged.
      _item('oats', qty: 900, unit: 'g', expiry: DateTime.now().add(const Duration(days: 60))),
      _item('mystery', qty: null, unit: null, expiry: null),
    ]));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-restock-soon')), findsNothing);
  });

  testWidgets('omits the card for an empty pantry', (tester) async {
    await tester.pumpWidget(_dashboard(const []));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-restock-soon')), findsNothing);
  });

  testWidgets('tapping the card invokes the open-pantry callback',
      (tester) async {
    var opened = 0;
    final soon = DateTime.now().add(const Duration(days: 1));
    await tester.pumpWidget(_dashboard(
      [_item('milk', expiry: soon)],
      onOpenPantry: () => opened++,
    ));
    await tester.pumpAndSettle();
    await _scrollToRestock(tester);
    await tester.tap(find.byKey(const Key('home-restock-soon')));
    await tester.pumpAndSettle();
    expect(opened, 1);
  });

  testWidgets('a null-qty item is never shown as low (honesty)',
      (tester) async {
    await tester.pumpWidget(_dashboard([_item('unknown', qty: null, unit: 'g')]));
    await tester.pumpAndSettle();
    // No real signal → no card.
    expect(find.byKey(const Key('home-restock-soon')), findsNothing);
  });
}
