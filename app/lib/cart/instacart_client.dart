// InstacartClient — seam for generating Instacart pre-filled shopping list URLs.
//
// Two implementations:
//  • [SupabaseInstacartClient] — the real one: calls the `instacart-cart`
//    Supabase edge function, which in turn calls the Instacart Developer
//    Platform "Create shopping list page" endpoint. Returns the pre-filled URI
//    on success, or null on any error (the caller falls back to search).
//  • [FakeInstacartClient] — for tests: returns a canned URI or null. No
//    network touched.
//
// Honesty rules:
//  • This client NEVER claims an order was placed or is in progress — it only
//    opens a pre-filled Instacart page; the user checks out there.
//  • On ANY error (network, bad JSON, missing key, upstream 5xx) the client
//    returns null and NEVER throws. The caller falls back to the existing
//    Instacart search deep-link so the button always does something useful.
//  • The list sent is the user's REAL grocery list — names verbatim, nothing
//    fabricated or padded.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config.dart';

/// Fetches a pre-filled Instacart shopping list URL for the given [itemNames].
///
/// Returns a [Uri] pointing to the Instacart page with [itemNames] pre-loaded,
/// or `null` on any failure (network error, missing key, bad response).
/// The caller is responsible for falling back to search when null is returned.
abstract class InstacartClient {
  Future<Uri?> shoppingListUrl(List<String> itemNames);
}

/// Production [InstacartClient]: calls the `instacart-cart` Supabase edge
/// function. Requires a live Supabase session (the function is JWT-verified).
///
/// Returns `null` on ANY error, never throws.
class SupabaseInstacartClient implements InstacartClient {
  const SupabaseInstacartClient();

  @override
  Future<Uri?> shoppingListUrl(List<String> itemNames) async {
    if (itemNames.isEmpty) return null;
    if (!Config.supabaseConfigured) return null;

    try {
      final response = await Supabase.instance.client.functions.invoke(
        'instacart-cart',
        body: {'items': itemNames},
      );

      // functions.invoke throws FunctionException on non-2xx; catching below.
      final data = response.data;
      if (data is! Map) return null;

      final raw = data['products_link_url'];
      if (raw is! String || raw.isEmpty) return null;

      final uri = Uri.tryParse(raw);
      if (uri == null || !uri.hasScheme) return null;

      return uri;
    } catch (_) {
      // Any error (FunctionException, network, JSON parse) → honest null.
      // The call site falls back to the search deep-link.
      return null;
    }
  }
}

/// Test-only [InstacartClient].
///
/// Pass a [Uri] to simulate a successful pre-filled list response, or null to
/// simulate any failure and exercise the fallback-to-search path.
class FakeInstacartClient implements InstacartClient {
  FakeInstacartClient({this.result});

  /// The canned URL this fake returns, or null to simulate failure.
  final Uri? result;

  /// The item names received by the last [shoppingListUrl] call.
  List<String>? lastItemNames;

  @override
  Future<Uri?> shoppingListUrl(List<String> itemNames) async {
    lastItemNames = List.unmodifiable(itemNames);
    return result;
  }
}

/// Riverpod provider for [InstacartClient].
///
/// Defaults to [SupabaseInstacartClient] in the running app. Override with a
/// [FakeInstacartClient] in widget tests:
///
/// ```dart
/// ProviderScope(
///   overrides: [
///     instacartClientProvider.overrideWithValue(FakeInstacartClient(result: ...)),
///   ],
///   ...
/// )
/// ```
final instacartClientProvider = Provider<InstacartClient>((ref) {
  return const SupabaseInstacartClient();
});
