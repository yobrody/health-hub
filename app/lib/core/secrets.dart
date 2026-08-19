import 'secure_store.dart';

/// Manages the app's secrets, currently the backend `X-Health-Key`.
///
/// The key is a secret and lives only in the device's secure storage — never
/// in code or config. Takes a [SecureStore] so consumers/tests can inject a
/// fake.
class Secrets {
  Secrets(this._store);

  final SecureStore _store;

  /// Request header the backend authenticates with.
  static const String healthKeyHeader = 'X-Health-Key';

  /// Private storage key under which the health key is persisted.
  static const String _healthKeyStorageKey = 'health_key';

  Future<void> setHealthKey(String key) =>
      _store.write(_healthKeyStorageKey, key);

  Future<String?> getHealthKey() => _store.read(_healthKeyStorageKey);

  Future<void> clearHealthKey() => _store.delete(_healthKeyStorageKey);
}
