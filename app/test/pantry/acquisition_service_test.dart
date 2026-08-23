// Tests for AcquisitionService — the WRITE half of the honest reorder-cadence
// learner, PLUS an end-to-end check that a learned cadence makes restockSoon
// surface an item as reorder-due organically.
//
// Honesty contract:
//  • After 1 real buy: the pantry item's reorderCadenceDays + lastBought stay
//    null → reorder-due NEVER fires (no guessed cadence/urgency).
//  • After ≥2 real buys of a MATCHING pantry item: a real cadence + lastBought
//    get stamped, so restockSoon surfaces reorder-due when due.
//  • Identity is the conservative normalized-name rule; a buy with no matching
//    pantry item records history honestly but fabricates no pantry item.
//  • Only a real acquisition ever calls recordAcquisition (edits do not — that's
//    enforced at the call sites, exercised in the widget/e2e suites).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/acquisition_service.dart';
import 'package:health_hub/pantry/pantry_glance.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/pantry/purchase_history.dart';

// ── In-memory fakes ──────────────────────────────────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class FakePantryStore implements PantryStore {
  List<PantryItem> _items = [];
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
}

class FakePurchaseHistoryStore implements PurchaseHistoryStore {
  List<PurchaseHistory> _items = [];
  @override
  Future<List<PurchaseHistory>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PurchaseHistory> h) async => _items = List.of(h);
}

DateTime _d(int y, int m, int day) => DateTime(y, m, day);

({
  AcquisitionService service,
  PantryRepo pantry,
}) build() {
  final pantry = PantryRepo(
    outbox: Outbox(FakeOutboxStore()),
    store: FakePantryStore(),
  );
  final history = PurchaseHistoryRepo(store: FakePurchaseHistoryStore());
  return (
    service: AcquisitionService(historyRepo: history, pantryRepo: pantry),
    pantry: pantry,
  );
}

const _milk = PantryItem(
  id: 'milk-1',
  name: 'Milk',
  zone: PantryZone.fridge,
  source: 'manual',
);

void main() {
  group('AcquisitionService.recordAcquisition — honest stamping', () {
    test('after ONE real buy, the item stays null (no guessed cadence)',
        () async {
      final env = build();
      await env.pantry.add(_milk);

      final out = await env.service.recordAcquisition('Milk', _d(2026, 1, 1));

      // History records the one real buy...
      expect(out.history.timestamps, hasLength(1));
      // ...but nothing is stamped onto the pantry item — cadence stays null.
      expect(out.updatedItem, isNull);
      expect(out.writeOutcome, isNull);
      final item = (await env.pantry.all()).single;
      expect(item.reorderCadenceDays, isNull);
      expect(item.lastBought, isNull);
    });

    test('after TWO real buys, a REAL cadence + lastBought get stamped',
        () async {
      final env = build();
      await env.pantry.add(_milk);

      await env.service.recordAcquisition('Milk', _d(2026, 1, 1));
      final out = await env.service.recordAcquisition('Milk', _d(2026, 1, 8));

      expect(out.updatedItem, isNotNull);
      expect(out.writeOutcome, WriteOutcome.queued);
      expect(out.writeOutcome, isNot(WriteOutcome.failed));

      final item = (await env.pantry.all()).single;
      expect(item.reorderCadenceDays, 7); // learned from the two real buys
      expect(item.lastBought, _d(2026, 1, 8)); // real most-recent acquisition
    });

    test('identity matches by normalized name (case/whitespace-insensitive)',
        () async {
      final env = build();
      await env.pantry.add(_milk); // name "Milk"

      await env.service.recordAcquisition('  milk ', _d(2026, 1, 1));
      await env.service.recordAcquisition('MILK', _d(2026, 1, 6));

      final item = (await env.pantry.all()).single;
      expect(item.reorderCadenceDays, 5);
      expect(item.lastBought, _d(2026, 1, 6));
    });

    test('a buy with NO matching pantry item records history but fabricates '
        'no pantry item', () async {
      final env = build();
      // Pantry is empty; two buys of "Bananas" with nothing on the shelf.
      await env.service.recordAcquisition('Bananas', _d(2026, 1, 1));
      final out = await env.service.recordAcquisition('Bananas', _d(2026, 1, 4));

      // History is kept honestly (cadence learnable for next time)...
      expect(out.history.timestamps, hasLength(2));
      expect(out.history.cadenceDays, 3);
      // ...but no pantry item was invented.
      expect(out.updatedItem, isNull);
      expect(await env.pantry.all(), isEmpty);
    });

    test('a blank name is a no-op — nothing recorded or stamped', () async {
      final env = build();
      await env.pantry.add(_milk);
      final out = await env.service.recordAcquisition('   ', _d(2026, 1, 1));
      expect(out.history.timestamps, isEmpty);
      expect(out.updatedItem, isNull);
      expect((await env.pantry.all()).single.reorderCadenceDays, isNull);
    });

    test('same-day double buy does NOT fabricate a 0-day cadence', () async {
      final env = build();
      await env.pantry.add(_milk);
      await env.service.recordAcquisition('Milk', _d(2026, 1, 1));
      final out = await env.service.recordAcquisition('Milk', _d(2026, 1, 1));
      // Two buys, but the only gap is 0 → ignored → no honest cadence yet.
      expect(out.updatedItem, isNull);
      expect((await env.pantry.all()).single.reorderCadenceDays, isNull);
    });
  });

  group('End-to-end — learned cadence drives restockSoon reorder-due', () {
    test('after ≥2 real buys, restockSoon surfaces the item as reorder-due '
        'once due', () async {
      final env = build();
      await env.pantry.add(_milk);

      // Two REAL buys, 7 days apart. lastBought becomes Jan 8, cadence 7.
      await env.service.recordAcquisition('Milk', _d(2026, 1, 1));
      await env.service.recordAcquisition('Milk', _d(2026, 1, 8));

      final items = await env.pantry.all();

      // Not yet due (6 days after the last buy, cadence 7) → NOT surfaced.
      final notDue = restockSoon(items, _d(2026, 1, 14));
      expect(notDue, isEmpty);

      // Due exactly on the cadence day (7 days after Jan 8) → surfaced.
      final due = restockSoon(items, _d(2026, 1, 15));
      expect(due, hasLength(1));
      expect(due.single.item.id, 'milk-1');
      expect(due.single.isReorderDue, isTrue);

      // Still due afterwards.
      final overdue = restockSoon(items, _d(2026, 1, 20));
      expect(overdue.single.isReorderDue, isTrue);
    });

    test('with only ONE real buy, restockSoon NEVER surfaces reorder-due',
        () async {
      final env = build();
      await env.pantry.add(_milk);
      await env.service.recordAcquisition('Milk', _d(2026, 1, 1));

      final items = await env.pantry.all();
      // Far in the future — no cadence exists, so it can never be reorder-due.
      final r = restockSoon(items, _d(2027, 1, 1));
      expect(r, isEmpty);
    });
  });
}
