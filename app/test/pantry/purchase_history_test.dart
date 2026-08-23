// Tests for the honest reorder-cadence learner's PURE maths + data layer.
//
// Honesty contract:
//  • computeCadenceDays: <2 buys → null (never a guessed cadence); the median of
//    consecutive-buy gaps for ≥2; zero-day / same-day gaps ignored.
//  • PurchaseHistory: lastBought is the real most-recent timestamp; cadenceDays
//    mirrors computeCadenceDays; append is immutable + honest.
//  • PurchaseHistoryRepo: append-only persistence; blank name is a no-op (never
//    keyed on nothing); round-trips through the store.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/purchase_history.dart';

// ── In-memory fake PurchaseHistoryStore ──────────────────────────────────────

class FakePurchaseHistoryStore implements PurchaseHistoryStore {
  List<PurchaseHistory> _items = [];

  @override
  Future<List<PurchaseHistory>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PurchaseHistory> histories) async {
    _items = List.of(histories);
  }
}

DateTime _d(int y, int m, int day) => DateTime(y, m, day);

void main() {
  group('normalizePurchaseKey', () {
    test('trims, lower-cases, collapses inner whitespace', () {
      expect(normalizePurchaseKey('  Chicken   Breast '), 'chicken breast');
      expect(normalizePurchaseKey('MILK'), 'milk');
      expect(normalizePurchaseKey('Rice'), 'rice');
    });

    test('a blank / whitespace-only name is not a usable identity → null', () {
      expect(normalizePurchaseKey(''), isNull);
      expect(normalizePurchaseKey('   '), isNull);
      expect(normalizePurchaseKey('\t\n'), isNull);
    });

    test('two names normalise equal → the SAME identity', () {
      expect(
        normalizePurchaseKey('Chicken breast'),
        normalizePurchaseKey('  chicken   BREAST '),
      );
    });
  });

  group('computeCadenceDays — honest cadence only from ≥2 real buys', () {
    test('no purchases → null (nothing to learn)', () {
      expect(computeCadenceDays(const []), isNull);
    });

    test('a single buy → null (never a guessed cadence)', () {
      expect(computeCadenceDays([_d(2026, 1, 1)]), isNull);
    });

    test('two buys 7 days apart → 7', () {
      expect(computeCadenceDays([_d(2026, 1, 1), _d(2026, 1, 8)]), 7);
    });

    test('order-independent — the same two buys reversed → 7', () {
      expect(computeCadenceDays([_d(2026, 1, 8), _d(2026, 1, 1)]), 7);
    });

    test('three buys with gaps (7, 7) → 7', () {
      expect(
        computeCadenceDays([_d(2026, 1, 1), _d(2026, 1, 8), _d(2026, 1, 15)]),
        7,
      );
    });

    test('irregular gaps → the MEDIAN, not the mean (robust to a one-off)', () {
      // Gaps: 7, 7, 30. Mean would be ~14.7; median is 7 (the stray 30-day
      // holiday gap does not skew the learned cadence).
      final buys = [
        _d(2026, 1, 1),
        _d(2026, 1, 8),
        _d(2026, 1, 15),
        _d(2026, 2, 14),
      ];
      expect(computeCadenceDays(buys), 7);
    });

    test('even number of gaps → mean of the two middle gaps, rounded', () {
      // Gaps: 4, 6, 10, 20 → middle two are 6 and 10 → (6+10)/2 = 8.
      final buys = [
        _d(2026, 1, 1),
        _d(2026, 1, 5), // +4
        _d(2026, 1, 11), // +6
        _d(2026, 1, 21), // +10
        _d(2026, 2, 10), // +20
      ];
      expect(computeCadenceDays(buys), 8);
    });

    test('even gaps rounding — (5+8)/2 = 6.5 rounds to 7', () {
      // Gaps: 3, 5, 8, 12 → middle two 5 and 8 → 6.5 → 7.
      final buys = [
        _d(2026, 1, 1),
        _d(2026, 1, 4), // +3
        _d(2026, 1, 9), // +5
        _d(2026, 1, 17), // +8
        _d(2026, 1, 29), // +12
      ];
      expect(computeCadenceDays(buys), 7);
    });

    test('same-day / zero-day gaps are IGNORED (no fabricated 0-day cadence)',
        () {
      // Two buys on the SAME day → the only gap is 0 → ignored → no real
      // interval remains → null (never a 0-day "always due" cadence).
      expect(
        computeCadenceDays([_d(2026, 1, 1), _d(2026, 1, 1)]),
        isNull,
      );
    });

    test('a same-day duplicate among real buys is dropped from the gaps', () {
      // Buys: Jan 1, Jan 1 (dup), Jan 8 → gaps 0 (dropped), 7 → cadence 7.
      final buys = [_d(2026, 1, 1), _d(2026, 1, 1), _d(2026, 1, 8)];
      expect(computeCadenceDays(buys), 7);
    });

    test('cadence is always a positive whole number', () {
      final c = computeCadenceDays([_d(2026, 1, 1), _d(2026, 1, 4)]);
      expect(c, isNotNull);
      expect(c! >= 1, isTrue);
    });

    test('does not mutate its input', () {
      final buys = [_d(2026, 1, 8), _d(2026, 1, 1)];
      final copy = [...buys];
      computeCadenceDays(buys);
      expect(buys, copy); // unchanged order
    });
  });

  group('PurchaseHistory', () {
    test('lastBought is the real most-recent timestamp (order-agnostic)', () {
      final h = PurchaseHistory(
        key: 'milk',
        timestamps: [_d(2026, 1, 8), _d(2026, 1, 1), _d(2026, 1, 15)],
      );
      expect(h.lastBought, _d(2026, 1, 15));
    });

    test('empty history → null lastBought + null cadence (honest empty)', () {
      const h = PurchaseHistory(key: 'milk', timestamps: []);
      expect(h.lastBought, isNull);
      expect(h.cadenceDays, isNull);
    });

    test('one buy → null cadence, real lastBought', () {
      final h = PurchaseHistory(key: 'milk', timestamps: [_d(2026, 1, 1)]);
      expect(h.cadenceDays, isNull);
      expect(h.lastBought, _d(2026, 1, 1));
    });

    test('cadenceDays mirrors computeCadenceDays', () {
      final h = PurchaseHistory(
        key: 'milk',
        timestamps: [_d(2026, 1, 1), _d(2026, 1, 8)],
      );
      expect(h.cadenceDays, 7);
    });

    test('withAcquisition appends immutably', () {
      final h = PurchaseHistory(key: 'milk', timestamps: [_d(2026, 1, 1)]);
      final h2 = h.withAcquisition(_d(2026, 1, 8));
      expect(h.timestamps, hasLength(1)); // original untouched
      expect(h2.timestamps, hasLength(2));
      expect(h2.cadenceDays, 7);
    });

    test('round-trips through JSON', () {
      final h = PurchaseHistory(
        key: 'chicken breast',
        timestamps: [_d(2026, 1, 1), _d(2026, 1, 8)],
      );
      final back = PurchaseHistory.fromJson(h.toJson());
      expect(back.key, 'chicken breast');
      expect(back.timestamps, hasLength(2));
      expect(back.cadenceDays, 7);
    });

    test('tryFromJson returns null for a corrupt entry (missing/blank key)', () {
      expect(PurchaseHistory.tryFromJson({'ts': <String>[]}), isNull);
      expect(PurchaseHistory.tryFromJson({'key': '', 'ts': <String>[]}), isNull);
      expect(PurchaseHistory.tryFromJson({'key': 42}), isNull);
      // A valid entry still parses.
      final ok = PurchaseHistory.tryFromJson({
        'key': 'milk',
        'ts': [_d(2026, 1, 1).toIso8601String()],
      });
      expect(ok, isNotNull);
      expect(ok!.timestamps, hasLength(1));
    });
  });

  group('PurchaseHistoryRepo — append-only real log', () {
    test('records an acquisition under the normalized key', () async {
      final store = FakePurchaseHistoryStore();
      final repo = PurchaseHistoryRepo(store: store);

      final h = await repo.recordAcquisition('  Milk ', _d(2026, 1, 1));
      expect(h.key, 'milk');
      expect(h.timestamps, [_d(2026, 1, 1)]);

      // Persisted to the store, not just returned.
      final persisted = await store.load();
      expect(persisted.single.key, 'milk');
    });

    test('two acquisitions of the same item (normalized) merge into one history',
        () async {
      final repo = PurchaseHistoryRepo(store: FakePurchaseHistoryStore());
      await repo.recordAcquisition('Milk', _d(2026, 1, 1));
      await repo.recordAcquisition('  milk  ', _d(2026, 1, 8));

      final h = await repo.forName('MILK');
      expect(h.timestamps, hasLength(2));
      expect(h.cadenceDays, 7); // learned from the two REAL buys
      expect(h.lastBought, _d(2026, 1, 8));
    });

    test('different items get separate histories', () async {
      final repo = PurchaseHistoryRepo(store: FakePurchaseHistoryStore());
      await repo.recordAcquisition('Milk', _d(2026, 1, 1));
      await repo.recordAcquisition('Eggs', _d(2026, 1, 1));
      expect((await repo.all()), hasLength(2));
      expect((await repo.forName('Milk')).timestamps, hasLength(1));
      expect((await repo.forName('Eggs')).timestamps, hasLength(1));
    });

    test('a blank name is a no-op — never keyed on nothing', () async {
      final store = FakePurchaseHistoryStore();
      final repo = PurchaseHistoryRepo(store: store);
      final h = await repo.recordAcquisition('   ', _d(2026, 1, 1));
      expect(h.timestamps, isEmpty);
      expect(await store.load(), isEmpty); // nothing persisted
    });

    test('forName on an unknown item → empty history (never fabricated)',
        () async {
      final repo = PurchaseHistoryRepo(store: FakePurchaseHistoryStore());
      final h = await repo.forName('Ghost');
      expect(h.timestamps, isEmpty);
      expect(h.cadenceDays, isNull);
    });

    test('rapid concurrent records are all kept (append-only, none lost)',
        () async {
      final repo = PurchaseHistoryRepo(store: FakePurchaseHistoryStore());
      await Future.wait([
        repo.recordAcquisition('Milk', _d(2026, 1, 1)),
        repo.recordAcquisition('Milk', _d(2026, 1, 8)),
        repo.recordAcquisition('Milk', _d(2026, 1, 15)),
      ]);
      final h = await repo.forName('Milk');
      expect(h.timestamps, hasLength(3));
    });
  });
}
