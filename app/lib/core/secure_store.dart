import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// A minimal secure key/value store abstraction.
///
/// [flutter_secure_storage] uses platform channels and cannot run under
/// `flutter test`, so consumers depend on this interface and tests supply an
/// in-memory fake.
abstract class SecureStore {
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
}

/// Real [SecureStore] backed by [FlutterSecureStorage].
///
/// Not unit-tested (platform channels); the interface above is what makes
/// consumers testable.
class FlutterSecureStoreAdapter implements SecureStore {
  FlutterSecureStoreAdapter([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
