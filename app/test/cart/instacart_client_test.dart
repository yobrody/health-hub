// Tests for the Instacart pre-filled cart client (the pure seam only).
//
// The Instacart edge-function flow was UNWIRED from CartPage when the hand-off
// pivoted to UK grocers (Instacart is US/Canada-only). The [InstacartClient]
// seam is RETAINED in the repo for a possible future US launch, so these tests
// keep it covered — but the CartPage-wiring widget tests were removed with the
// wiring itself (see cart_handoff_test.dart for the current UK-grocer contract).
//
// Contracts tested:
//  • instacartClientProvider default value is SupabaseInstacartClient.
//  • instacartClientProvider is overridable via ProviderScope.
//  • FakeInstacartClient returns its canned Uri / null and records item names.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/instacart_client.dart';

void main() {
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
