// Tests for SupabaseHydrator — login-time pull of the user's rows into the
// local stores (P4-D3).
//
// Driven entirely by a FakeSupabaseWriter (seeded rows) + in-memory stores: no
// real Supabase.instance, no network. Guarantees under test:
//   • aggregates are rebuilt from each row's `data` jsonb via fromJson and
//     written into the matching local store;
//   • the profile singleton is rebuilt from its flat columns (Profile.fromJson
//     keys) and saved;
//   • a FAILED pull (writer throws) leaves the local cache INTACT — no wipe;
//   • an empty pull leaves local intact (doesn't clear existing data);
//   • a corrupt/dataless row is skipped, not fabricated.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/cart/grocery_item.dart';
import 'package:health_hub/cart/grocery_list_repo.dart' show GroceryListStore;
import 'package:health_hub/gym/workout_repo.dart' show WorkoutStore;
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart' show WeighInStore;
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart'
    show NutritionGoalsStore;
import 'package:health_hub/nutrition/nutrition_repo.dart' show NutritionStore;
import 'package:health_hub/nutrition/plan/meal_plan_repo.dart'
    show MealPlanStore;
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart' show PantryStore;
import 'package:health_hub/profile/profile_repo.dart' show ProfileStore;
import 'package:health_hub/sync/supabase_hydrator.dart';
import 'package:health_hub/sync/supabase_writer.dart';

class FakeSupabaseWriter implements SupabaseWriter {
  final Map<String, List<Map<String, dynamic>>> _tables = {};
  final Set<String> throwOnSelect = {};

  void seed(String table, List<Map<String, dynamic>> rows) =>
      _tables[table] = rows;

  @override
  Future<void> upsert(String table, Map<String, dynamic> row,
          {required String onConflict}) async =>
      throw UnimplementedError();

  @override
  Future<void> deleteById(String table,
          {required String idColumn, required String idValue}) async =>
      throw UnimplementedError();

  @override
  Future<List<Map<String, dynamic>>> selectAll(String table) async {
    if (throwOnSelect.contains(table)) throw StateError('pull failed');
    return _tables[table] ?? const [];
  }
}

class FakeProfileStore implements ProfileStore {
  Map<String, dynamic>? saved;
  FakeProfileStore([this.saved]);
  @override
  Future<Map<String, dynamic>?> load() async => saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      saved = Map<String, dynamic>.from(json);
}

class FakePantryStore implements PantryStore {
  List<PantryItem> items;
  FakePantryStore([this.items = const []]);
  @override
  Future<List<PantryItem>> load() async => items;
  @override
  Future<void> save(List<PantryItem> next) async => items = List.of(next);
}

class FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> entries;
  FakeNutritionStore([this.entries = const []]);
  @override
  Future<List<FoodLogEntry>> load() async => entries;
  @override
  Future<void> save(List<FoodLogEntry> next) async => entries = List.of(next);
}

class FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> sessions;
  FakeWorkoutStore([this.sessions = const []]);
  @override
  Future<List<WorkoutSession>> load() async => sessions;
  @override
  Future<void> save(List<WorkoutSession> next) async => sessions = List.of(next);
}

class FakeGoalsStore implements NutritionGoalsStore {
  Map<String, dynamic>? saved;
  FakeGoalsStore([this.saved]);
  @override
  Future<Map<String, dynamic>?> load() async => saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      saved = Map<String, dynamic>.from(json);
}

class FakeWeighInStore implements WeighInStore {
  List<WeighIn> items;
  FakeWeighInStore([this.items = const []]);
  @override
  Future<List<WeighIn>> load() async => items;
  @override
  Future<void> save(List<WeighIn> next) async => items = List.of(next);
}

class FakeGroceryStore implements GroceryListStore {
  List<GroceryItem> items;
  FakeGroceryStore([this.items = const []]);
  @override
  Future<List<GroceryItem>> load() async => items;
  @override
  Future<void> save(List<GroceryItem> next) async => items = List.of(next);
}

class FakeMealPlanStore implements MealPlanStore {
  Map<String, dynamic>? saved;
  FakeMealPlanStore([this.saved]);
  @override
  Future<Map<String, dynamic>?> load() async => saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      saved = Map<String, dynamic>.from(json);
  @override
  Future<void> clear() async => saved = null;
}

