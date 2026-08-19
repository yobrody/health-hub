import 'package:dio/dio.dart';

import '../core/config.dart';
import '../core/secrets.dart';
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
class ApiClient {
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
    try {
      final response =
          await _dio.get<Map<String, dynamic>>('${Config.baseUrl}/today');
      final data = response.data;
      final today = Today.fromJson(data ?? const {});
      return ApiResult(status: ProbeStatus.online, data: today);
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode != null && statusCode >= 500) {
        return const ApiResult(status: ProbeStatus.degraded, data: null);
      }
      // Connection errors (no response): connectionError, sendTimeout,
      // receiveTimeout, connectionTimeout, cancel, unknown.
      return const ApiResult(status: ProbeStatus.offline, data: null);
    }
  }
}
