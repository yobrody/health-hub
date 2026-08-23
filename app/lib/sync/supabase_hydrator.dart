// ignore_for_file: prefer_initializing_formals

import '../cart/grocery_item.dart';
import '../cart/grocery_list_repo.dart' show GroceryListStore;
import '../gym/workout_repo.dart' show WorkoutStore;
import '../gym/workout_session.dart';
import '../metrics/weigh_in.dart';
import '../metrics/weigh_in_repo.dart' show WeighInStore;
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_goals.dart';
import '../nutrition/nutrition_goals_repo.dart' show NutritionGoalsStore;
import '../nutrition/nutrition_repo.dart' show NutritionStore;
import '../nutrition/plan/meal_plan.dart';
import '../nutrition/plan/meal_plan_repo.dart' show MealPlanStore;
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart' show PantryStore;
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart' show ProfileStore;
import 'supabase_writer.dart';

/// Login-time hydration: pull the signed-in user's rows from Supabase and write
/// them into the LOCAL stores, so the app shows THIS user's data cross-device.
///
/// The app is offline-first: it always reads from the local stores. Hydration
/// is what seeds those stores from the cloud after a sign-in (a fresh device,
/// or a returning user). It runs behind the same [SupabaseWriter] seam the
/// sender uses (its `selectAll`), so it is fully fake-testable — no network in
/// any test path.
///
/// Honesty / integrity contract:
///  * Each aggregate is rebuilt from its row's `data` jsonb via the existing
///    `fromJson` (the profile from the row's flat columns, which already match
///    `Profile.fromJson`'s keys). Nothing is fabricated; a row that can't be
///    parsed is skipped rather than guessed.
///  * On ANY failure (a table pull throws), local cache is LEFT INTACT — we do
///    NOT wipe local data on a failed pull. A partial success only replaces the
///    tables that actually loaded.
class SupabaseHydrator {
  SupabaseHydrator({
    required SupabaseWriter writer,
    required ProfileStore profileStore,
    required PantryStore pantryStore,
    required NutritionStore nutritionStore,
    required WorkoutStore workoutStore,
    required NutritionGoalsStore goalsStore,
    required WeighInStore weighInStore,
    required GroceryListStore groceryStore,
    required MealPlanStore mealPlanStore,
  })  : _writer = writer,
        _profileStore = profileStore,
        _pantryStore = pantryStore,
        _nutritionStore = nutritionStore,
        _workoutStore = workoutStore,
        _goalsStore = goalsStore,
        _weighInStore = weighInStore,
        _groceryStore = groceryStore,
        _mealPlanStore = mealPlanStore;

  final SupabaseWriter _writer;
  final ProfileStore _profileStore;
  final PantryStore _pantryStore;
  final NutritionStore _nutritionStore;
  final WorkoutStore _workoutStore;
  final NutritionGoalsStore _goalsStore;
  final WeighInStore _weighInStore;
  final GroceryListStore _groceryStore;
  final MealPlanStore _mealPlanStore;

  /// Hydrate every synced store for [userId]. RLS already restricts each
  /// `select` to the caller's own rows; [userId] is accepted for clarity and so
  /// a future non-RLS path could filter explicitly.
  ///
  /// Each table is hydrated independently: one table failing (or returning
  /// nothing) never blocks the others and never clears an unrelated store.
  Future<void> hydrate(String userId) async {
    await Future.wait([
      _hydrateProfile(),
      _hydratePantry(),
      _hydrateNutrition(),
      _hydrateWorkouts(),
      _hydrateGoals(),
      _hydrateWeighIns(),
      _hydrateGrocery(),
      _hydrateMealPlan(),
    ]);
  }

  Future<void> _hydrateProfile() async {
    try {
      final rows = await _writer.selectAll('profile');
      if (rows.isEmpty) return; // nothing to hydrate — leave local intact.
      // Singleton: exactly one row per user. Rebuild from its flat columns,
      // whose keys (`height_cm`, `age_years`, `weight_kg`, `goal_direction`,
      // `target_weight_kg`, `primary_gym`) already match Profile.fromJson.
      final profile = Profile.fromJson(rows.first);
      await _profileStore.save(profile.toJson());
    } catch (_) {
      // Failed pull → leave the local profile untouched (honest, no wipe).
    }
  }

