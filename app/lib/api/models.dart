import 'probe_status.dart';

/// Typed wrapper returned by every [ApiClient] method.
///
/// [data] is null when the call failed (degraded or offline).
/// [status] is always set.
class ApiResult<T> {
  const ApiResult({this.data, required this.status});

  final T? data;
  final ProbeStatus status;
}

/// Snapshot of the user's health day from `GET /today`.
///
/// All numeric fields are nullable — absent or JSON-null values map to Dart
/// null. They are **never** coerced to 0 so callers can distinguish
/// "no data" from "data that happens to be zero".
class Today {
  const Today({
    this.totalKcal,
    this.proteinG,
    this.weightKg,
  });

  /// Total kilocalories logged today (may be null if nothing logged yet).
  final int? totalKcal;

  /// Grams of protein logged today.
  final num? proteinG;

  /// Most recent body-weight entry in kg.
  final num? weightKg;

  /// Parse a `Today` from the `/today` JSON response.
  ///
  /// Absent keys and explicit `null` values both produce Dart `null`.
  /// Numeric values are read as-is; no defaulting to 0.
  ///
  /// `total_kcal` is read as `num?` before `.toInt()` because JSON has no
  /// int/double distinction and the Python backend can emit a whole number
  /// as a double (e.g. `1800.0`). A hard `as int?` would throw on that,
  /// escaping the caller's error handling on an otherwise-successful 200.
  /// `?.toInt()` preserves `null` as `null` (no coalesce-to-0).
  factory Today.fromJson(Map<String, dynamic> json) {
    return Today(
      totalKcal: (json['total_kcal'] as num?)?.toInt(),
      proteinG: json['protein_g'] as num?,
      weightKg: json['weight_kg'] as num?,
    );
  }
}
