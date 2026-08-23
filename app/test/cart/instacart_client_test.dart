// Tests for the Instacart pre-filled cart client + Cart page wiring.
//
// Contracts tested:
//  1. FakeInstacartClient with a Uri result → Instacart button launches THAT
//     Uri (the pre-filled list), not a search URL.
//  2. FakeInstacartClient returning null → falls back to the Instacart search
//     URL (existing behaviour — always works).
//  3. The real item names (ALL items in the list) are sent to the client, not
//     just the first item.
//  4. Empty list → opens Instacart store home (null query path), no client call
//     needed for empty (the page handles the empty case directly to avoid a
//     pointless network round-trip).
//  5. No "order", "checkout", "add to cart", "buy now", "place order" text on
//     the page (honesty regression — must still pass after the upgrade).
//  6. Instacart button label: "Instacart" (not "Opening…") when not loading.
//  7. FakeInstacartClient records the item names it receives (verifies the
//     real list is sent, not a fabricated one).
//  8. instacartClientProvider is overridable via ProviderScope.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart';
import 'package:health_hub/cart/instacart_client.dart';
import 'package:health_hub/cart/link_launcher.dart';
import 'package:health_hub/cart/location_service.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/cart_page.dart';

import '../brain/brain_scope.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/// Records every URI launched. No real browser is opened.
class _FakeLauncher implements LinkLauncher {
  final List<Uri> launched = [];
  @override
  Future<void> launch(Uri uri) async => launched.add(uri);
}

/// Returns a preset LocationResult without touching the platform.
class _FakeLocation implements LocationService {
  const _FakeLocation();
  @override
  Future<LocationResult> getLocation() async =>
      const LocationResult(latitude: 51.5, longitude: -0.1);
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _m = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_m);
  @override
  Future<void> save(List<PendingMutation> m) async => _m = List.of(m);
}

class _FakeGroceryStore implements GroceryListStore {
  List<GroceryItem> _items = [];
  @override
  Future<List<GroceryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<GroceryItem> items) async => _items = List.of(items);
}

