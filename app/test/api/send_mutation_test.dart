// Tests for ApiClient.sendMutation — the outbox replay path (P1 Task 1).
//
// sendMutation issues a queued PendingMutation's HTTP verb to its path with its
// body, and maps the result to a ProbeStatus with the SAME honesty contract as
// the rest of the client: 2xx → online, 5xx → degraded, network error → offline.
// The Outbox flush caller treats only `online` as "remove from the queue".

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/client.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/core/secrets.dart';
import 'package:health_hub/core/secure_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

/// In-memory SecureStore so ApiClient's interceptor has something to read.
class _MemStore implements SecureStore {
  final _m = <String, String>{};
  @override
  Future<void> write(String key, String value) async => _m[key] = value;
  @override
  Future<String?> read(String key) async => _m[key];
  @override
  Future<void> delete(String key) async => _m.remove(key);
}

/// A Dio interceptor that fakes responses/errors so no real network is hit.
class _FakeAdapterInterceptor extends Interceptor {
  _FakeAdapterInterceptor(this.handlerFn);

  /// Given the request options, returns either a Response (resolve) or throws a
  /// DioException (reject).
  final Response<dynamic> Function(RequestOptions options) handlerFn;

  final List<RequestOptions> captured = [];

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    captured.add(options);
    try {
      handler.resolve(handlerFn(options));
    } on DioException catch (e) {
      handler.reject(e);
    }
  }
}

ApiClient _client(_FakeAdapterInterceptor fake) {
  final dio = Dio();
  dio.interceptors.add(fake);
  return ApiClient(dio, Secrets(_MemStore()));
}

PendingMutation _mut({
  String method = 'PUT',
  String path = '/tdee/profile',
  Map<String, dynamic>? body = const {'weight_kg': 62.5},
}) =>
    PendingMutation(
      id: 'm1',
      dedupeKey: 'profile',
      method: method,
      path: path,
      body: body,
      createdAt: 0,
    );

void main() {
  test('2xx response → online', () async {
    final fake = _FakeAdapterInterceptor(
      (o) => Response(requestOptions: o, statusCode: 200),
    );
    final status = await _client(fake).sendMutation(_mut());
    expect(status, ProbeStatus.online);
  });

  test('5xx response → degraded', () async {
    final fake = _FakeAdapterInterceptor((o) {
      throw DioException(
        requestOptions: o,
        response: Response(requestOptions: o, statusCode: 503),
        type: DioExceptionType.badResponse,
      );
    });
    final status = await _client(fake).sendMutation(_mut());
    expect(status, ProbeStatus.degraded);
  });

  test('network error (no response) → offline', () async {
    final fake = _FakeAdapterInterceptor((o) {
      throw DioException(
        requestOptions: o,
        type: DioExceptionType.connectionError,
      );
    });
    final status = await _client(fake).sendMutation(_mut());
    expect(status, ProbeStatus.offline);
  });

  test('4xx response → offline (non-online, kept — P3 owns reject semantics)',
      () async {
    // A client error is not "online" and not a 5xx, so the basic flush keeps it
    // queued (does not silently drop). Full reject/max-tries handling is P3.
    final fake = _FakeAdapterInterceptor((o) {
      throw DioException(
        requestOptions: o,
        response: Response(requestOptions: o, statusCode: 400),
        type: DioExceptionType.badResponse,
      );
    });
    final status = await _client(fake).sendMutation(_mut());
    expect(status, ProbeStatus.offline);
  });

  test('issues the mutation method + path + body', () async {
    late RequestOptions seen;
    final fake = _FakeAdapterInterceptor((o) {
      seen = o;
      return Response(requestOptions: o, statusCode: 200);
    });
    await _client(fake).sendMutation(
      _mut(method: 'post', path: '/food', body: {'name': 'egg'}),
    );
    expect(seen.method, 'POST'); // normalised to upper-case
    expect(seen.path, contains('/food'));
    expect(seen.data, {'name': 'egg'});
  });

  test('body-less mutation (e.g. DELETE) sends no data', () async {
    late RequestOptions seen;
    final fake = _FakeAdapterInterceptor((o) {
      seen = o;
      return Response(requestOptions: o, statusCode: 204);
    });
    final status = await _client(fake).sendMutation(
      _mut(method: 'DELETE', path: '/food/123', body: null),
    );
    expect(status, ProbeStatus.online);
    expect(seen.method, 'DELETE');
    expect(seen.data, isNull);
  });
}
