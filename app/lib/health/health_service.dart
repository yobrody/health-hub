import 'package:health/health.dart';

import 'health_types.dart';

/// Reads normalized [HealthSample]s from a platform health store.
///
/// Split out as an interface so the summing / null-handling logic in
/// [HealthService] can be unit-tested against an in-memory fake — the real
/// implementation ([PluginHealthDataSource]) talks to the `health` plugin,
/// which needs HealthKit / Health Connect and cannot run under `flutter test`.
abstract class HealthDataSource {
  /// Request read authorization for the P0 metrics (steps + sleep).
  ///
  /// Returns `true` if the user granted (or had already granted) access.
  Future<bool> requestPermissions();

  /// Read raw samples for [metrics] overlapping the `[start, end)` window.
  ///
  /// Returns an empty list when nothing is available — the caller (never this
  /// method) is responsible for turning "no samples" into a `null` result.
  Future<List<HealthSample>> readSamples({
    required List<HealthMetric> metrics,
    required DateTime start,
    required DateTime end,
  });
}

// ── Pure helpers (fully unit-tested; no plugin, no I/O) ─────────────────────

/// Local-midnight → next local-midnight window for the calendar day of [day].
///
/// Uses local date components (not UTC) so the day boundary matches the user's
/// wall clock — a UTC window would mis-bucket steps for non-UTC users.
(DateTime, DateTime) dayWindow(DateTime day) {
  final start = DateTime(day.year, day.month, day.day);
  final end = start.add(const Duration(days: 1));
  return (start, end);
}

/// The "night of [date]" window: local 18:00 on [date] → local 12:00 the next
/// day. Wide enough to catch an early-evening nap through a late lie-in, while
/// excluding the following evening. Local components again, for the same
/// wall-clock-correctness reason as [dayWindow].
(DateTime, DateTime) nightWindow(DateTime date) {
  final start = DateTime(date.year, date.month, date.day, 18);
  final end = DateTime(date.year, date.month, date.day).add(
    const Duration(days: 1, hours: 12),
  );
  return (start, end);
}

/// Sum step samples into a total.
///
/// Returns `null` when [samples] is empty — **never** `0` for absent data.
/// A genuine `0`-count sample still sums to `0`, which is the correct,
/// distinct answer. Fractional values are floored per sample to match the
/// plugin's integer step semantics.
int? sumSteps(List<HealthSample> samples) {
  if (samples.isEmpty) return null;
  var total = 0;
  for (final s in samples) {
    total += s.value.floor();
  }
  return total;
}

/// Sum asleep-sample durations into hours.
///
/// Returns `null` when [samples] is empty — **never** `0` for absent data.
/// Each sleep sample's [HealthSample.value] is its duration in minutes; we sum
/// those and convert to hours. (Summing `value` rather than `end - start`
/// keeps the fake and the real path identical and avoids depending on how the
/// plugin sets the timestamps.)
double? totalSleepHours(List<HealthSample> samples) {
  if (samples.isEmpty) return null;
  var minutes = 0.0;
  for (final s in samples) {
    minutes += s.value;
  }
  return minutes / 60.0;
}

// ── Service (pure orchestration over a [HealthDataSource]) ───────────────────

/// High-level health-import API used by the rest of the app.
///
/// Thin: it delegates I/O to a [HealthDataSource] and defers all arithmetic to
/// the pure helpers above, so every honesty-critical path is covered by unit
/// tests with a fake source.
class HealthService {
  const HealthService({required HealthDataSource source}) : this._(source);

  const HealthService._(this._source);

  final HealthDataSource _source;

  /// Ask for steps + sleep read permission. Returns whether it was granted.
  Future<bool> requestPermissions() => _source.requestPermissions();

  /// Total steps for the calendar day of [day], or `null` if no data.
  Future<int?> dailySteps(DateTime day) async {
    final (start, end) = dayWindow(day);
    final samples = await _source.readSamples(
      metrics: const [HealthMetric.steps],
      start: start,
      end: end,
    );
    return sumSteps(samples);
  }

