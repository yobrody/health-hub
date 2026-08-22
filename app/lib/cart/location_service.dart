// LocationService — seam interface for requesting device location.
//
// Keeps CartPage unit-testable: tests inject FakeLocationService with a preset
// result; the running app uses RealLocationService (geolocator).
//
// Honesty contract: the location is used ONLY to surface a list of delivery
// services to the user — we never claim to verify which services actually
// deliver to their address. Permission-denied → same honest list + a note.

import 'package:geolocator/geolocator.dart';

/// The result of a location request — either a position or an honest error.
class LocationResult {
  const LocationResult({this.latitude, this.longitude, this.errorMessage});

  /// Non-null on success.
  final double? latitude;
  final double? longitude;

  /// Human-readable error/denial reason. Null means success.
  final String? errorMessage;

  bool get isSuccess => errorMessage == null;
}

/// Abstract seam for acquiring device location.
abstract class LocationService {
  Future<LocationResult> getLocation();
}

/// Production implementation backed by [geolocator].
class RealLocationService implements LocationService {
  const RealLocationService();

  @override
  Future<LocationResult> getLocation() async {
    // Check / request permission first.
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return const LocationResult(
        errorMessage: 'Location permission denied',
      );
    }

    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.low, // coarse is sufficient
        ),
      );
      return LocationResult(latitude: pos.latitude, longitude: pos.longitude);
    } catch (e) {
      return LocationResult(errorMessage: e.toString());
    }
  }
}