({
  SupabaseHydrator hydrator,
  FakeProfileStore profile,
  FakePantryStore pantry,
  FakeNutritionStore nutrition,
  FakeWorkoutStore workout,
  FakeGoalsStore goals,
  FakeWeighInStore weighIns,
  FakeGroceryStore grocery,
  FakeMealPlanStore mealPlan,
}) _build(
  FakeSupabaseWriter writer, {
  FakeProfileStore? profile,
  FakePantryStore? pantry,
  FakeNutritionStore? nutrition,
  FakeWorkoutStore? workout,
  FakeGoalsStore? goals,
  FakeWeighInStore? weighIns,
  FakeGroceryStore? grocery,
  FakeMealPlanStore? mealPlan,
}) {
  final p = profile ?? FakeProfileStore();
  final pa = pantry ?? FakePantryStore();
  final n = nutrition ?? FakeNutritionStore();
  final w = workout ?? FakeWorkoutStore();
  final g = goals ?? FakeGoalsStore();
  final wi = weighIns ?? FakeWeighInStore();
  final gr = grocery ?? FakeGroceryStore();
  final mp = mealPlan ?? FakeMealPlanStore();
  return (
    hydrator: SupabaseHydrator(
      writer: writer,
      profileStore: p,
      pantryStore: pa,
      nutritionStore: n,
      workoutStore: w,
      goalsStore: g,
      weighInStore: wi,
      groceryStore: gr,
      mealPlanStore: mp,
    ),
    profile: p,
    pantry: pa,
    nutrition: n,
    workout: w,
    goals: g,
    weighIns: wi,
    grocery: gr,
    mealPlan: mp,
  );
}