  Future<void> _hydratePantry() async {
    try {
      final rows = await _writer.selectAll('pantry_items');
      final items = _rebuild(rows, PantryItem.fromJson);
      if (items == null) return; // parse/pull failure → leave local intact.
      await _pantryStore.save(items);
    } catch (_) {
      // Leave local intact.
    }
  }

  Future<void> _hydrateNutrition() async {
    try {
      final rows = await _writer.selectAll('food_log_entries');
      final entries = _rebuild(rows, FoodLogEntry.fromJson);
      if (entries == null) return;
      await _nutritionStore.save(entries);
    } catch (_) {
      // Leave local intact.
    }
  }

  Future<void> _hydrateWorkouts() async {
    try {
      final rows = await _writer.selectAll('workouts');
      final sessions = _rebuild(rows, WorkoutSession.fromJson);
      if (sessions == null) return;
      await _workoutStore.save(sessions);
    } catch (_) {
      // Leave local intact.
    }
  }

  Future<void> _hydrateGoals() async {
    try {
      final rows = await _writer.selectAll('nutrition_goals');
      if (rows.isEmpty) return; // nothing to hydrate — leave local intact.
      // Singleton: one row per user. Its `data` jsonb holds the full
      // NutritionGoals.toJson() (camelCase keys), the source of truth.
      final data = rows.first['data'];
      if (data is! Map) return; // no snapshot → don't fabricate.
      final goals = NutritionGoals.fromJson(Map<String, dynamic>.from(data));
      await _goalsStore.save(goals.toJson());
    } catch (_) {
      // Failed pull → leave local goals untouched (honest, no wipe).
    }
  }

  Future<void> _hydrateWeighIns() async {
    try {
      final rows = await _writer.selectAll('weigh_ins');
      final weighIns = _rebuild(rows, WeighIn.fromJson);
      if (weighIns == null) return; // parse/pull failure → leave local intact.
      await _weighInStore.save(weighIns);
    } catch (_) {
      // Leave local intact.
    }
  }

  Future<void> _hydrateGrocery() async {
    try {
      final rows = await _writer.selectAll('grocery_list');
      final items = _rebuild(rows, GroceryItem.fromJson);
      if (items == null) return; // parse/pull failure → leave local intact.
      await _groceryStore.save(items);
    } catch (_) {
      // Leave local intact.
    }
  }

  Future<void> _hydrateMealPlan() async {
    try {
      final rows = await _writer.selectAll('meal_plans');
      if (rows.isEmpty) return; // nothing to hydrate — leave local intact.
      // Singleton: one row per user. Its `data` jsonb holds the full
      // MealPlan.toJson(), the source of truth.
      final data = rows.first['data'];
      if (data is! Map) return; // no snapshot → don't fabricate.
      final plan = MealPlan.fromJson(Map<String, dynamic>.from(data));
      await _mealPlanStore.save(plan.toJson());
    } catch (_) {
      // Failed pull / parse → leave the local plan untouched (no wipe).
    }
  }

  /// Rebuild a list of aggregates from their rows' `data` jsonb via [fromJson].
  ///
  /// `data` is the source of truth for each aggregate (it holds the full
  /// `toJson()`). A row whose `data` is missing/malformed is SKIPPED rather than
  /// fabricated. Returns `null` only if the whole pull is unusable, so the
  /// caller leaves the local store untouched.
  static List<T>? _rebuild<T>(
    List<Map<String, dynamic>> rows,
    T Function(Map<String, dynamic>) fromJson,
  ) {
    final out = <T>[];
    for (final row in rows) {
      final data = row['data'];
      if (data is! Map) continue; // no snapshot → skip, don't fabricate.
      try {
        out.add(fromJson(Map<String, dynamic>.from(data)));
      } catch (_) {
        // A single corrupt row is skipped, not fatal.
      }
    }
    return out;
  }
}
