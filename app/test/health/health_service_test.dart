import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/health/health_service.dart';
import 'package:health_hub/health/health_types.dart';

/// A fake [HealthDataSource] that returns a fixed list of [HealthSample]s so we
/// can exercise the pure summing / null-handling / bucketing logic without the
/// `health` plugin (which needs a real device and cannot run under
/// `flutter test`).
class FakeHealthDataSource implements HealthDataSource {
  FakeHealthDataSource({List<HealthSample>? samples, this.granted = true})
      : samples = samples ?? const [];

  final List<HealthSample> samples;
  final bool granted;

  @override
  Future<bool> requestPermissions() async => granted;

  @override
  Future<List<HealthSample>> readSamples({
    required List<HealthMetric> metrics,
    required DateTime start,
    required DateTime end,
  }) async {
    return samples
        .where((s) => metrics.contains(s.metric))
        .where((s) => s.start.isBefore(end) && s.end.isAfter(start))
        .toList();
  }
}

HealthSample step(int count, DateTime at) => HealthSample(
      metric: HealthMetric.steps,
      value: count.toDouble(),
      start: at,
      end: at.add(const Duration(minutes: 1)),
    );

HealthSample asleep(DateTime from, DateTime to) => HealthSample(
      metric: HealthMetric.sleep,
      // For sleep, `value` carries the sample's duration in minutes (as the
      // plugin reports for asleep intervals); the service derives hours from it.
      value: to.difference(from).inMinutes.toDouble(),
      start: from,
      end: to,
    );

void main() {
  group('dailySteps', () {
    test('sums step samples within the day window', () async {
      final day = DateTime(2026, 8, 19);
      final src = FakeHealthDataSource(samples: [
        step(1000, DateTime(2026, 8, 19, 8)),
        step(2500, DateTime(2026, 8, 19, 12)),
        step(500, DateTime(2026, 8, 19, 20)),
      ]);
      final service = HealthService(source: src);

      final total = await service.dailySteps(day);

      expect(total, 4000);
    });

    test('excludes samples outside the day window', () async {
      final day = DateTime(2026, 8, 19);
      final src = FakeHealthDataSource(samples: [
        step(1000, DateTime(2026, 8, 19, 8)),
        // Previous day — must not be counted.
        step(9999, DateTime(2026, 8, 18, 23, 30)),
        // Next day — must not be counted.
        step(8888, DateTime(2026, 8, 20, 0, 30)),
      ]);
      final service = HealthService(source: src);

      final total = await service.dailySteps(day);

      expect(total, 1000);
    });

    test('returns null (NOT 0) when there are no samples', () async {
      final src = FakeHealthDataSource(samples: const []);
      final service = HealthService(source: src);

      final total = await service.dailySteps(DateTime(2026, 8, 19));

      expect(total, isNull);
      expect(total, isNot(0));
    });

    test('returns 0 only when a real zero-count sample exists', () async {
      // "0 steps recorded" is a genuine datum, distinct from "no data".
      final day = DateTime(2026, 8, 19);
      final src = FakeHealthDataSource(samples: [
        step(0, DateTime(2026, 8, 19, 8)),
      ]);
      final service = HealthService(source: src);

      final total = await service.dailySteps(day);

      expect(total, 0);
    });
  });

  group('sleepHours', () {
    test('derives hours from asleep samples for the night', () async {
      // Night of the 19th: 23:00 on the 19th → 07:00 on the 20th = 8h.
      final night = DateTime(2026, 8, 19);
      final src = FakeHealthDataSource(samples: [
        asleep(DateTime(2026, 8, 19, 23, 0), DateTime(2026, 8, 20, 5, 0)), // 6h
        asleep(DateTime(2026, 8, 20, 5, 30), DateTime(2026, 8, 20, 7, 30)), // 2h
      ]);
      final service = HealthService(source: src);

      final hours = await service.sleepHours(night);

      expect(hours, closeTo(8.0, 1e-9));
    });

    test('returns null (NOT 0) when there are no sleep samples', () async {
      final src = FakeHealthDataSource(samples: const []);
      final service = HealthService(source: src);

      final hours = await service.sleepHours(DateTime(2026, 8, 19));

      expect(hours, isNull);
      expect(hours, isNot(0));
    });
  });

  group('pure helpers', () {
    test('sumSteps returns null on empty, sums otherwise', () {
      expect(sumSteps(const []), isNull);
      expect(
        sumSteps([
          HealthSample(
              metric: HealthMetric.steps,
              value: 10,
              start: DateTime(2026),
              end: DateTime(2026)),
          HealthSample(
              metric: HealthMetric.steps,
              value: 5.9, // fractional step values round down like the plugin
              start: DateTime(2026),
              end: DateTime(2026)),
        ]),
        15,
      );
    });

    test('totalSleepHours returns null on empty, sums durations otherwise', () {
      expect(totalSleepHours(const []), isNull);
      final samples = [
        asleep(DateTime(2026, 8, 19, 23), DateTime(2026, 8, 20, 1)), // 2h
        asleep(DateTime(2026, 8, 20, 1), DateTime(2026, 8, 20, 4)), // 3h
      ];
      expect(totalSleepHours(samples), closeTo(5.0, 1e-9));
    });

    test('nightWindow spans local 18:00 → next-day noon around the given date',
        () {
      final (start, end) = nightWindow(DateTime(2026, 8, 19, 15, 0));
      // Evening of the 19th.
      expect(start, DateTime(2026, 8, 19, 18, 0));
      // Midday of the 20th.
      expect(end, DateTime(2026, 8, 20, 12, 0));
    });

    test('dayWindow spans local midnight → next midnight', () {
      final (start, end) = dayWindow(DateTime(2026, 8, 19, 15, 34));
      expect(start, DateTime(2026, 8, 19, 0, 0, 0));
      expect(end, DateTime(2026, 8, 20, 0, 0, 0));
    });
  });
}