void main() {
  test('rebuilds aggregates from data jsonb into the local stores', () async {
    final writer = FakeSupabaseWriter()
      ..seed('pantry_items', [
        {
          'id': 'item-1',
          'user_id': 'u1',
          'data': {
            'id': 'item-1',
            'name': 'Eggs',
            'zone': 'fridge',
            'qty': 6.0,
            'source': 'manual',
            'shared': false,
          },
        }
      ])
      ..seed('food_log_entries', [
        {
          'id': 'food-1',
          'user_id': 'u1',
          'data': {
            'id': 'food-1',
            'name': 'Coffee',
            'at': '2026-08-21T08:00:00.000',
            'kcal': 0.0,
            'tier': 'exact',
            'ateOut': false,
            'source': 'manual',
            'shared': false,
          },
        }
      ])
      ..seed('workouts', [
        {
          'id': 'w-1',
          'user_id': 'u1',
          'data': {
            'id': 'w-1',
            'at': '2026-08-21T18:00:00.000',
            'exercises': [],
            'finished': true,
            'shared': false,
          },
        }
      ]);

    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.pantry.items.single.id, 'item-1');
    expect(env.pantry.items.single.name, 'Eggs');
    expect(env.pantry.items.single.qty, 6.0);
    expect(env.nutrition.entries.single.id, 'food-1');
    expect(env.nutrition.entries.single.kcal, 0.0); // real 0 preserved.
    expect(env.workout.sessions.single.id, 'w-1');
    expect(env.workout.sessions.single.finished, isTrue);
  });

  test('profile singleton rebuilt from its flat columns', () async {
    final writer = FakeSupabaseWriter()
      ..seed('profile', [
        {
          'user_id': 'u1',
          'weight_kg': 62.5,
          'age_years': 30,
          'goal_direction': 'gain',
          'data': {'weight_kg': 62.5, 'age': 30, 'goal_direction': 'gain'},
        }
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.profile.saved, isNotNull);
    expect(env.profile.saved!['weight_kg'], 62.5);
    expect(env.profile.saved!['age_years'], 30);
    // Profile.fromJson maps backend 'lose'→model 'cut'; 'gain' stays 'gain'.
    expect(env.profile.saved!['goal_direction'], 'gain');
  });

  test('a FAILED pull leaves that local store INTACT (no wipe)', () async {
    final writer = FakeSupabaseWriter()..throwOnSelect.add('pantry_items');
    final existing = FakePantryStore([
      const PantryItem(
          id: 'local-1', name: 'Milk', zone: PantryZone.fridge, source: 'manual'),
    ]);
    final env = _build(writer, pantry: existing);

    await env.hydrator.hydrate('u1');

    // The pantry pull threw → local cache untouched, NOT cleared.
    expect(env.pantry.items.single.id, 'local-1');
  });

  test('an EMPTY pull leaves local intact (does not clear existing data)',
      () async {
    // profile table returns no rows → the local profile must survive.
    final writer = FakeSupabaseWriter(); // nothing seeded.
    final existingProfile = FakeProfileStore({'weight_kg': 70.0});
    final env = _build(writer, profile: existingProfile);

    await env.hydrator.hydrate('u1');

    expect(env.profile.saved, {'weight_kg': 70.0}); // untouched.
  });

  test('goals singleton rebuilt from its data jsonb', () async {
    final writer = FakeSupabaseWriter()
      ..seed('nutrition_goals', [
        {
          'user_id': 'u1',
          'calories_kcal': 2500,
          'data': {'caloriesKcal': 2500, 'proteinG': 150},
        }
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.goals.saved, isNotNull);
    expect(env.goals.saved!['caloriesKcal'], 2500);
    expect(env.goals.saved!['proteinG'], 150);
  });

  test('weigh-ins rebuilt from their data jsonb into the local store', () async {
    final writer = FakeSupabaseWriter()
      ..seed('weigh_ins', [
        {
          'id': 'weigh-1',
          'user_id': 'u1',
          'data': {
            'id': 'weigh-1',
            'at': '2026-08-21T08:00:00.000',
            'weightKg': 62.5,
          },
        }
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.weighIns.items.single.id, 'weigh-1');
    expect(env.weighIns.items.single.weightKg, 62.5);
  });

  test('an EMPTY goals pull leaves local goals intact', () async {
    final writer = FakeSupabaseWriter(); // nothing seeded.
    final existing = FakeGoalsStore({'caloriesKcal': 2000});
    final env = _build(writer, goals: existing);
    await env.hydrator.hydrate('u1');
    expect(env.goals.saved, {'caloriesKcal': 2000}); // untouched.
  });

  test('a row with no/invalid data is skipped, not fabricated', () async {
    final writer = FakeSupabaseWriter()
      ..seed('food_log_entries', [
        {'id': 'food-bad', 'user_id': 'u1'}, // no `data`.
        {
          'id': 'food-ok',
          'user_id': 'u1',
          'data': {
            'id': 'food-ok',
            'name': 'Tea',
            'at': '2026-08-21T08:00:00.000',
            'tier': 'exact',
            'source': 'manual',
          },
        },
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    // Only the well-formed row is hydrated; the dataless one is skipped.
    expect(env.nutrition.entries.map((e) => e.id), ['food-ok']);
  });

  test('grocery list rebuilt from its data jsonb into the local store',
      () async {
    final writer = FakeSupabaseWriter()
      ..seed('grocery_list', [
        {
          'id': 'grocery-1',
          'user_id': 'u1',
          'name': 'Milk',
          'checked': false,
          'data': {'id': 'grocery-1', 'name': 'Milk', 'done': false},
        },
        {
          'id': 'grocery-2',
          'user_id': 'u1',
          'name': 'Bread',
          'checked': true,
          'data': {'id': 'grocery-2', 'name': 'Bread', 'done': true},
        },
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.grocery.items.map((i) => i.id), ['grocery-1', 'grocery-2']);
    expect(env.grocery.items.firstWhere((i) => i.id == 'grocery-2').done,
        isTrue);
  });

  test('a FAILED grocery pull leaves the local list INTACT (no wipe)',
      () async {
    final writer = FakeSupabaseWriter()..throwOnSelect.add('grocery_list');
    final existing = FakeGroceryStore([
      const GroceryItem(id: 'local-g1', name: 'Eggs'),
    ]);
    final env = _build(writer, grocery: existing);

    await env.hydrator.hydrate('u1');

    // The grocery pull threw → local list untouched, NOT cleared.
    expect(env.grocery.items.single.id, 'local-g1');
  });

  test('meal-plan singleton rebuilt from its data jsonb', () async {
    final writer = FakeSupabaseWriter()
      ..seed('meal_plans', [
        {
          'user_id': 'u1',
          'week_start': '2026-08-24T00:00:00.000',
          'data': {
            'id': 'plan-u1-2026W35',
            'weekStart': '2026-08-24T00:00:00.000',
            'days': [
              {
                'date': '2026-08-24T00:00:00.000',
                'meals': [
                  {
                    'name': 'Oats & yogurt',
                    'slot': 'breakfast',
                    'tier': 'estimate',
                    'ingredients': [
                      {'name': 'Oats', 'grams': 60},
                    ],
                    'kcal': 420,
                  },
                ],
              },
            ],
          },
        }
      ]);
    final env = _build(writer);
    await env.hydrator.hydrate('u1');

    expect(env.mealPlan.saved, isNotNull);
    expect(env.mealPlan.saved!['id'], 'plan-u1-2026W35');
    final days = env.mealPlan.saved!['days'] as List;
    expect((days.single as Map)['meals'], hasLength(1));
  });

  test('an EMPTY meal-plan pull leaves the local plan intact', () async {
    final writer = FakeSupabaseWriter(); // nothing seeded.
    final existing = FakeMealPlanStore({'id': 'local-plan'});
    final env = _build(writer, mealPlan: existing);
    await env.hydrator.hydrate('u1');
    expect(env.mealPlan.saved, {'id': 'local-plan'}); // untouched.
  });
}
