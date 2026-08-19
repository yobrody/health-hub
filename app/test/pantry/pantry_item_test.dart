// Tests for PantryItem (P1-T2).
//
// Honesty contract mirrors Profile:
//  • toJson OMITS every null field — an item with only id+name+zone emits no
//    qty/unit/expiry/etc. Nothing is fabricated.
//  • fromJson round-trips including nulls and ISO-8601 dates.
//  • ownerId/shared are the social seam: default ownerId null, shared false.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/pantry_item.dart';

void main() {
  group('PantryItem.toJson — omits null fields', () {
    test('a minimal item (id+name+zone+source) emits only those keys', () {
      const item = PantryItem(
        id: 'a1',
        name: 'Eggs',
        zone: PantryZone.fridge,
        source: 'manual',
      );
      final json = item.toJson();

      expect(json['id'], 'a1');
      expect(json['name'], 'Eggs');
      expect(json['zone'], 'fridge');
      expect(json['source'], 'manual');
      // shared defaults false and is always emitted (a real boolean value).
      expect(json['shared'], false);

      // Every unknown field is OMITTED — not present, not a fabricated default.
      expect(json.containsKey('qty'), isFalse);
      expect(json.containsKey('unit'), isFalse);
      expect(json.containsKey('expiry'), isFalse);
      expect(json.containsKey('priceGbp'), isFalse);
      expect(json.containsKey('store'), isFalse);
      expect(json.containsKey('purchasedAt'), isFalse);
      expect(json.containsKey('reorderCadenceDays'), isFalse);
      expect(json.containsKey('lastBought'), isFalse);
      expect(json.containsKey('ownerId'), isFalse);
      // No fabricated zero qty.
      expect(json.values, isNot(contains(0)));
    });

    test('dates serialise as ISO-8601 strings', () {
      final item = PantryItem(
        id: 'b2',
        name: 'Milk',
        zone: PantryZone.fridge,
        source: 'scan',
        expiry: DateTime(2026, 8, 25),
        purchasedAt: DateTime(2026, 8, 18, 9, 30),
        lastBought: DateTime(2026, 8, 18),
      );
      final json = item.toJson();
      expect(json['expiry'], DateTime(2026, 8, 25).toIso8601String());
      expect(json['purchasedAt'], DateTime(2026, 8, 18, 9, 30).toIso8601String());
      expect(json['lastBought'], DateTime(2026, 8, 18).toIso8601String());
    });
  });

  group('PantryItem.fromJson — round-trips', () {
    test('a fully-populated item round-trips exactly', () {
      final item = PantryItem(
        id: 'c3',
        name: 'Chicken breast',
        zone: PantryZone.freezer,
        qty: 500,
        unit: 'g',
        expiry: DateTime(2026, 11, 1),
        priceGbp: 4.50,
        store: 'Tesco',
        purchasedAt: DateTime(2026, 8, 3),
        reorderCadenceDays: 7,
        lastBought: DateTime(2026, 8, 3),
        source: 'manual',
        ownerId: 'brody',
        shared: true,
      );
      final round = PantryItem.fromJson(item.toJson());

      expect(round.id, 'c3');
      expect(round.name, 'Chicken breast');
      expect(round.zone, PantryZone.freezer);
      expect(round.qty, 500);
      expect(round.unit, 'g');
      expect(round.expiry, DateTime(2026, 11, 1));
      expect(round.priceGbp, 4.50);
      expect(round.store, 'Tesco');
      expect(round.purchasedAt, DateTime(2026, 8, 3));
      expect(round.reorderCadenceDays, 7);
      expect(round.lastBought, DateTime(2026, 8, 3));
      expect(round.source, 'manual');
      expect(round.ownerId, 'brody');
      expect(round.shared, isTrue);
    });

    test('a minimal item round-trips with nulls preserved (no fabrication)', () {
      const item = PantryItem(
        id: 'd4',
        name: 'Salt',
        zone: PantryZone.condiments,
        source: 'manual',
      );
      final round = PantryItem.fromJson(item.toJson());

      expect(round.qty, isNull);
      expect(round.unit, isNull);
      expect(round.expiry, isNull);
      expect(round.priceGbp, isNull);
      expect(round.store, isNull);
      expect(round.purchasedAt, isNull);
      expect(round.reorderCadenceDays, isNull);
      expect(round.lastBought, isNull);
      expect(round.ownerId, isNull); // social seam default
      expect(round.shared, isFalse); // social seam default
    });

    test('social seam defaults: absent ownerId/shared → null / false', () {
      // Simulate JSON from a source that predates the social fields.
      final round = PantryItem.fromJson({
        'id': 'e5',
        'name': 'Butter',
        'zone': 'fridge',
        'source': 'scan',
      });
      expect(round.ownerId, isNull);
      expect(round.shared, isFalse);
    });

    test('each zone string round-trips', () {
      for (final zone in PantryZone.values) {
        final item = PantryItem(
          id: 'z',
          name: 'x',
          zone: zone,
          source: 'manual',
        );
        expect(PantryItem.fromJson(item.toJson()).zone, zone);
      }
    });
  });

  group('PantryItem.copyWith', () {
    test('overrides only the given fields', () {
      const item = PantryItem(
        id: 'f6',
        name: 'Rice',
        zone: PantryZone.pantry,
        qty: 1000,
        unit: 'g',
        source: 'manual',
      );
      final updated = item.copyWith(qty: 750);
      expect(updated.qty, 750);
      expect(updated.name, 'Rice');
      expect(updated.unit, 'g');
      expect(updated.zone, PantryZone.pantry);
    });
  });
}
