import 'package:connectivity_plus/connectivity_plus.dart';

/// A narrow, testable view of device connectivity.
///
/// [connectivity_plus] uses a platform channel and cannot run under
/// `flutter test`, so [SyncService] depends on this interface and tests inject
/// a fake. The stream emits `true` when the device (re)gains any real network
/// interface and `false` when it drops to none.
abstract class ConnectivityMonitor {
  /// Emits `true` when connectivity is present, `false` when it is lost.
  Stream<bool> get onOnline;
}

/// Production [ConnectivityMonitor] backed by [Connectivity].
///
/// A result list is considered "online" when it contains any interface other
/// than [ConnectivityResult.none]. Not unit-tested (platform channel); the
/// interface above is what makes [SyncService] testable.
class ConnectivityPlusMonitor implements ConnectivityMonitor {
  ConnectivityPlusMonitor([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  static bool _isOnline(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  @override
  Stream<bool> get onOnline =>
      _connectivity.onConnectivityChanged.map(_isOnline);
}
