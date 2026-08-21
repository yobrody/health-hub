// Pure unit tests for restockSoon (R-1) — the honest home "Restock soon"
// selection: pantry items that are genuinely low / expiring / reorder-due.
//
// Honesty invariants under test:
//  • Reorder-due = a REAL learned cadence + a REAL lastBought, elapsed; a null
//    cadence OR null lastBought is NEVER due (no fabricated urgency).
//  • Low = only a known, gram-reconcilable qty below threshold.
//  • Expiring = a REAL expiry within the window; null expiry never surfaces.
//  • Empty when nothing honestly qualifies (the card is then omitted).
//  • De-duplicated: an item with multiple reasons appears once, all reasons.
//  • `now` is injected — the fn is deterministic.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/pantry_glance.dart';
import 'package:health_hub/pantry/pantry_item.dart';

PantryItem _item({
  required String id,
  String? name,
  double? qty,
  String? unit,
  DateTime? expiry,
  int? reorderCadenceDays,
  DateTime? lastBought,
}) =>
    PantryItem(
      id: id,
      name: name ?? id,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      expiry: expiry,
      reorderCadenceDays: reorderCadenceDays,
      lastBought: lastBought,
      source: 'manual',
    );

final _now = DateTime(2026, 8, 21, 12);

void main() {
  test('empty pantry → empty result (never invents urgency)', () {
    expect(restockSoon([], _now), isEmpty);
  });

  test('a well-stocked, far-dated item is NOT surfaced', () {
    final items = [
      _item(id: 'rice', qty: 900, unit: 'g', expiry: _now.add(const Duration(days: 365))),
    ];
    expect(restockSoon(items, _now), isEmpty);
  });

  test('a genuinely low (gram) item surfaces with reason low', () {
    final items = [_item(id: 'butter', qty: 20, unit: 'g')];
    final result = restockSoon(items, _now);
    expect(result, hasLength(1));
    expect(result.first.item.id, 'butter');
    expect(result.first.isLow, isTrue);
    expect(result.first.reasons, {RestockReason.low});
  });

  test('a null-qty item is NEVER low (no guessed depletion)', () {
    final items = [_item(id: 'mystery')];
    expect(restockSoon(items, _now), isEmpty);
  });

  test('a non-gram unit is NEVER low (can\'t honestly reconcile)', () {
    final items = [_item(id: 'eggs', qty: 1, unit: 'pack')];
    expect(restockSoon(items, _now), isEmpty);
  });

  test('an expiring item surfaces with reason expiring', () {
    final items = [_item(id: 'milk', expiry: _now.add(const Duration(days: 1)))];
    final result = restockSoon(items, _now);
    expect(result, hasLength(1));
    expect(result.first.isExpiring, isTrue);
    expect(result.first.reasons, {RestockReason.expiring});
  });

  test('a null-expiry item is NEVER expiring', () {
    final items = [_item(id: 'flour', qty: 500, unit: 'g')];
    // 500 g is above the low threshold and no expiry → nothing surfaces.
    expect(restockSoon(items, _now), isEmpty);
  });

  group('reorder-due', () {
    test('is due when a REAL cadence + lastBought has elapsed', () {
      final items = [
        _item(
          id: 'coffee',
          qty: 500,
          unit: 'g', // above low threshold — reorder is the ONLY reason
          reorderCadenceDays: 14,
          lastBought: _now.subtract(const Duration(days: 20)),
        ),
      ];
      final result = restockSoon(items, _now);
      expect(result, hasLength(1));
      expect(result.first.isReorderDue, isTrue);
      expect(result.first.reasons, {RestockReason.reorderDue});
    });

    test('is NOT due before the cadence elapses', () {
      final items = [
        _item(
          id: 'coffee',
          qty: 500,
          unit: 'g',
          reorderCadenceDays: 14,
          lastBought: _now.subtract(const Duration(days: 3)),
        ),
      ];
      expect(restockSoon(items, _now), isEmpty);
    });

    test('is due exactly ON the cadence day (boundary)', () {
      final items = [
        _item(
          id: 'coffee',
          qty: 500,
          unit: 'g',
          reorderCadenceDays: 14,
          lastBought: _now.subtract(const Duration(days: 14)),
        ),
      ];
      expect(restockSoon(items, _now).single.isReorderDue, isTrue);
    });

    test('null cadence → NEVER due (no guessed cadence)', () {
      final items = [
        _item(
          id: 'coffee',
          qty: 500,
          unit: 'g',
          lastBought: _now.subtract(const Duration(days: 365)),
        ),
      ];
      expect(restockSoon(items, _now), isEmpty);
    });

    test('null lastBought → NEVER due', () {
      final items = [
        _item(id: 'coffee', qty: 500, unit: 'g', reorderCadenceDays: 14),
      ];
      expect(restockSoon(items, _now), isEmpty);
    });
  });

  test('an item with multiple reasons appears ONCE with all reasons', () {
    final items = [
      _item(
        id: 'yoghurt',
        qty: 30, // low
        unit: 'g',
        expiry: _now.add(const Duration(days: 1)), // expiring
        reorderCadenceDays: 7,
        lastBought: _now.subtract(const Duration(days: 10)), // reorder-due
      ),
    ];
    final result = restockSoon(items, _now);
    expect(result, hasLength(1));
    expect(result.first.reasons, {
      RestockReason.low,
      RestockReason.expiring,
      RestockReason.reorderDue,
    });
  });

  test('ordering: expiring first, then low, then reorder-due', () {
    final items = [
      _item(
        id: 'coffee',
        qty: 500,
        unit: 'g',
        reorderCadenceDays: 7,
        lastBought: _now.subtract(const Duration(days: 10)),
      ), // reorder-due only
      _item(id: 'butter', qty: 20, unit: 'g'), // low only
      _item(id: 'milk', expiry: _now.add(const Duration(days: 1))), // expiring only
    ];
    final result = restockSoon(items, _now);
    expect(result.map((r) => r.item.id).toList(), ['milk', 'butter', 'coffee']);
  });

  test('input list is never mutated', () {
    final items = [
      _item(id: 'milk', expiry: _now.add(const Duration(days: 1))),
      _item(id: 'rice', qty: 900, unit: 'g'),
    ];
    final before = List.of(items);
    restockSoon(items, _now);
    expect(items, orderedEquals(before));
  });
}
