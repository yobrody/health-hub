// DeliveryServices — pure, testable delivery service definitions.
//
// No platform dependencies: no url_launcher, no geolocator. Just data.
// CartPage uses these to build its "Grocery Delivery" links; tests can assert
// against the list without any platform channel involvement.
//
// Honesty rule: we NEVER claim to verify that any service delivers to the
// user's address. Labels say "open to check" — the user must confirm inside
// the service's own app or website.

/// A single grocery-delivery service the user can tap to open.
class DeliveryService {
  const DeliveryService({required this.name, required this.buildUri});

  /// Display name shown in the UI.
  final String name;

  /// Builds the URI to open, optionally pre-searching [query].
  /// [query] may be null or empty (open the store's home/category page).
  final Uri Function(String? query) buildUri;
}

/// The canonical list of delivery services the Cart hand-off section offers.
///
/// These are the only services listed in the UI — add new services here,
/// not in the widget. Order determines display order.
final List<DeliveryService> deliveryServices = [
  DeliveryService(
    name: 'Amazon Fresh',
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.amazon.com/s?i=amazonfresh')
          : Uri(
              scheme: 'https',
              host: 'www.amazon.com',
              path: '/s',
              queryParameters: {'k': q, 'i': 'amazonfresh'},
            );
    },
  ),
  DeliveryService(
    name: 'Instacart',
    buildUri: (query) {
      final q = (query ?? '').trim();
      return q.isEmpty
          ? Uri.parse('https://www.instacart.com/store')
          : Uri(
              scheme: 'https',
              host: 'www.instacart.com',
              path: '/store/s',
              queryParameters: {'k': q},
            );
    },
  ),
  DeliveryService(
    name: 'Uber Eats',
    buildUri: (_) => Uri.parse('https://www.ubereats.com/category/grocery'),
  ),
  DeliveryService(
    name: 'DoorDash',
    buildUri: (_) =>
        Uri.parse('https://www.doordash.com/food-delivery/grocery/'),
  ),
];
