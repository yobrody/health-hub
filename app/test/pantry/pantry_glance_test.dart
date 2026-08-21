// Pure unit tests for pantryGlance (P4-F) — the honest home-screen selection of
// what's expiring soon / low on stock.
//
// Honesty invariants under test:
//  • Expiring = a REAL expiry within the window; null expiry is NEVER shown.
//  • Low stock = only a genuinely known, gram-reconcilable qty below threshold;
//    null qty / unreconcilable unit is NEVER shown as low.
//  • Empty when nothing honestly qualifies (no invented urgency).
//  • `now` is injected — the fn is deterministic.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/pantry_glance.dart';
import 'package:health_hub/pantry/pantry_item.dart';

PantryItem _item({
  required String id,
  String? name,
  PantryZone zone = PantryZone.fridge,
  double? qty,
  String? unit,
  DateTime? expiry,
}) =>
    PantryItem(
      id: id,
      name: name ?? id,
      zone: zone,
      qty: qty,
      unit: unit,
      expiry: expiry,
      source: 'manual',
    );

void main() {
  final now = DateTime(2026, 8, 21, 12);

  group('pantryGlance — expiring soon', () {
    test('an item expiring within the window is flagged', () {
      final g = pantryGlance(
        [_item(id: 'milk', expiry: now.add(const Duration(days: 2)))],
        now,
      );
      expect(g.expiringSoon, hasLength(1));
      expect(g.expiringSoon.first.item.id, 'milk');
      expect(g.expiringSoon.first.expiringSoon, isTrue);
      expect(g.isEmpty, isFalse);
    });

    test('an already-expired item is flagged', () {
      final g = pantryGlance(
        [_item(id: 'yoghurt', expiry: now.subtract(const Duration(days: 1)))],
        now,
      );
      expect(g.expiringSoon, hasLength(1));
      expect(g.expiringSoon.first.item.id, 'yoghurt');
    });

    test('an item expiring AFTER the window is NOT flagged', () {
      final g = pantryGlance(
        [_item(id: 'cheese', expiry: now.add(const Duration(days: 10)))],
        now,
      );
      expect(g.expiringSoon, isEmpty);
      expect(g.isEmpty, isTrue);
    });

    test('a null-expiry item is never shown as expiring (no guess)', () {
      final g = pantryGlance(
        [_item(id: 'rice', expiry: null, zone: PantryZone.pantry)],
        now,
      );
      expect(g.expiringSoon, isEmpty);
    });

    test('respects a custom window', () {
      final items = [
        _item(id: 'a', expiry: now.add(const Duration(days: 5))),
      ];
      // Default 3-day window → not flagged.
      expect(pantryGlance(items, now).expiringSoon, isEmpty);
      // 7-day window → flagged.
      expect(
        pantryGlance(items, now, expiringWithinDays: 7).expiringSoon,
        hasLength(1),
      );
    });

    test('expiring items are sorted earliest-first', () {
      final g = pantryGlance(
        [
          _item(id: 'later', expiry: now.add(const Duration(days: 3))),
          _item(id: 'sooner', expiry: now.add(const Duration(days: 1))),
        ],
        now,
      );
      expect(g.expiringSoon.map((e) => e.item.id), ['sooner', 'later']);
    });
  });

  group('pantryGlance — low stock', () {
    test('a known gram qty below threshold is flagged low', () {
      final g = pantryGlance(
        [_item(id: 'chicken', qty: 50, unit: 'g')],
        now,
      );
      expect(g.lowStock, hasLength(1));
      expect(g.lowStock.first.item.id, 'chicken');
      expect(g.lowStock.first.lowStock, isTrue);
    });

    test('a null-unit qty (implicit grams) below threshold is flagged low', () {
      final g = pantryGlance(
        [_item(id: 'flour', qty: 40, unit: null)],
        now,
      );
      expect(g.lowStock, hasLength(1));
    });

    test('a real 0 qty (out of stock) counts as low', () {
      final g = pantryGlance(
        [_item(id: 'eggs', qty: 0, unit: 'g')],
        now,
      );
      expect(g.lowStock, hasLength(1));
    });

    test('a qty at/above the threshold is NOT low', () {
      final g = pantryGlance(
        [_item(id: 'oats', qty: 500, unit: 'g')],
        now,
      );
      expect(g.lowStock, isEmpty);
    });

    test('a null qty is NEVER shown as low (no fabrication)', () {
      final g = pantryGlance(
        [_item(id: 'unknown', qty: null, unit: 'g')],
        now,
      );
      expect(g.lowStock, isEmpty);
    });

    test('an unreconcilable unit is NEVER shown as low', () {
      // 1 "pack" is a low number but we can't honestly compare it to grams.
      final g = pantryGlance(
        [_item(id: 'pasta', qty: 1, unit: 'pack')],
        now,
      );
      expect(g.lowStock, isEmpty);
    });

    test('respects a custom threshold', () {
      final items = [_item(id: 'butter', qty: 150, unit: 'g')];
      // Default 100 g threshold → 150 not low.
      expect(pantryGlance(items, now).lowStock, isEmpty);
      // 200 g threshold → 150 is low.
      expect(
        pantryGlance(items, now, lowStockThresholdGrams: 200).lowStock,
        hasLength(1),
      );
    });

    test('low items are sorted lowest-qty first', () {
      final g = pantryGlance(
        [
          _item(id: 'more', qty: 80, unit: 'g'),
          _item(id: 'less', qty: 20, unit: 'g'),
        ],
        now,
      );
      expect(g.lowStock.map((e) => e.item.id), ['less', 'more']);
    });
  });

  group('pantryGlance — combined & empty', () {
    test('an item both expiring and low is flagged in both lists', () {
      final g = pantryGlance(
        [
          _item(
            id: 'chicken',
            qty: 30,
            unit: 'g',
            expiry: now.add(const Duration(days: 1)),
          ),
        ],
        now,
      );
      expect(g.expiringSoon, hasLength(1));
      expect(g.lowStock, hasLength(1));
      expect(g.expiringSoon.first.lowStock, isTrue);
      expect(g.lowStock.first.expiringSoon, isTrue);
    });

    test('nothing qualifying → empty glance (no invented urgency)', () {
      final g = pantryGlance(
        [
          _item(id: 'fresh', qty: 900, unit: 'g', expiry: now.add(const Duration(days: 30))),
          _item(id: 'no-data', qty: null, unit: null, expiry: null),
          _item(id: 'packs', qty: 1, unit: 'pack', expiry: null),
        ],
        now,
      );
      expect(g.expiringSoon, isEmpty);
      expect(g.lowStock, isEmpty);
      expect(g.isEmpty, isTrue);
    });

    test('an empty pantry → empty glance', () {
      final g = pantryGlance(const [], now);
      expect(g.isEmpty, isTrue);
    });
  });
}
