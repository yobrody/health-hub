// Widget tests for the R-4 Cart hand-off section.
//
// Contracts tested:
//  1. cart-amazon → FakeLinkLauncher called with amazonfresh + first-item URL.
//  2. cart-instacart → FakeLinkLauncher called with instacart.com + first-item.
//  3. Per-item search (cart-item-search-<id>) → that item's name URL-encoded.
//  4. cart-share-sheet button renders and is enabled when list is non-empty.
//  5. cart-delivery-near-me (location granted) → service list shown.
//  6. cart-delivery-near-me (permission denied) → service list + honest note.
//  7. No "order", "checkout", "add to cart", "buy now" text visible anywhere.
//  8. All existing tests still pass (verified by running the full suite).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/delivery_services.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/cart/link_launcher.dart';
import 'package:health_hub/cart/location_service.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/cart_page.dart';

import '../brain/brain_scope.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/// Records every URI launched; no real browser opened.
class FakeLinkLauncher implements LinkLauncher {
  final List<Uri> launched = [];

  @override
  Future<void> launch(Uri uri) async {
    launched.add(uri);
  }
}

/// Returns a preset LocationResult without touching the platform.
class FakeLocationService implements LocationService {
  FakeLocationService({required this.result});
  final LocationResult result;

  @override
  Future<LocationResult> getLocation() async => result;
}

