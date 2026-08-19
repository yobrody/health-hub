import 'package:dio/dio.dart';

import '../core/config.dart';
import '../core/secrets.dart';
import '../offline/pending_mutation.dart';
import '../profile/profile_repo.dart' show ProfileApi;
import '../sync/sync_service.dart' show MutationSender;
import 'models.dart';
import 'probe_status.dart';

/// HTTP client for the Health Hub backend API.
///
/// Responsibilities:
///  - Attaches `X-Health-Key` to every request (via an interceptor).
///  - Maps HTTP errors honestly:
///    * 5xx server errors → [ProbeStatus.degraded]
///    * Connection/network errors → [ProbeStatus.offline]
///    * Success → [ProbeStatus.online] + parsed response body.
///
/// Takes a [Dio] and a [Secrets] so that tests can inject fakes.
///
/// Implements [ProfileApi] (its `putProfile`) and [MutationSender] (its
/// `sendMutation`) so the composition root can hand the SAME real client to
/// both the [ProfileRepo] and the [SyncService] without an adapter.
class ApiClient implements ProfileApi, MutationSender {
  ApiClient(this._dio, this._secrets) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final key = await _secrets.getHealthKey();
          if (key != null) {
            options.headers[Secrets.healthKeyHeader] = key;
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final Secrets _secrets;

  /// Fetch today's health snapshot from `GET /today`.
  ///
  /// Returns:
  ///  - `ApiResult(status: online,   data: Today(...))`  on success.
  ///  - `ApiResult(status: degraded, data: null)`        on 5xx.
  ///  - `ApiResult(status: offline,  data: null)`        on network failure.
  Future<ApiResult<Today>> getToday() async {
    Response<dynamic> response;
    try {
      // Fetch as dynamic (not a hard Map cast, which would itself throw a
      // TypeError on an HTML/array body) so we can validate the shape below.
      response = await _dio.get<dynamic>('${Config.baseUrl}/today');
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode != null && statusCode >= 500) {
        return const ApiResult(status: ProbeStatus.degraded, data: null);
      }
      // Connection errors (no response): connectionError, sendTimeout,
      // receiveTimeout, connectionTimeout, cancel, unknown.
      return const ApiResult(status: ProbeStatus.offline, data: null);
    }

    // The transport succeeded (2xx). Any failure parsing the body is a
    // server contract problem, not a success — map it to degraded, never
    // crash the caller and never fabricate an online result.
    try {
      final data = response.data;
      if (data == null) {
        // A null 200 body is treated as an all-null (honest) Today, not 0s.
        return const ApiResult(status: ProbeStatus.online, data: Today());
      }
      if (data is! Map<String, dynamic>) {
        // Non-JSON-object body (HTML error page, array, string): degraded.
        return const ApiResult(status: ProbeStatus.degraded, data: null);
      }
      final today = Today.fromJson(data);
      return ApiResult(status: ProbeStatus.online, data: today);
    } catch (_) {
      return const ApiResult(status: ProbeStatus.degraded, data: null);
    }
  }

  /// Save the user's profile via `PUT /tdee/profile`.
  ///
  /// [params] must already contain ONLY the fields the user actually provided
  /// (non-null). It is the caller's job (see `ProfileRepo`) to strip nulls and
  /// map field names to the backend's contract — this method sends verbatim.
  /// Nothing here fabricates a value.
  ///
  /// The backend binds these query params (all optional):
  ///   weight_kg, height_cm, age, sex, activity_level, goal_direction,
  ///   target_weight_kg
  /// Unknown params (e.g. `primary_gym`, which the backend has no field for
  /// yet) are simply ignored by FastAPI — harmless, and a later phase can add
  /// server support.
  ///
  /// Returns:
  ///  - [ProbeStatus.online]   on 2xx.
  ///  - [ProbeStatus.degraded] on 5xx.
  ///  - [ProbeStatus.offline]  on a network failure.
  /// A degraded/offline result signals the caller to queue the write instead of
  /// treating it as a hard failure.
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async {
    try {
      await _dio.put<dynamic>(
        '${Config.baseUrl}/tdee/profile',
        queryParameters: params,
      );
      return ProbeStatus.online;
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode != null && statusCode >= 500) {
        return ProbeStatus.degraded;
      }
      return ProbeStatus.offline;
    }
  }

  /// Replay a queued [PendingMutation] against the backend.
  ///
  /// This is the outbox-flush path: it issues the mutation's own [method] to its
  /// [path] with its [body], and maps the result with the SAME honesty contract
  /// as [getToday]/[putProfile]:
  ///  - 2xx           → [ProbeStatus.online]   (the flush caller removes it).
  ///  - 5xx           → [ProbeStatus.degraded] (kept queued — server unhealthy).
  ///  - anything else (network error, or a 4xx) → [ProbeStatus.offline]
  ///    (kept queued). A 4xx is a server-side rejection, but the finer-grained
  ///    reject/max-tries handling is P3 Task 11; here a non-2xx simply means
  ///    "not accepted yet", so the mutation stays safely queued rather than
  ///    being silently dropped.
  ///
  /// The `X-Health-Key` interceptor still runs, so a replayed request is
  /// authenticated exactly like a live one. [path] is used verbatim relative to
  /// [Config.baseUrl] — [PendingMutation.path] already stores the backend path.
  @override
  Future<ProbeStatus> sendMutation(PendingMutation m) async {
    try {
      await _dio.request<dynamic>(
        '${Config.baseUrl}${m.path}',
        data: m.body,
        options: Options(method: m.method.toUpperCase()),
      );
      return ProbeStatus.online;
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode != null && statusCode >= 500) {
        return ProbeStatus.degraded;
      }
      return ProbeStatus.offline;
    }
  }
}
