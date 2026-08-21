// Tests for computeWeightTrend — the honesty-critical trend function.
//
//   • 0 real readings → no current, no trend.
//   • 1 real reading  → current only, NO arrow (never invent a trend).
//   • ≥2 real readings → delta + direction from earliest → latest.
//   • readings with a null weight are ignored (they don't count).
//   • ordering in the input is irrelevant (sorts by `at`).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weight_trend.dart';

WeighIn _w(String id, DateTime at, double? kg) =>
    WeighIn(id: id, at: at, weightKg: kg);

void main() {
  test('no readings → none (no current, no trend)', () {
    final t = computeWeightTrend([]);
    expect(t.currentKg, isNull);
    expect(t.hasTrend, isFalse);
    expect(t.deltaKg, isNull);
    expect(t.direction, isNull);
  });

  test('one real reading → current only, NO trend', () {
    final t = computeWeightTrend([_w('a', DateTime(2026, 8, 1), 62.5)]);
    expect(t.currentKg, 62.5);
    expect(t.hasTrend, isFalse); // one point is not a trend
    expect(t.deltaKg, isNull);
    expect(t.direction, isNull);
  });

  test('two readings, weight down → down direction + negative-magnitude delta', () {
    final t = computeWeightTrend([
      _w('old', DateTime(2026, 8, 1), 65),
      _w('new', DateTime(2026, 8, 20), 62),
    ]);
    expect(t.currentKg, 62);
    expect(t.hasTrend, isTrue);
    expect(t.deltaKg, -3); // 62 - 65
    expect(t.direction, TrendDirection.down);
  });

  test('two readings, weight up → up direction + positive delta', () {
    final t = computeWeightTrend([
      _w('old', DateTime(2026, 8, 1), 60),
      _w('new', DateTime(2026, 8, 20), 63.5),
    ]);
    expect(t.currentKg, 63.5);
    expect(t.deltaKg, 3.5);
    expect(t.direction, TrendDirection.up);
  });

  test('equal endpoints → flat, zero delta', () {
    final t = computeWeightTrend([
      _w('old', DateTime(2026, 8, 1), 62),
      _w('new', DateTime(2026, 8, 20), 62),
    ]);
    expect(t.direction, TrendDirection.flat);
    expect(t.deltaKg, 0);
    expect(t.hasTrend, isTrue);
  });

  test('input order is irrelevant — sorts by timestamp', () {
    // Newest passed FIRST; the function must still use the oldest as baseline.
    final t = computeWeightTrend([
      _w('new', DateTime(2026, 8, 20), 62),
      _w('old', DateTime(2026, 8, 1), 65),
    ]);
    expect(t.currentKg, 62);
    expect(t.deltaKg, -3);
    expect(t.direction, TrendDirection.down);
  });

  test('null-weight readings are ignored', () {
    // One null + one real → still only ONE real reading → no trend.
    final t = computeWeightTrend([
      _w('ghost', DateTime(2026, 8, 1), null),
      _w('real', DateTime(2026, 8, 20), 62),
    ]);
    expect(t.currentKg, 62);
    expect(t.hasTrend, isFalse);
  });

  test('a null-weight reading between two reals does not become current', () {
    final t = computeWeightTrend([
      _w('old', DateTime(2026, 8, 1), 65),
      _w('mid-null', DateTime(2026, 8, 25), null),
      _w('new', DateTime(2026, 8, 20), 62),
    ]);
    // Latest REAL reading is the 62 on Aug 20, not the null on Aug 25.
    expect(t.currentKg, 62);
    expect(t.deltaKg, -3);
    expect(t.direction, TrendDirection.down);
  });
}
