// Widget + unit tests for the UK grocer Cart hand-off section.
//
// Contracts tested:
//  1. deliveryServices == exactly [Tesco, Sainsbury's, Amazon Fresh UK, Ocado].
//  2. Each grocer's buildUri('Oat Milk') → expected host + encoded query.
//  3. cart-grocer-tesco (seeded) → launcher opens tesco.com pre-searching the
//     first unchecked item AND a "List copied — paste each item to add" SnackBar.
//  4. cart-share-sheet enabled/disabled by list emptiness.
//  5. cart-delivery-near-me (granted / denied) → the four UK grocers shown.
//  6. No "order", "checkout", "add to cart", "buy now", "place order" text.
//  7. Empty list → tapping a grocer opens the store home (no query).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
/// shared provider (empty pantry here → no restock cards).
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
  // 1. The pure list is exactly the four UK grocers, in order.
  test('deliveryServices is exactly the four UK grocers in order', () {
    final names = deliveryServices.map((s) => s.name).toList();
    expect(names, ['Tesco', "Sainsbury's", 'Amazon Fresh UK', 'Ocado']);
  });

  // 2. Per-grocer URI builders (unit).
  test('Tesco buildUri encodes the query in the `query` param', () {
    final s = deliveryServices.firstWhere((s) => s.name == 'Tesco');
    final uri = s.buildUri('Oat Milk');
    expect(uri.host, 'www.tesco.com');
    // Lock the canonical Tesco Groceries search path so a stray change is
    // caught rather than silently 404-ing on device.
    expect(uri.path, '/groceries/en-GB/search');
    expect(uri.queryParameters['query'], 'Oat Milk');
  });

  test("Sainsbury's buildUri puts the encoded query in the path", () {
    final s = deliveryServices.firstWhere((s) => s.name == "Sainsbury's");
    final uri = s.buildUri('Oat Milk');
    expect(uri.host, 'www.sainsburys.co.uk');
    // The path segment carries the URL-encoded item name.
    expect(uri.path, contains(Uri.encodeComponent('Oat Milk')));
    // And it decodes back to the original.
    expect(uri.pathSegments.last, 'Oat Milk');
  });

  test('Amazon Fresh UK buildUri uses amazon.co.uk + amazonfresh + `k`', () {
    final s = deliveryServices.firstWhere((s) => s.name == 'Amazon Fresh UK');
    final uri = s.buildUri('Oat Milk');
    expect(uri.host, 'www.amazon.co.uk');
    expect(uri.queryParameters['k'], 'Oat Milk');
    expect(uri.toString(), contains('amazonfresh'));
  });

  test('Ocado buildUri uses ocado.com + `entry` param', () {
    final s = deliveryServices.firstWhere((s) => s.name == 'Ocado');
    final uri = s.buildUri('Oat Milk');
    expect(uri.host, 'www.ocado.com');
    expect(uri.queryParameters['entry'], 'Oat Milk');
  });

  // Empty query → each grocer opens its store home (no search).
  test('empty query opens each grocer home page', () {
    for (final s in deliveryServices) {
      final uri = s.buildUri(null);
      // Home pages carry no search term.
      expect(uri.queryParameters['query'], isNull);
      expect(uri.queryParameters['k'], isNull);
      expect(uri.queryParameters['entry'], isNull);
    }
  });

  // 3. Tapping a grocer copies the list, launches a pre-search, shows SnackBar.
  testWidgets(
      'cart-grocer-tesco copies the list, opens Tesco pre-searched, snackbars',
      (tester) async {
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

    final ctx = await _buildCart(tester, seed: ['Oat Milk', 'Bread']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-grocer-tesco')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-grocer-tesco')));
    await tester.pumpAndSettle();

    // Launched exactly once, to Tesco pre-searching the first unchecked item.
    expect(ctx.launcher.launched, hasLength(1));
    final uri = ctx.launcher.launched.first;
    expect(uri.host, 'www.tesco.com');
    expect(uri.queryParameters['query'], 'Oat Milk');

    // The full list landed on the clipboard (both items, real names).
    expect(copied, contains('Oat Milk'));
    expect(copied, contains('Bread'));

    // And the honest SnackBar told the user to paste.
    expect(
      find.text('List copied — paste each item to add'),
      findsOneWidget,
    );

    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  // 4. Share button enabled/disabled by list emptiness.
  testWidgets('cart-share-sheet is enabled when list has items', (tester) async {
    final ctx = await _buildCart(tester, seed: ['Milk']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    final shareBtn = find.byKey(const Key('cart-share-sheet'));
    expect(shareBtn, findsOneWidget);
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

  // 5. Delivery near me with granted location → the four UK grocers shown.
  testWidgets(
      'cart-delivery-near-me with location granted shows UK grocers',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      locationResult: const LocationResult(latitude: 51.5, longitude: -0.1),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    // The four UK grocer names appear (as button labels and/or tile titles).
    expect(find.text('Tesco'), findsAtLeastNWidgets(1));
    expect(find.text("Sainsbury's"), findsAtLeastNWidgets(1));
    expect(find.text('Amazon Fresh UK'), findsAtLeastNWidgets(1));
    expect(find.text('Ocado'), findsAtLeastNWidgets(1));

    // Honest note absent when location was granted.
    expect(find.byKey(const Key('cart-delivery-denied-note')), findsNothing);
  });

  // 6. Delivery near me with permission denied → grocers + honest note.
  testWidgets(
      'cart-delivery-near-me with permission denied shows grocers + note',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      locationResult:
          const LocationResult(errorMessage: 'Location permission denied'),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    expect(find.text('Tesco'), findsAtLeastNWidgets(1));
    expect(find.text('Ocado'), findsAtLeastNWidgets(1));

    expect(find.byKey(const Key('cart-delivery-denied-note')), findsOneWidget);
    expect(find.textContaining('open each to check'), findsOneWidget);
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

    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
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
  });

  // 8. Delivery service tiles launch correct URIs via the fake launcher.
  testWidgets('tapping a delivery service tile opens that grocer',
      (tester) async {
    final ctx = await _buildCart(
      tester,
      seed: ['Butter'],
      locationResult: const LocationResult(latitude: 51.5, longitude: -0.1),
    );
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-near-me')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-delivery-ocado')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-delivery-ocado')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    expect(ctx.launcher.launched.first.host, 'www.ocado.com');
  });

  // 9. Empty list → tapping a grocer opens the store home (no query).
  testWidgets('cart-grocer-tesco with empty list opens the store home',
      (tester) async {
    final ctx = await _buildCart(tester);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('cart-grocer-tesco')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cart-grocer-tesco')));
    await tester.pumpAndSettle();

    expect(ctx.launcher.launched, hasLength(1));
    final uri = ctx.launcher.launched.first;
    expect(uri.host, 'www.tesco.com');
    // Store home — no search query.
    expect(uri.queryParameters['query'], isNull);
  });

  // 10. Grocer key naming: apostrophe stripped, spaces dashed.
  testWidgets('all four grocer buttons render with their stable keys',
      (tester) async {
    final ctx = await _buildCart(tester, seed: ['Milk']);
    await tester.pumpWidget(ctx.widget);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('cart-grocer-tesco')), findsOneWidget);
    expect(find.byKey(const Key('cart-grocer-sainsburys')), findsOneWidget);
    expect(find.byKey(const Key('cart-grocer-amazon-fresh-uk')), findsOneWidget);
    expect(find.byKey(const Key('cart-grocer-ocado')), findsOneWidget);
  });
}
