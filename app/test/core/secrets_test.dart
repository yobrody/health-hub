import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/core/secrets.dart';
import 'package:health_hub/core/secure_store.dart';

/// Simple in-memory fake for [SecureStore] — no platform channels.
class FakeSecureStore implements SecureStore {
  final Map<String, String> _data = {};

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> delete(String key) async {
    _data.remove(key);
  }
}

void main() {
  group('Secrets', () {
    late FakeSecureStore store;
    late Secrets secrets;

    setUp(() {
      store = FakeSecureStore();
      secrets = Secrets(store);
    });

    test('exposes the X-Health-Key header name', () {
      expect(Secrets.healthKeyHeader, 'X-Health-Key');
    });

    test('round-trips a health key', () async {
      await secrets.setHealthKey('abc123');
      expect(await secrets.getHealthKey(), 'abc123');
    });

    test('returns null when nothing stored', () async {
      expect(await secrets.getHealthKey(), isNull);
    });

    test('clearHealthKey removes the stored key', () async {
      await secrets.setHealthKey('abc123');
      await secrets.clearHealthKey();
      expect(await secrets.getHealthKey(), isNull);
    });
  });
}
