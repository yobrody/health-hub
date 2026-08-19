import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/client.dart';
import 'package:health_hub/api/models.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/core/secrets.dart';
import 'package:health_hub/core/secure_store.dart';
import 'package:mocktail/mocktail.dart';

// ---------------------------------------------------------------------------
// Fakes / mocks
// ---------------------------------------------------------------------------

class MockDio extends Mock implements Dio {}

class MockInterceptors extends Mock implements Interceptors {}

/// Fake [Interceptor] used as a fallback value for mocktail's `any()`.
class FakeInterceptor extends Fake implements Interceptor {}

/// Simple in-memory SecureStore (no platform channels).
class FakeSecureStore implements SecureStore {
  final Map<String, String> _data = {};

  @override
  Future<void> write(String key, String value) async => _data[key] = value;

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> delete(String key) async => _data.remove(key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a minimal [Response] for mocktail stubs.
Response<Map<String, dynamic>> _jsonResponse(
  Map<String, dynamic> data, {
  int statusCode = 200,
}) {
  return Response(
    data: data,
    statusCode: statusCode,
    requestOptions: RequestOptions(path: '/today'),
  );
}

/// Build a [DioException] with the given status code.
DioException _dioError(int? statusCode, DioExceptionType type) {
  final resp = statusCode == null
      ? null
      : Response(
          data: null,
          statusCode: statusCode,
          requestOptions: RequestOptions(path: '/today'),
        );
  return DioException(
    requestOptions: RequestOptions(path: '/today'),
    response: resp,
    type: type,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
    registerFallbackValue(FakeInterceptor());
  });

  // ── Test 1: Today.fromJson leaves missing numerics as null (never 0) ──────
  group('Today.fromJson', () {
    test('leaves absent numeric fields as null', () {
      final today = Today.fromJson(const {});
      expect(today.totalKcal, isNull);
      expect(today.proteinG, isNull);
      expect(today.weightKg, isNull);
    });

    test('leaves explicit JSON null as null', () {
      final today =
          Today.fromJson(const {'total_kcal': null, 'protein_g': null, 'weight_kg': null});
      expect(today.totalKcal, isNull);
      expect(today.proteinG, isNull);
      expect(today.weightKg, isNull);
    });

    test('parses present numeric values correctly', () {
      final today = Today.fromJson(const {
        'total_kcal': 1800,
        'protein_g': 142.5,
        'weight_kg': 62.0,
      });
      expect(today.totalKcal, 1800);
      expect(today.proteinG, 142.5);
      expect(today.weightKg, 62.0);
    });
  });

  // ── Test 2: On 5xx DioException → degraded, data == null ─────────────────
  group('ApiClient.getToday', () {
    late MockDio mockDio;
    late MockInterceptors mockInterceptors;
    late FakeSecureStore store;
    late Secrets secrets;
    late ApiClient client;

    setUp(() {
      mockDio = MockDio();
      mockInterceptors = MockInterceptors();
      store = FakeSecureStore();
      secrets = Secrets(store);

      // Dio.interceptors is accessed in the constructor — stub it.
      when(() => mockDio.interceptors).thenReturn(mockInterceptors);
      when(() => mockInterceptors.add(any())).thenReturn(null);

      client = ApiClient(mockDio, secrets);
    });

    test('returns degraded + null data on 5xx response', () async {
      when(() => mockDio.get<Map<String, dynamic>>(any()))
          .thenThrow(_dioError(500, DioExceptionType.badResponse));

      final result = await client.getToday();

      expect(result.status, ProbeStatus.degraded);
      expect(result.data, isNull);
    });

    test('returns degraded + null data on 503 response', () async {
      when(() => mockDio.get<Map<String, dynamic>>(any()))
          .thenThrow(_dioError(503, DioExceptionType.badResponse));

      final result = await client.getToday();

      expect(result.status, ProbeStatus.degraded);
      expect(result.data, isNull);
    });

    test('returns offline + null data on connection error', () async {
      when(() => mockDio.get<Map<String, dynamic>>(any()))
          .thenThrow(_dioError(null, DioExceptionType.connectionError));

      final result = await client.getToday();

      expect(result.status, ProbeStatus.offline);
      expect(result.data, isNull);
    });

    test('returns online + Today data on success', () async {
      when(() => mockDio.get<Map<String, dynamic>>(any())).thenAnswer(
        (_) async => _jsonResponse({
          'total_kcal': 1800,
          'protein_g': 142.5,
          'weight_kg': 62.0,
        }),
      );

      final result = await client.getToday();

      expect(result.status, ProbeStatus.online);
      expect(result.data, isNotNull);
      expect(result.data!.totalKcal, 1800);
    });

    // ── Test 3: X-Health-Key header is attached when key is stored ────────
    test('adds X-Health-Key interceptor during construction', () {
      // The constructor calls interceptors.add() with an InterceptorsWrapper.
      // Verify the interceptors object was touched (header wired up).
      verify(() => mockInterceptors.add(any())).called(1);
    });
  });

  // ── Test 3 (deeper): interceptor actually injects the key ────────────────
  group('ApiClient auth interceptor (integration)', () {
    test('injects X-Health-Key when key is in store', () async {
      final capturedHeaders = <String, dynamic>{};

      // Use a real Dio with a custom adapter so we can inspect the request.
      final dio = Dio(BaseOptions(baseUrl: 'https://example.com'));

      final store = FakeSecureStore();
      final secrets = Secrets(store);
      await secrets.setHealthKey('test-key-123');

      // Wire up the ApiClient (which adds the auth interceptor).
      final client = ApiClient(dio, secrets); // ignore: unused_local_variable

      // Add a second interceptor AFTER the auth one to capture headers.
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            capturedHeaders.addAll(options.headers);
            // Short-circuit — no real HTTP needed.
            handler.resolve(
              Response(
                data: <String, dynamic>{},
                statusCode: 200,
                requestOptions: options,
              ),
            );
          },
        ),
      );

      await client.getToday();

      expect(capturedHeaders[Secrets.healthKeyHeader], 'test-key-123');
    });

    test('does not add X-Health-Key when no key stored', () async {
      final capturedHeaders = <String, dynamic>{};

      final dio = Dio(BaseOptions(baseUrl: 'https://example.com'));
      final store = FakeSecureStore(); // empty
      final secrets = Secrets(store);

      final client = ApiClient(dio, secrets); // ignore: unused_local_variable

      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            capturedHeaders.addAll(options.headers);
            handler.resolve(
              Response(
                data: <String, dynamic>{},
                statusCode: 200,
                requestOptions: options,
              ),
            );
          },
        ),
      );

      await client.getToday();

      expect(capturedHeaders.containsKey(Secrets.healthKeyHeader), isFalse);
    });
  });
}
