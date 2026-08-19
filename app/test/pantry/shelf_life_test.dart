// Tests for shelf_life.dart (P1-T2) — PURE, honest helpers.
//
// Invariants:
//  • estimateExpiry uses a per-zone table, computed from LOCAL date components
//    (no UTC off-by-one); null when purchasedAt is null (no guess).
//  • deriveReorderCadenceDays: null on <2 purchases (insufficient data),
//    average gap on >=2.
//  • freshnessOf → unknown (NOT fresh) when no expiry.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/shelf_life.dart';

void main() {
  group('estimateExpiry', () {
    test('null purchasedAt → null (no guess)', () {
      expect(estimateExpiry(PantryZone.fridge, null), isNull);
    });

    test('fridge ≈ 7 days from purchase (local date)', () {
      final bought = DateTime(2026, 8, 18, 14, 30);
      expect(estimateExpiry(PantryZone.fridge, bought), DateTime(2026, 8, 25));
    });

    test('freezer ≈ 90 days', () {
      final bought = DateTime(2026, 8, 18);
      expect(
        estimateExpiry(PantryZone.freezer, bought),
        DateTime(2026, 8, 18).add(const Duration(days: 90)),
      );
    });

    test('pantry ≈ 180 days', () {
      final bought = DateTime(2026, 1, 1);
      expect(
        estimateExpiry(PantryZone.pantry, bought),
        DateTime(2026, 1, 1).add(const Duration(days: 180)),
      );
    });

    test('condiments ≈ 365 days', () {
      final bought = DateTime(2026, 1, 1);
      expect(
        estimateExpiry(PantryZone.condiments, bought),
        DateTime(2026, 1, 1).add(const Duration(days: 365)),
      );
    });

    test('uses LOCAL date components — result is a pure local date, time zeroed',
        () {
      // Late-evening purchase: a UTC toIso/back conversion could shift the day.
      // We compute from local Y/M/D, so the day component is stable.
      final bought = DateTime(2026, 8, 18, 23, 59);
      final expiry = estimateExpiry(PantryZone.fridge, bought)!;
      expect(expiry.hour, 0);
      expect(expiry.minute, 0);
      expect(expiry.day, 25);
      expect(expiry.month, 8);
      expect(expiry.isUtc, isFalse);
    });
  });

  group('deriveReorderCadenceDays', () {
    test('fewer than 2 purchases → null (insufficient data, no guess)', () {
      expect(deriveReorderCadenceDays([]), isNull);
      expect(deriveReorderCadenceDays([DateTime(2026, 8, 1)]), isNull);
    });

    test('two purchases → the single gap', () {
      final dates = [DateTime(2026, 8, 1), DateTime(2026, 8, 8)];
      expect(deriveReorderCadenceDays(dates), 7);
    });

    test('three evenly-spaced purchases → the average gap', () {
      final dates = [
        DateTime(2026, 8, 1),
        DateTime(2026, 8, 8),
        DateTime(2026, 8, 15),
      ];
      expect(deriveReorderCadenceDays(dates), 7);
    });

    test('uneven gaps → rounded average', () {
      // gaps: 7 and 14 → avg 10.5 → rounds to 11.
      final dates = [
        DateTime(2026, 8, 1),
        DateTime(2026, 8, 8),
        DateTime(2026, 8, 22),
      ];
      expect(deriveReorderCadenceDays(dates), 11);
    });

    test('unordered input is handled (sorted first)', () {
      final dates = [
        DateTime(2026, 8, 15),
        DateTime(2026, 8, 1),
        DateTime(2026, 8, 8),
      ];
      expect(deriveReorderCadenceDays(dates), 7);
    });
  });

  group('freshnessOf', () {
    final now = DateTime(2026, 8, 18, 12, 0);

    PantryItem itemWith(DateTime? expiry) => PantryItem(
          id: 'x',
          name: 'y',
          zone: PantryZone.fridge,
          source: 'manual',
          expiry: expiry,
        );

    test('no expiry → unknown (NOT fresh)', () {
      expect(freshnessOf(itemWith(null), now), Freshness.unknown);
    });

    test('expiry in the past → expired', () {
      expect(freshnessOf(itemWith(DateTime(2026, 8, 17)), now),
          Freshness.expired);
    });

    test('expiry within the soon window → useSoon', () {
      // 2 days out.
      expect(freshnessOf(itemWith(DateTime(2026, 8, 20)), now),
          Freshness.useSoon);
    });

    test('expiry well in the future → fresh', () {
      expect(freshnessOf(itemWith(DateTime(2026, 9, 30)), now),
          Freshness.fresh);
    });

    test('expiry exactly now → expired (not fresh)', () {
      expect(freshnessOf(itemWith(now), now), Freshness.expired);
    });
  });
}