/// Build a CartPage with injected fakes.
Future<
    ({
      Widget widget,
      GroceryListRepo repo,
      _FakeLauncher launcher,
      FakeInstacartClient instacart,
    })> _buildCart(
  WidgetTester tester, {
  List<String> seed = const [],
  Uri? instacartResult, // the URL the fake Instacart client returns (null = simulate failure)
}) async {
  final store = _FakeGroceryStore();
  final repo = GroceryListRepo(outbox: Outbox(_FakeOutboxStore()), store: store);
  for (final name in seed) {
    await repo.add(name);
  }
  final launcher = _FakeLauncher();
  final instacart = FakeInstacartClient(result: instacartResult);

  final widget = ProviderScope(
    overrides: brainOverrides(grocery: repo),
    child: MaterialApp(
      theme: lightTheme,
      home: CartPage(
        repo: repo,
        linkLauncher: launcher,
        locationService: const _FakeLocation(),
        instacartClient: instacart,
      ),
    ),
  );

  return (
    widget: widget,
    repo: repo,
    launcher: launcher,
    instacart: instacart,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  // 1. Pre-filled URL returned → button opens THAT URL (not a search URL).
  testWidgets(
    'cart-instacart opens pre-filled list URL when client returns one',
    (tester) async {
      final prefilledUri = Uri.parse(
        'https://www.instacart.com/store/checkout_redirect?affiliate_id=abc',
      );
      final ctx = await _buildCart(
        tester,
        seed: ['Oat Milk', 'Eggs'],
        instacartResult: prefilledUri,
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      expect(ctx.launcher.launched, hasLength(1));
      final launched = ctx.launcher.launched.first;
      // Must be the pre-filled URL, not a search URL.
      expect(launched, equals(prefilledUri));
      expect(
        launched.toString(),
        isNot(contains('/store/s')), // search path
        reason: 'Should open the pre-filled URL, not the search deep-link',
      );
    },
  );

  // 2. Client returns null → falls back to the Instacart search URL.
  testWidgets(
    'cart-instacart falls back to search URL when client returns null',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: ['Oat Milk', 'Bread'],
        instacartResult: null, // simulate failure
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      expect(ctx.launcher.launched, hasLength(1));
      final launched = ctx.launcher.launched.first;
      // Must fall back to the search deep-link.
      expect(launched.host, contains('instacart.com'));
      // Search path includes the first item query.
      expect(
        launched.toString(),
        contains(Uri.encodeQueryComponent('Oat Milk')),
        reason: 'Fallback should search for the first unchecked item',
      );
    },
  );

  // 3. Real item names are sent to the client (not just the first item).
  testWidgets(
    'cart-instacart sends ALL item names to the client',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: ['Oat Milk', 'Eggs', 'Greek Yoghurt'],
        instacartResult: Uri.parse('https://www.instacart.com/store/prefilled'),
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      final names = ctx.instacart.lastItemNames;
      expect(names, isNotNull);
      expect(names, containsAll(['Oat Milk', 'Eggs', 'Greek Yoghurt']));
      expect(names!.length, 3, reason: 'All 3 items must be sent');
    },
  );

  // 4. Empty list → opens Instacart store home; no item names sent.
  testWidgets(
    'cart-instacart with empty list opens Instacart store home',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: [],
        instacartResult: null,
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      expect(ctx.launcher.launched, hasLength(1));
      final launched = ctx.launcher.launched.first;
      // Store home (no query) when list is empty.
      expect(launched.host, contains('instacart.com'));
      // The client should NOT have been called for an empty list.
      expect(ctx.instacart.lastItemNames, isNull,
          reason:
              'No items to send — client should not be called for empty list');
    },
  );

  // 5. No forbidden labels (honesty regression).
  testWidgets(
    'no "order", "checkout", "add to cart", "buy now" text on the cart page',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: ['Milk', 'Bread', 'Eggs'],
        instacartResult: Uri.parse('https://www.instacart.com/store/prefilled'),
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

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
    },
  );

  // 6. Button shows "Instacart" label (not "Opening…") when not loading.
  testWidgets(
    'cart-instacart button shows "Instacart" label when idle',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: ['Milk'],
        instacartResult: Uri.parse('https://www.instacart.com/store/prefilled'),
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      // Scroll to the hand-off section if needed.
      final instacartBtn = find.byKey(const Key('cart-instacart'));
      await tester.ensureVisible(instacartBtn);
      await tester.pumpAndSettle();

      // The button should show its idle label (not the loading state).
      expect(find.text('Instacart'), findsOneWidget);
      expect(find.text('Opening…'), findsNothing);
    },
  );

  // 7. Client records the item names it receives (real list, not fabricated).
  testWidgets(
    'FakeInstacartClient.lastItemNames reflects the real grocery list',
    (tester) async {
      final ctx = await _buildCart(
        tester,
        seed: ['Spinach', 'Tomatoes', 'Onion'],
        instacartResult: Uri.parse('https://www.instacart.com/store/prefilled'),
      );
      await tester.pumpWidget(ctx.widget);
      await tester.pumpAndSettle();

      // Verify nothing recorded before tap.
      expect(ctx.instacart.lastItemNames, isNull);

      await tester.tap(find.byKey(const Key('cart-instacart')));
      await tester.pumpAndSettle();

      // After the tap the fake should have received the real list.
      final names = ctx.instacart.lastItemNames!;
      expect(names, containsAll(['Spinach', 'Tomatoes', 'Onion']));
      // Items are the user's real data — no extras.
      expect(names.length, 3);
    },
  );

  // 8. instacartClientProvider is overridable via ProviderScope.
  test('instacartClientProvider default value is SupabaseInstacartClient', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final client = container.read(instacartClientProvider);
    expect(client, isA<SupabaseInstacartClient>());
  });

  test(
    'instacartClientProvider can be overridden with FakeInstacartClient',
    () {
      final fake = FakeInstacartClient(
        result: Uri.parse('https://www.instacart.com/test'),
      );
      final container = ProviderContainer(
        overrides: [instacartClientProvider.overrideWithValue(fake)],
      );
      addTearDown(container.dispose);
      final client = container.read(instacartClientProvider);
      expect(client, same(fake));
    },
  );

  // 9. FakeInstacartClient returns the canned result.
  test('FakeInstacartClient returns canned Uri on success', () async {
    final uri = Uri.parse('https://www.instacart.com/store/prefilled');
    final fake = FakeInstacartClient(result: uri);
    final result = await fake.shoppingListUrl(['Milk', 'Eggs']);
    expect(result, equals(uri));
    expect(fake.lastItemNames, equals(['Milk', 'Eggs']));
  });

  test('FakeInstacartClient returns null to simulate failure', () async {
    final fake = FakeInstacartClient(); // no result → null
    final result = await fake.shoppingListUrl(['Milk']);
    expect(result, isNull);
    expect(fake.lastItemNames, equals(['Milk']));
  });
}
