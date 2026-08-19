// Tests for FoodLogEntry (P2-T1) — the honesty core of nutrition logging.
//
// Invariants under test:
//  • Absent kcal/macros/micros deserialise to `null`, NEVER `0` (0 kcal is a
//    REAL measured value; unknown kcal is `null`).
//  • toJson OMITS null/empty fields — a minimal entry emits no fabricated
//    `kcal`/`micros`/etc.
//  • Round-trip preserves the `micros` map, the accuracy `tier`, and the
//    eating-out fields (`ateOut`/`spendGbp`).
//  • An `estimate` entry's tier survives serialisation (estimate ≠ exact).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';

void main() {
  final at = DateTime(2026, 8, 19, 8, 30);

  group('FoodLogEntry.fromJson — absent values are null, never 0', () {
    test('a minimal payload leaves all optional fields null', () {
      final e = FoodLogEntry.fromJson({
        'id': 'a1',
        'name': 'Black coffee',
        'at': at.toIso8601String(),
        'tier': 'exact',
        'source': 'manual',
      });
      expect(e.id, 'a1');
      expect(e.name, 'Black coffee');
      expect(e.kcal, isNull); // NOT 0
      expect(e.proteinG, isNull);
      expect(e.carbsG, isNull);
      expect(e.fatG, isNull);
      expect(e.micros, isNull); // not measured → null, never {}
      expect(e.grams, isNull);
      expect(e.tier, AccuracyTier.exact);
      expect(e.ateOut, isFalse);
      expect(e.restaurant, isNull);
      expect(e.spendGbp, isNull);
      expect(e.barcode, isNull);
      // Social seam defaults.
      expect(e.ownerId, isNull);
      expect(e.shared, isFalse);
    });

    test('a partial payload keeps present macros and nulls the absent ones', () {
      final e = FoodLogEntry.fromJson({
        'id': 'a2',
        'name': 'Chicken breast',
        'at': at.toIso8601String(),
        'kcal': 165,
        'proteinG': 31,
        // carbsG + fatG absent → must be null, not 0
        'tier': 'exact',
        'source': 'manual',
      });
      expect(e.kcal, 165);
      expect(e.proteinG, 31);
      expect(e.carbsG, isNull);
      expect(e.fatG, isNull);
    });

    test('a genuine 0 kcal is preserved (0 ≠ unknown)', () {
      final e = FoodLogEntry.fromJson({
        'id': 'a3',
        'name': 'Diet cola',
        'at': at.toIso8601String(),
        'kcal': 0,
        'tier': 'exact',
        'source': 'manual',
      });
      expect(e.kcal, 0);
    });

    test('an empty micros map deserialises to null (not measured)', () {
      final e = FoodLogEntry.fromJson({
        'id': 'a4',
        'name': 'Water',
        'at': at.toIso8601String(),
        'micros': <String, dynamic>{},
        'tier': 'exact',
        'source': 'manual',
      });
      expect(e.micros, isNull);
    });

    test('an unknown/absent tier falls back to estimate (never fake-exact)', () {
      final e = FoodLogEntry.fromJson({
        'id': 'a5',
        'name': 'Mystery snack',
        'at': at.toIso8601String(),
        'source': 'ai',
      });
      // Absent tier must NOT claim exactness.
      expect(e.tier, AccuracyTier.estimate);
    });
  });

  group('FoodLogEntry.toJson — omits nulls, no fabricated zeros', () {
    test('a minimal entry emits no macro/micro keys at all', () {
      final e = FoodLogEntry(
        id: 'b1',
        name: 'Black coffee',
        at: at,
        tier: AccuracyTier.exact,
        source: 'manual',
      );
      final json = e.toJson();
      expect(json.containsKey('kcal'), isFalse);
      expect(json.containsKey('proteinG'), isFalse);
      expect(json.containsKey('carbsG'), isFalse);
      expect(json.containsKey('fatG'), isFalse);
      expect(json.containsKey('micros'), isFalse);
      expect(json.containsKey('grams'), isFalse);
      expect(json.containsKey('restaurant'), isFalse);
      expect(json.containsKey('spendGbp'), isFalse);
      expect(json.containsKey('barcode'), isFalse);
      expect(json.containsKey('ownerId'), isFalse);
      // Required + always-present fields.
      expect(json['id'], 'b1');
      expect(json['name'], 'Black coffee');
      expect(json['at'], at.toIso8601String());
      expect(json['tier'], 'exact');
      expect(json['source'], 'manual');
      expect(json['ateOut'], isFalse); // real boolean state, always emitted
      expect(json['shared'], isFalse);
    });

    test('an empty micros map is omitted (never serialised as {})', () {
      final e = FoodLogEntry(
        id: 'b2',
        name: 'Water',
        at: at,
        micros: const {},
        tier: AccuracyTier.exact,
        source: 'manual',
      );
      expect(e.toJson().containsKey('micros'), isFalse);
    });
  });

  group('FoodLogEntry round-trip', () {
    test('preserves micros map, macros, grams, tier, ateOut/spend', () {
      final e = FoodLogEntry(
        id: 'c1',
        name: 'Steak dinner',
        at: at,
        kcal: 700,
        proteinG: 55,
        carbsG: 10,
        fatG: 48,
        micros: const {'sodium_mg': 900, 'iron_mg': 4.2},
        grams: 300,
        tier: AccuracyTier.exact,
        ateOut: true,
        restaurant: 'The Grill',
        spendGbp: 28.5,
        barcode: '5000000000000',
        source: 'manual',
        ownerId: 'user-7',
        shared: true,
      );
      final round = FoodLogEntry.fromJson(e.toJson());
      expect(round.id, 'c1');
      expect(round.name, 'Steak dinner');
      expect(round.at, at);
      expect(round.kcal, 700);
      expect(round.proteinG, 55);
      expect(round.carbsG, 10);
      expect(round.fatG, 48);
      expect(round.micros, {'sodium_mg': 900, 'iron_mg': 4.2});
      expect(round.grams, 300);
      expect(round.tier, AccuracyTier.exact);
      expect(round.ateOut, isTrue);
      expect(round.restaurant, 'The Grill');
      expect(round.spendGbp, 28.5);
      expect(round.barcode, '5000000000000');
      expect(round.source, 'manual');
      expect(round.ownerId, 'user-7');
      expect(round.shared, isTrue);
    });

    test("an estimate entry's tier survives (estimate ≠ exact)", () {
      final e = FoodLogEntry(
        id: 'c2',
        name: 'Guessed portion',
        at: at,
        kcal: 400,
        tier: AccuracyTier.estimate,
        source: 'ai',
      );
      final json = e.toJson();
      expect(json['tier'], 'estimate');
      final round = FoodLogEntry.fromJson(json);
      expect(round.tier, AccuracyTier.estimate);
      expect(round.tier, isNot(AccuracyTier.exact));
    });
  });

  group('FoodLogEntry.copyWith', () {
    test('overrides only the given fields', () {
      final e = FoodLogEntry(
        id: 'd1',
        name: 'Oats',
        at: at,
        kcal: 300,
        tier: AccuracyTier.estimate,
        source: 'manual',
      );
      final next = e.copyWith(kcal: 320, tier: AccuracyTier.exact);
      expect(next.kcal, 320);
      expect(next.tier, AccuracyTier.exact);
      // Unchanged.
      expect(next.id, 'd1');
      expect(next.name, 'Oats');
      expect(next.source, 'manual');
    });
  });
}
