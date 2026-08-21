/// Pure weight-trend computation over a weigh-in history.
///
/// **Honesty is the whole point.** A trend is only computed when there are
/// **≥2 real weigh-ins** (readings with a non-null [WeighIn.weightKg]). With
/// one real reading we show the current weight and NO arrow — a single point is
/// not a trend, and inventing one would be a lie. With none, there is nothing.
///
/// The "earlier" comparison point is the OLDEST real reading in the history, so
/// the delta reads as "net change since you started logging" — a stable,
/// non-fabricated baseline. `delta = current - earliest`; a shrinking weight is
/// [TrendDirection.down], a growing one [TrendDirection.up], an exactly-equal
/// pair [TrendDirection.flat].
library;

import 'weigh_in.dart';

/// Which way the weight moved between the earliest and latest real readings.
enum TrendDirection { up, down, flat }

/// The result of [computeWeightTrend].
///
///  * [currentKg] — the most recent real reading's weight, or `null` when there
///    are no real readings at all.
///  * [hasTrend] — true only with ≥2 real readings; when false, [deltaKg] and
///    [direction] are `null` (never a fabricated trend).
class WeightTrend {
  const WeightTrend({
    required this.currentKg,
    required this.deltaKg,
    required this.direction,
  });

  /// Latest real weight, or `null` when nothing real is logged.
  final double? currentKg;

  /// Net change since the earliest real reading (`current - earliest`). `null`
  /// when there is no honest trend (fewer than 2 real readings).
  final double? deltaKg;

  /// Direction of the change, or `null` when there is no honest trend.
  final TrendDirection? direction;

  /// True only when there are ≥2 real readings to ground a trend on.
  bool get hasTrend => deltaKg != null && direction != null;

  /// The honest "nothing logged" result — no current, no trend.
  static const WeightTrend none =
      WeightTrend(currentKg: null, deltaKg: null, direction: null);
}

/// Compute the [WeightTrend] over [history].
///
/// Only readings with a real (non-null) weight count. Ordering in [history] is
/// irrelevant — the function sorts by [WeighIn.at], so callers may pass the
/// stored list as-is. Returns [WeightTrend.none] when no real reading exists.
WeightTrend computeWeightTrend(List<WeighIn> history) {
  // Keep only real readings, then order oldest → newest by their timestamp.
  final real = history.where((w) => w.weightKg != null).toList()
    ..sort((a, b) => a.at.compareTo(b.at));

  if (real.isEmpty) return WeightTrend.none;

  final currentKg = real.last.weightKg!;

  if (real.length < 2) {
    // One real reading: current weight, but NO trend — never invent one.
    return WeightTrend(currentKg: currentKg, deltaKg: null, direction: null);
  }

  final earliestKg = real.first.weightKg!;
  final delta = currentKg - earliestKg;
  final direction = delta > 0
      ? TrendDirection.up
      : (delta < 0 ? TrendDirection.down : TrendDirection.flat);

  return WeightTrend(
    currentKg: currentKg,
    deltaKg: delta,
    direction: direction,
  );
}
