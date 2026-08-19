/// Pure, tested shelf-life / reorder / freshness helpers for the Pantry.
///
/// Honesty rules baked in:
///  • [estimateExpiry] returns `null` when there's no purchase date — no guess.
///  • [deriveReorderCadenceDays] returns `null` on <2 purchases — insufficient
///    data is reported honestly, never averaged into a fake cadence.
///  • [freshnessOf] returns [Freshness.unknown] (NOT `fresh`) when there is no
///    expiry — an unknown state must not masquerade as a good one.
/// All date maths uses LOCAL date components to avoid a UTC off-by-one.
library;

import 'pantry_item.dart';

/// Typical shelf life per zone, in days. Deliberately conservative round
/// numbers — an *estimate* the user can override, not a promise.
const Map<PantryZone, int> kShelfLifeDays = {
  PantryZone.fridge: 7,
  PantryZone.freezer: 90,
  PantryZone.pantry: 180,
  PantryZone.condiments: 365,
};

/// How many days out counts as "use soon" for [freshnessOf].
const int kUseSoonWindowDays = 3;

/// Estimate an expiry date from the [zone]'s typical shelf life, anchored to
/// [purchasedAt]. Returns `null` when [purchasedAt] is null (no guess).
///
/// Computed from LOCAL Y/M/D (time zeroed) so the day never shifts due to a
/// UTC round-trip — a late-evening purchase estimates the same calendar day
/// regardless of timezone.
DateTime? estimateExpiry(PantryZone zone, DateTime? purchasedAt) {
  if (purchasedAt == null) return null;
  final days = kShelfLifeDays[zone] ?? kShelfLifeDays[PantryZone.pantry]!;
  final localDay =
      DateTime(purchasedAt.year, purchasedAt.month, purchasedAt.day);
  return localDay.add(Duration(days: days));
}

/// Derive a reorder cadence (average gap in whole days between purchases).
///
/// Returns `null` when fewer than 2 purchases exist — an honest "insufficient
/// data" rather than a fabricated cadence. Input order does not matter (dates
/// are sorted first). The average is rounded to the nearest whole day.
int? deriveReorderCadenceDays(List<DateTime> purchaseDates) {
  if (purchaseDates.length < 2) return null;
  final sorted = [...purchaseDates]..sort();
  var totalDays = 0;
  for (var i = 1; i < sorted.length; i++) {
    final a = DateTime(sorted[i - 1].year, sorted[i - 1].month, sorted[i - 1].day);
    final b = DateTime(sorted[i].year, sorted[i].month, sorted[i].day);
    totalDays += b.difference(a).inDays;
  }
  final gaps = sorted.length - 1;
  return (totalDays / gaps).round();
}

/// The freshness of an item relative to [now]. Drives the (later) changing
/// visual — a fridge item that's expiring looks different from a fresh one.
enum Freshness {
  /// Plenty of life left.
  fresh,

  /// Within [kUseSoonWindowDays] of the expiry — nudge the user to eat it.
  useSoon,

  /// At or past the expiry.
  expired,

  /// No expiry recorded — we genuinely don't know. NOT the same as `fresh`.
  unknown,
}

/// Classify an item's [Freshness] at [now].
///
/// `unknown` when the item has no expiry (honest — we can't claim it's fresh).
/// `expired` at or past the expiry instant; `useSoon` within the soon window;
/// otherwise `fresh`.
Freshness freshnessOf(PantryItem item, DateTime now) {
  final expiry = item.expiry;
  if (expiry == null) return Freshness.unknown;
  if (!expiry.isAfter(now)) return Freshness.expired;
  final soonCutoff = now.add(const Duration(days: kUseSoonWindowDays));
  if (!expiry.isAfter(soonCutoff)) return Freshness.useSoon;
  return Freshness.fresh;
}