  /// Hours asleep for the night of [night], or `null` if no data.
  Future<double?> sleepHours(DateTime night) async {
    final (start, end) = nightWindow(night);
    final samples = await _source.readSamples(
      metrics: const [HealthMetric.sleep],
      start: start,
      end: end,
    );
    return totalSleepHours(samples);
  }
}

// ── Real implementation backed by the `health` plugin ────────────────────────

/// The P0 health data types we request + read. Steps + sleep only.
///
/// Sleep uses the "total asleep" categories only ([SLEEP_ASLEEP],
/// [SLEEP_SESSION]) — **not** the per-stage types (DEEP/LIGHT/REM), which
/// overlap the asleep interval and would double-count. HealthKit reports
/// asleep time via `SLEEP_ASLEEP`; Health Connect reports a `SLEEP_SESSION`.
const _stepTypes = <HealthDataType>[
  HealthDataType.STEPS,
];
const _sleepTypes = <HealthDataType>[
  HealthDataType.SLEEP_ASLEEP,
  HealthDataType.SLEEP_SESSION,
];

/// Production [HealthDataSource] backed by the `health` plugin.
///
/// NOT unit-tested (needs HealthKit / Health Connect + a real device); kept
/// deliberately thin so the tested pure helpers carry the logic. Validated on
/// device via TestFlight later.
class PluginHealthDataSource implements HealthDataSource {
  PluginHealthDataSource({Health? health}) : _health = health ?? Health();

  final Health _health;
  bool _configured = false;

  List<HealthDataType> get _readTypes => [..._stepTypes, ..._sleepTypes];

  Future<void> _ensureConfigured() async {
    if (_configured) return;
    await _health.configure();
    _configured = true;
  }

  @override
  Future<bool> requestPermissions() async {
    await _ensureConfigured();
    // READ-only for every P0 type. (Scaffold: extend [_readTypes] +
    // permissions when active-energy / HR / weight / workouts land.)
    final permissions =
        List.filled(_readTypes.length, HealthDataAccess.READ);
    return _health.requestAuthorization(_readTypes, permissions: permissions);
  }

  @override
  Future<List<HealthSample>> readSamples({
    required List<HealthMetric> metrics,
    required DateTime start,
    required DateTime end,
  }) async {
    await _ensureConfigured();

    final types = <HealthDataType>[
      if (metrics.contains(HealthMetric.steps)) ..._stepTypes,
      if (metrics.contains(HealthMetric.sleep)) ..._sleepTypes,
    ];
    if (types.isEmpty) return const [];

    final points = _health.removeDuplicates(
      await _health.getHealthDataFromTypes(
        types: types,
        startTime: start,
        endTime: end,
      ),
    );

    final out = <HealthSample>[];
    for (final p in points) {
      final metric = _metricOf(p.type);
      if (metric == null) continue;
      final value = _valueOf(metric, p);
      if (value == null) continue;
      out.add(HealthSample(
        metric: metric,
        value: value,
        start: p.dateFrom,
        end: p.dateTo,
      ));
    }
    return out;
  }

  HealthMetric? _metricOf(HealthDataType type) {
    if (_stepTypes.contains(type)) return HealthMetric.steps;
    if (_sleepTypes.contains(type)) return HealthMetric.sleep;
    return null;
  }

  /// Extract the numeric value a sample contributes.
  ///
  /// Steps: the counted value. Sleep: the sample's duration in minutes (its
  /// `NumericHealthValue` is already in minutes; if absent, fall back to the
  /// timestamp span). Returns `null` — not `0` — for a sample carrying no
  /// usable value, so it is dropped rather than counted as a real zero.
  double? _valueOf(HealthMetric metric, HealthDataPoint p) {
    switch (metric) {
      case HealthMetric.steps:
        final v = p.value;
        return v is NumericHealthValue ? v.numericValue.toDouble() : null;
      case HealthMetric.sleep:
        final v = p.value;
        if (v is NumericHealthValue) return v.numericValue.toDouble();
        // Some backends report sleep as a plain interval with no numeric
        // value; derive minutes from the timestamps instead.
        final minutes =
            p.dateTo.difference(p.dateFrom).inMilliseconds / 60000.0;
        return minutes > 0 ? minutes : null;
    }
  }
}
