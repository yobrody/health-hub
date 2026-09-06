// DeliveryServices — pure, testable delivery service definitions (UK grocers).
//
// No platform dependencies: no url_launcher, no geolocator. Just data.
// CartPage uses these to build its grocery hand-off links; tests can assert
// against the list without any platform channel involvement.
//
// These are UK grocers (the app's user is in London). Instacart/DoorDash/etc.
// were removed — Instacart is US/Canada-only and a confirmed dead end for a UK
// founder, and DoorDash grocery isn't available in the UK.
//
// Honesty rule: we NEVER claim to verify that any grocer delivers to the user's
// address. The user confirms delivery inside the grocer's own site/app. We only
// open a pre-searched page (or the store home) — nothing is ordered here.

/// A single grocery-delivery service the user can tap to open.
class DeliveryService {
  const DeliveryService({required this.name, required this.buildUri});

  /// Display name shown in the UI.
  final String name;

  /// Builds the URI to open, optionally pre-searching [query].
  /// [query] may be null or empty (open the store's groceries home page).
  final Uri Function(String? query) buildUri;
}

/// The canonical list of UK grocers the Cart hand-off offers, in display order.
///
/// These are the only grocers listed in the UI — add new ones here, not in the
/// widget. Order determines display order.
final List<DeliveryService> deliveryServices = [
  DeliveryService(
    name: 'Tesco',
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.tesco.com/groceries/')
          : Uri(
              scheme: 'https',
              host: 'www.tesco.com',
              path: '/shop/en-GB/search',
              queryParameters: {'query': q, 'inputType': 'free text'},
            );
    },
  ),
  DeliveryService(
    name: "Sainsbury's",
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.sainsburys.co.uk/gol-ui/groceries')
          : Uri.parse(
              'https://www.sainsburys.co.uk/gol-ui/SearchResults/'
              '${Uri.encodeComponent(q)}',
            );
    },
  ),
  DeliveryService(
    name: 'Amazon Fresh UK',
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.amazon.co.uk/s?i=amazonfresh')
          : Uri(
              scheme: 'https',
              host: 'www.amazon.co.uk',
              path: '/s',
              queryParameters: {'k': q, 'i': 'amazonfresh'},
            );
    },
  ),
  DeliveryService(
    name: 'Ocado',
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.ocado.com/browse')
          : Uri(
              scheme: 'https',
              host: 'www.ocado.com',
              path: '/search',
              queryParameters: {'entry': q},
            );
    },
  ),
];