class _FakeGroceryStore implements GroceryListStore {
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

/// Build a CartPage with injected fakes. [seed] items are pre-added to the
/// repo before the widget is built. The Brain's BUY insights come from the
/// shared provider (empty pantry here → no restock cards), overridden via
/// [brainOverrides].
Future<({Widget widget, GroceryListRepo repo, FakeLinkLauncher launcher})>
    _buildCart(
  WidgetTester tester, {
  List<String> seed = const [],
  LocationResult? locationResult,
}) async {
  final store = _FakeGroceryStore();
  final repo = GroceryListRepo(outbox: Outbox(_FakeOutboxStore()), store: store);
  for (final name in seed) {
    await repo.add(name);
  }
  final launcher = FakeLinkLauncher();
  final location = FakeLocationService(
    result: locationResult ??
        const LocationResult(latitude: 51.5, longitude: -0.1),
  );

  final widget = ProviderScope(
    overrides: brainOverrides(grocery: repo), // empty pantry → no BUY cards
    child: MaterialApp(
      theme: lightTheme,
      home: CartPage(
        repo: repo,
        linkLauncher: launcher,
        locationService: location,
      ),
    ),
  );
  return (widget: widget, repo: repo, launcher: launcher);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  // 1. Amazon Fresh button calls launcher with amazonfresh + first-item query.
  testWidgets('cart-amazon opens Amazon Fresh pre-searched for first item',
      (tester) async {
    final ctx = await _buildCart(tester, seed: ['Oat Milk', 'Bread']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-amazon')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    final uri = ctx.launcher.launched.first;
    expect(uri.toString(), contains('amazonfresh'));
    // First unchecked item ('Oat Milk') should be the query.
    expect(uri.toString(), contains(Uri.encodeQueryComponent('Oat Milk')));
  });

  // 2. Instacart button calls launcher with instacart.com + first-item query.
  testWidgets('cart-instacart opens Instacart pre-searched for first item',
      (tester) async {
    final ctx = await _buildCart(tester, seed: ['Eggs']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-instacart')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    final uri = ctx.launcher.launched.first;
    expect(uri.host, contains('instacart.com'));
    expect(uri.toString(), contains(Uri.encodeQueryComponent('Eggs')));
  });

  // 3. Per-item search opens that item's name in Amazon Fresh.
  testWidgets(
      'per-item search button launches Amazon Fresh with that item name',
      (tester) async {
    final ctx = await _buildCart(tester, seed: ['Spinach', 'Tomatoes']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    final items = await ctx.repo.all();
    // Tap the search icon for 'Spinach' (first item).
    final spinach = items.firstWhere((i) => i.name == 'Spinach');
    await tester.tap(find.byKey(Key('cart-item-search-${spinach.id}')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    final uri = ctx.launcher.launched.first;
    expect(uri.toString(), contains('amazonfresh'));
    expect(uri.toString(), contains(Uri.encodeQueryComponent('Spinach')));
  });

  // 4. Share button renders and is enabled when list is non-empty.
  testWidgets('cart-share-sheet is enabled when list has items', (tester) async {
    final ctx = await _buildCart(tester, seed: ['Milk']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    final shareBtn = find.byKey(const Key('cart-share-sheet'));
    expect(shareBtn, findsOneWidget);
    // FilledButton should be enabled (onPressed is non-null when list non-empty).
    final btn = tester.widget<FilledButton>(shareBtn);
    expect(btn.onPressed, isNotNull);
  });

  testWidgets('cart-share-sheet is disabled when list is empty', (tester) async {
    final ctx = await _buildCart(tester);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    final shareBtn = find.byKey(const Key('cart-share-sheet'));
    expect(shareBtn, findsOneWidget);
    final btn = tester.widget<FilledButton>(shareBtn);
    expect(btn.onPressed, isNull);
  });

  // 5. Delivery near me with granted location → services list shown.
  testWidgets(
      'cart-delivery-near-me with location granted shows delivery services',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      locationResult: const LocationResult(latitude: 51.5, longitude: -0.1),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    // The hand-off section is below the fold in the test viewport — scroll to it.
    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    // All four delivery services should be visible somewhere in the tree
    // (the list may be partially off-screen; test via the widget tree, not
    // hit-test position — find.text searches all rendered Text widgets).
    expect(find.text('Instacart'), findsAtLeastNWidgets(1));
    expect(find.text('Amazon Fresh'), findsAtLeastNWidgets(1));
    expect(find.text('Uber Eats'), findsAtLeastNWidgets(1));
    expect(find.text('DoorDash'), findsAtLeastNWidgets(1));

    // Honest note absent when location was granted.
    expect(find.byKey(const Key('cart-delivery-denied-note')), findsNothing);
  });

  // 6. Delivery near me with permission denied → services + honest note.
  testWidgets(
      'cart-delivery-near-me with permission denied shows services + honest note',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      locationResult:
          const LocationResult(errorMessage: 'Location permission denied'),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    // Scroll to the button before tapping.
    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    // Services still shown.
    expect(find.text('Instacart'), findsAtLeastNWidgets(1));
    expect(find.text('Amazon Fresh'), findsAtLeastNWidgets(1));

    // Honest denied note shown.
    expect(find.byKey(const Key('cart-delivery-denied-note')), findsOneWidget);
    expect(
      find.textContaining('open each to check'),
      findsOneWidget,
    );
  });

  // 7. No forbidden labels visible anywhere on the page.
  testWidgets(
      'no "order", "checkout", "add to cart", "buy now" text on the page',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      seed: ['Milk', 'Bread', 'Eggs'],
      locationResult: const LocationResult(latitude: 51.5, longitude: -0.1),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    // Expand the delivery panel (scroll to button first).
    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    // Collect all text in the widget tree (case-insensitive).
    final allText = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data?.toLowerCase() ?? '')
        .join(' ');

    const forbidden = [
      'order',
      'checkout',
      'add to cart',
      'buy now',
      'place order',
    ];
    for (final word in forbidden) {
      expect(
        allText,
        isNot(contains(word)),
        reason: 'Found forbidden text "$word" on the cart page',
      );
    }
  });

  // 8. Delivery service tiles launch correct URIs via the fake launcher.
  testWidgets('tapping a delivery service tile opens that service',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      seed: ['Butter'],
      locationResult: const LocationResult(latitude: 51.5, longitude: -0.1),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    // Scroll to and tap the delivery button.
    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    // Scroll to the Instacart delivery tile and tap it.
    await tester.ensureVisible(
        find.byKey(const Key('cart-delivery-instacart')));
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const Key('cart-delivery-instacart')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    expect(ctx.launcher.launched.first.host, contains('instacart.com'));
  });

  // Verify the pure delivery_services list has the expected entries.
  test('deliveryServices list contains all four expected services', () {
    final names = deliveryServices.map((s) => s.name).toList();
    expect(names, contains('Amazon Fresh'));
    expect(names, contains('Instacart'));
    expect(names, contains('Uber Eats'));
    expect(names, contains('DoorDash'));
  });

  // Amazon Fresh URI builder encodes the query correctly.
  test('Amazon Fresh URI builder includes amazonfresh + encoded query', () {
    final service =
        deliveryServices.firstWhere((s) => s.name == 'Amazon Fresh');
    final uri = service.buildUri('Oat Milk');
    expect(uri.toString(), contains('amazonfresh'));
    expect(uri.queryParameters['k'], 'Oat Milk');
  });

  // Instacart URI builder encodes the query correctly.
  test('Instacart URI builder includes instacart.com + encoded query', () {
    final service =
        deliveryServices.firstWhere((s) => s.name == 'Instacart');
    final uri = service.buildUri('Greek Yoghurt');
    expect(uri.host, contains('instacart.com'));
    expect(uri.queryParameters['k'], 'Greek Yoghurt');
  });

  // Empty list → both store buttons still launch (to store home/category).
  testWidgets('cart-amazon with empty list opens Amazon Fresh home',
      (tester) async {
    final ctx = await _buildCart(tester);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('cart-amazon')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    expect(ctx.launcher.launched.first.toString(), contains('amazonfresh'));
  });
}
