/// Thin wrapper around `geolocator` for coarse location / region look-ups.
///
/// This class is NOT unit-tested — it calls into the `geolocator` plugin
/// which requires a real device (GPS / network location + platform channel).
/// Keep it minimal: return a plain [Coordinates] value object (or `null`) so
/// callers never import `geolocator` directly.
///
/// Used later for gym / reorder-proximity features.  This file establishes the
/// thin foundation; the real feature logic lives in its own layer above this.
library;

import 'package:geolocator/geolocator.dart';

import 'permissions.dart';

/// A bare latitude / longitude pair — the only data LocationService exposes.
class Coordinates {
  const Coordinates({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  @override
  String toString() => 'Coordinates($latitude, $longitude)';
}

/// Wraps [Geolocator] to obtain the device's current coarse location.
///
/// Returns `null` (never throws) when the permission is denied / permanently
/// denied, when location services are disabled, or on any plugin error.
/// The caller is responsible for deciding what to show the user (e.g. prompt
/// to enable location, or degrade gracefully with no location).
class LocationService {
  const LocationService();

  /// Attempt to get the current location, returning `null` on any failure.
  ///
  /// Uses [LocationAccuracy.low] (coarse) — good enough for gym / region
  /// features and kinder to battery life.  A [timeLimit] of 10 s avoids
  /// blocking the UI on slow GPS fixes.
  Future<Coordinates?> currentLocation({
    Duration timeLimit = const Duration(seconds: 10),
  }) async {
    try {
      // Check that the location service is enabled at all.
      if (!await Geolocator.isLocationServiceEnabled()) return null;

      // Check / request the permission.
      var status = await Geolocator.checkPermission();
      if (status == LocationPermission.denied) {
        status = await Geolocator.requestPermission();
      }

      // Map to our PermState to drive the degraded-path decision.
      final permState = _toPermState(status);
      if (permState != PermState.granted) return null;

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: LocationAccuracy.low,
          timeLimit: timeLimit,
        ),
      );
      return Coordinates(latitude: pos.latitude, longitude: pos.longitude);
    } catch (_) {
      // TimeoutException, PermissionDefinitionsNotFoundException, or any
      // other plugin-level error → degrade honestly.
      return null;
    }
  }

  /// Map a [LocationPermission] value to the app's [PermState] abstraction
  /// so [LocationService] is consistent with [PermissionCoordinator].
  static PermState _toPermState(LocationPermission p) {
    return switch (p) {
      LocationPermission.always ||
      LocationPermission.whileInUse =>
        PermState.granted,
      LocationPermission.denied => PermState.denied,
      LocationPermission.deniedForever => PermState.permanentlyDenied,
      LocationPermission.unableToDetermine => PermState.denied,
    };
  }
}
