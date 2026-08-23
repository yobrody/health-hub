// Tests for MealPlanRepo — singleton persist + Outbox-queued sync.
//
//   • save persists locally AND enqueues a PUT /meal-plan (queued, not failed);
//   • a fresh repo on the SAME store sees the saved plan (survives restart);
//   • the singleton dedupeKey is STABLE — a newer plan supersedes the queued one;
//   • load with nothing stored → null (the honest "no plan yet" empty state).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/food_log_entry.dart' show AccuracyTier;
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/nutrition/plan/meal_plan_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

class _FakeMealPlanStore implements MealPlanStore {
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
  @override
  Future<void> clear() async => _saved = null;
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => _items;
  @override
  Future<void> save(List<PendingMutation> items) async => _items = items;
}

MealPlan _plan({String id = 'plan-1', String name = 'Oats'}) => MealPlan(
      id: id,
      weekStart: DateTime(2026, 8, 24),
      days: [
        PlanDay(date: DateTime(2026, 8, 24), meals: [
          PlanMeal(
            name: name,
            slot: MealSlot.breakfast,
            tier: AccuracyTier.estimate,
            ingredients: const [PlanIngredient(name: 'Oats', grams: 60)],
            kcal: 420,
          ),
        ]),
      ],
    );

void main() {
  late _FakeMealPlanStore store;
  late Outbox outbox;
  late MealPlanRepo repo;

  setUp(() {
    store = _FakeMealPlanStore();
    outbox = Outbox(_FakeOutboxStore());
    repo = MealPlanRepo(outbox: outbox, store: store);
  });

  test('load with nothing stored → null (honest "no plan yet")', () async {
    expect(await repo.load(), isNull);
  });

  test('save persists locally AND enqueues PUT /meal-plan (queued)', () async {
    final outcome = await repo.save(_plan());
    expect(outcome, WriteOutcome.queued);

    final loaded = await repo.load();
    expect(loaded, isNotNull);
    expect(loaded!.days.single.meals.single.name, 'Oats');

    final pending = await outbox.pending();
    expect(pending.length, 1);
    expect(pending.first.method, 'PUT');
    expect(pending.first.path, '/meal-plan');
    expect(pending.first.dedupeKey, 'meal-plan');
  });

  test('a fresh repo on the SAME store sees the saved plan (survives restart)',
      () async {
    await repo.save(_plan(name: 'Chicken & rice'));
    final fresh = MealPlanRepo(outbox: outbox, store: store);
    final loaded = await fresh.load();
    expect(loaded!.days.single.meals.single.name, 'Chicken & rice');
  });

  test('the singleton dedupeKey is STABLE — a newer plan supersedes the queued '
      'one', () async {
    await repo.save(_plan(id: 'plan-a', name: 'First'));
    await repo.save(_plan(id: 'plan-b', name: 'Second'));

    final pending = await outbox.pending();
    expect(pending.length, 1); // collapsed to the latest snapshot.
    expect((pending.first.body!['days'] as List), hasLength(1));
    final meal = ((pending.first.body!['days'] as List).first
        as Map)['meals'] as List;
    expect((meal.first as Map)['name'], 'Second');
  });
}
