// Tests for NutritionGoalsRepo — singleton persist + Outbox-queued sync.
//
//   • save persists locally AND enqueues a PUT /goals (queued, not failed);
//   • a fresh repo on the SAME store sees the saved goals (survives restart);
//   • the singleton dedupeKey is STABLE — a newer save supersedes the queued one;
//   • an unset target is never written as 0 (honesty via the model's toJson);
//   • concurrent saves don't lose a write (the _synchronized lock).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

class _FakeGoalsStore implements NutritionGoalsStore {
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => _items;
  @override
  Future<void> save(List<PendingMutation> items) async => _items = items;
}

void main() {
  late _FakeGoalsStore store;
  late Outbox outbox;
  late NutritionGoalsRepo repo;

  setUp(() {
    store = _FakeGoalsStore();
    outbox = Outbox(_FakeOutboxStore());
    repo = NutritionGoalsRepo(outbox: outbox, store: store);
  });

  test('load with nothing stored → an empty (all-null) goals object', () async {
    final g = await repo.load();
    expect(g.isEmpty, isTrue);
  });

  test('save persists locally AND enqueues PUT /goals (queued)', () async {
    final outcome = await repo.save(const NutritionGoals(caloriesKcal: 2500));
    expect(outcome, WriteOutcome.queued);

    final loaded = await repo.load();
    expect(loaded.caloriesKcal, 2500);

    final pending = await outbox.pending();
    expect(pending.length, 1);
    expect(pending.first.method, 'PUT');
    expect(pending.first.path, '/goals');
    expect(pending.first.dedupeKey, 'goals');
    // The queued body carries the target and omits the unset ones (no fake 0).
    expect(pending.first.body, {'caloriesKcal': 2500});
  });

  test('a fresh repo on the SAME store sees the saved goals (survives restart)',
      () async {
    await repo.save(const NutritionGoals(proteinG: 150));
    final fresh = NutritionGoalsRepo(outbox: outbox, store: store);
    expect((await fresh.load()).proteinG, 150);
  });

  test('the singleton dedupeKey collapses to the latest save', () async {
    await repo.save(const NutritionGoals(caloriesKcal: 2000));
    await repo.save(const NutritionGoals(caloriesKcal: 2600));

    final pending = await outbox.pending();
    // One entry (deduped on the stable 'goals' key) — the latest snapshot.
    expect(pending.length, 1);
    expect(pending.single.body, {'caloriesKcal': 2600});
  });

  test('concurrent saves both complete — no lost write (the _synchronized lock)',
      () async {
    await Future.wait([
      repo.save(const NutritionGoals(caloriesKcal: 2000)),
      repo.save(const NutritionGoals(caloriesKcal: 2600)),
    ]);
    // A value is persisted (last writer wins) and nothing throws / deadlocks.
    final loaded = await repo.load();
    expect(loaded.caloriesKcal, anyOf(2000, 2600));
  });
}
