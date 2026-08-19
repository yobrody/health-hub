// Tests for NutritionRepo (P2-T1).
//
// Contract (mirrors PantryRepo):
//  • add/update/delete ALL persist locally AND enqueue a PendingMutation via the
//    shared Outbox → a queued-success outcome, never "failed".
//  • logsForDay filters by LOCAL calendar date.
//  • An eating-out entry carries spendGbp and there is NO pantry interaction —
//    the repo has no pantry dependency at all (pantry-agnostic by construction).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

// ── In-memory fakes (mirror the other repo tests) ────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

class FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> _items = [];

  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<FoodLogEntry> items) async {
    _items = List.of(items);
  }
}

NutritionRepo buildRepo({
  FakeOutboxStore? outboxStore,
  FakeNutritionStore? store,
}) {
  return NutritionRepo(
    outbox: Outbox(outboxStore ?? FakeOutboxStore()),
    store: store ?? FakeNutritionStore(),
  );
}

FoodLogEntry entry(
  String id, {
  DateTime? at,
  bool ateOut = false,
  String? restaurant,
  double? spendGbp,
  AccuracyTier tier = AccuracyTier.exact,
}) {
  return FoodLogEntry(
    id: id,
    name: id,
    at: at ?? DateTime(2026, 8, 19, 12),
    tier: tier,
    ateOut: ateOut,
    restaurant: restaurant,
    spendGbp: spendGbp,
    source: 'manual',
  );
}

void main() {
  group('NutritionRepo.add', () {
    test('persists locally and appears in all()', () async {
      final store = FakeNutritionStore();
      final repo = buildRepo(store: store);
      await repo.add(entry('a1'));
      final all = await repo.all();
      expect(all, hasLength(1));
      expect(all.first.id, 'a1');
      expect((await store.load()).single.id, 'a1');
    });

    test('enqueues a POST /nutrition mutation (queued, not failed)', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = NutritionRepo(outbox: outbox, store: FakeNutritionStore());

      final outcome = await repo.add(entry('a2'));

      expect(outcome, WriteOutcome.queued);
      expect(outcome, isNot(WriteOutcome.failed));
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.first.method, 'POST');
      expect(pending.first.path, '/nutrition');
      expect(pending.first.dedupeKey, 'nutrition:a2');
      expect(pending.first.body!['id'], 'a2');
    });
  });

  group('NutritionRepo.update', () {
    test('replaces the entry and enqueues PUT /nutrition/{id}', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = NutritionRepo(outbox: outbox, store: FakeNutritionStore());
      await repo.add(entry('a1'));

      final outcome = await repo.update(entry('a1').copyWith(kcal: 200));

      expect(outcome, WriteOutcome.queued);
      expect((await repo.all()).single.kcal, 200);
      final pending = await outbox.pending();
      // add + update share the same dedupeKey → deduped to the latest.
      expect(pending, hasLength(1));
      expect(pending.first.method, 'PUT');
      expect(pending.first.path, '/nutrition/a1');
      expect(pending.first.body!['kcal'], 200);
    });
  });

  group('NutritionRepo.delete', () {
    test('removes the entry and enqueues DELETE /nutrition/{id}', () async {
      final outbox = Outbox(FakeOutboxStore());
      final repo = NutritionRepo(outbox: outbox, store: FakeNutritionStore());
      await repo.add(entry('a1'));

      final outcome = await repo.delete('a1');

      expect(outcome, WriteOutcome.queued);
      expect(await repo.all(), isEmpty);
      final pending = await outbox.pending();
      expect(pending.single.method, 'DELETE');
      expect(pending.single.path, '/nutrition/a1');
      expect(pending.single.body, isNull);
    });
  });

  group('NutritionRepo.logsForDay — local-date filter', () {
    test('returns only entries on the same local calendar day', () async {
      final repo = buildRepo();
      await repo.add(entry('morning', at: DateTime(2026, 8, 19, 8)));
      await repo.add(entry('night', at: DateTime(2026, 8, 19, 23, 59)));
      await repo.add(entry('nextday', at: DateTime(2026, 8, 20, 0, 1)));
      await repo.add(entry('prevday', at: DateTime(2026, 8, 18, 12)));

      final day = repo.logsForDay(
        await repo.all(),
        DateTime(2026, 8, 19),
      );
      expect(day.map((e) => e.id).toSet(), {'morning', 'night'});
    });

    test('uses local date components (not UTC) at a day boundary', () async {
      // An entry logged at local 00:30 on the 19th belongs to the 19th even
      // though its UTC instant may fall on the 18th for negative offsets.
      final repo = buildRepo();
      final localEarly = DateTime(2026, 8, 19, 0, 30);
      await repo.add(entry('early', at: localEarly));
      final day = repo.logsForDay(await repo.all(), DateTime(2026, 8, 19));
      expect(day.map((e) => e.id), ['early']);
    });
  });

  group('NutritionRepo — eating-out is pantry-agnostic', () {
    test('an eating-out entry carries spend and queues with no pantry dep',
        () async {
      final outbox = Outbox(FakeOutboxStore());
      final store = FakeNutritionStore();
      // Constructed with ONLY an outbox + a nutrition store — there is no
      // pantry parameter to pass, which is the whole point: the repo cannot
      // deduct from the pantry because it has no reference to it.
      final repo = NutritionRepo(outbox: outbox, store: store);

      final outcome = await repo.add(entry(
        'restaurant-meal',
        ateOut: true,
        restaurant: 'The Grill',
        spendGbp: 28.5,
      ));

      expect(outcome, WriteOutcome.queued);
      final saved = (await repo.all()).single;
      expect(saved.ateOut, isTrue);
      expect(saved.spendGbp, 28.5);
      expect(saved.restaurant, 'The Grill');
      // The queued body carries the spend for the backend; nothing pantry-side.
      final pending = await outbox.pending();
      expect(pending.single.body!['ateOut'], isTrue);
      expect(pending.single.body!['spendGbp'], 28.5);
    });
  });
}
