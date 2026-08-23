/// The AI meal-plan client seam (agentic "plan my week").
///
/// Turns the user's real goals + pantry into a [MealPlan] the user reviews
/// before it drives the grocery cart.
///
/// Two implementations:
///  • [SupabaseMealPlanClient] — the REAL one. Sends goals + pantry to the
///    `plan-week` Edge Function and maps its JSON into a [MealPlan]. On ANY
///    error/empty response it returns `null` — it NEVER throws to the UI and
///    NEVER fabricates a plan. The caller shows an honest "couldn't plan".
///  • [FakeMealPlanClient] — for tests/offline dev. Returns a canned plan (or
///    null) with no network, so the whole plan→cart flow is runnable + testable
///    before the live function is deployed.
///
/// [mealPlanClientProvider] is overridable in tests, so the real Supabase client
/// is never instantiated in a test path.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../food_log_entry.dart' show AccuracyTier;
import '../nutrition_goals.dart';
import '../../pantry/pantry_item.dart';
import 'meal_plan.dart';

/// The name of the Supabase Edge Function this client calls.
const String kPlanWeekFunction = 'plan-week';

/// The plan seam. Implementations turn goals + pantry into a plan.
abstract class MealPlanClient {
  /// Plan [days] of meals for the given [goals], preferring [pantry] items.
  ///
  /// Returns a [MealPlan] on success, or `null` on any failure/empty result.
  /// NEVER throws — the caller shows an honest "couldn't plan" on `null`.
  Future<MealPlan?> planWeek({
    required NutritionGoals goals,
    required List<PantryItem> pantry,
    required DateTime weekStart,
    int days,
    String? prefs,
  });
}

/// The REAL client — calls the `plan-week` Edge Function.
class SupabaseMealPlanClient implements MealPlanClient {
  SupabaseMealPlanClient(this._client);

  final SupabaseClient _client;

  @override
  Future<MealPlan?> planWeek({
    required NutritionGoals goals,
    required List<PantryItem> pantry,
    required DateTime weekStart,
    int days = 7,
    String? prefs,
  }) async {
    final body = <String, dynamic>{
      'goals': {
        if (goals.caloriesKcal != null) 'calories_kcal': goals.caloriesKcal,
        if (goals.proteinG != null) 'protein_g': goals.proteinG,
        if (goals.carbsG != null) 'carbs_g': goals.carbsG,
        if (goals.fatG != null) 'fat_g': goals.fatG,
      },
      'pantry': [
        for (final it in pantry)
          {
            'name': it.name,
            if (it.qty != null) 'qty': it.qty,
            if (it.unit != null) 'unit': it.unit,
          },
      ],
      'days': days,
      if (prefs != null && prefs.trim().isNotEmpty) 'prefs': prefs.trim(),
    };

    final FunctionResponse response;
    try {
      response = await _client.functions.invoke(kPlanWeekFunction, body: body);
    } catch (_) {
      return null; // unreachable / auth / function error → honest null.
    }
    if (response.status < 200 || response.status >= 300) return null;

    final data = response.data;
    if (data is! Map) return null;
    return parsePlanResponse(
      Map<String, dynamic>.from(data),
      weekStart: weekStart,
      idSeed: 'plan-${DateTime.now().microsecondsSinceEpoch}',
    );
  }
}

/// A test/offline client — returns a canned [result] (or `null`) with no
/// network. Records the last inputs so a test can assert the seam forwarded them.
class FakeMealPlanClient implements MealPlanClient {
  FakeMealPlanClient({this.result});

  /// The canned plan to return, or `null` to drive the "couldn't plan" path.
  final MealPlan? result;

  NutritionGoals? lastGoals;
  List<PantryItem>? lastPantry;

  @override
  Future<MealPlan?> planWeek({
    required NutritionGoals goals,
    required List<PantryItem> pantry,
    required DateTime weekStart,
    int days = 7,
    String? prefs,
  }) async {
    lastGoals = goals;
    lastPantry = pantry;
    return result;
  }
}

// ── Pure parsing (network-free, unit-tested) ─────────────────────────────────

double? _num(Object? v) {
  if (v is num) return v.toDouble();
  return null;
}

String? _str(Object? v) => (v is String && v.trim().isNotEmpty) ? v.trim() : null;

MealSlot _slot(Object? v) {
  final s = v is String ? v.trim().toLowerCase() : '';
  for (final slot in MealSlot.values) {
    if (slot.name == s) return slot;
  }
  return MealSlot.snack;
}

/// Map the `plan-week` Edge Function's response into a [MealPlan].
///
/// The edge JSON is snake_case and carries no ids/dates/tier — this stamps the
/// [weekStart]-relative dates, the [idSeed] as the plan id, and marks every meal
/// [AccuracyTier.estimate] (it is an AI estimate). Returns `null` when the
/// response has no usable day of meals — never a fabricated plan. Every macro is
/// preserved as-is: a missing macro stays null (never coerced to 0).
MealPlan? parsePlanResponse(
  Map<String, dynamic> data, {
  required DateTime weekStart,
  required String idSeed,
}) {
  final rawDays = data['days'];
  if (rawDays is! List || rawDays.isEmpty) return null;

  final days = <PlanDay>[];
  for (var i = 0; i < rawDays.length; i++) {
    final rawDay = rawDays[i];
    if (rawDay is! Map) continue;
    final rawMeals = rawDay['meals'];
    if (rawMeals is! List) continue;

    final meals = <PlanMeal>[];
    for (final rawMeal in rawMeals) {
      if (rawMeal is! Map) continue;
      final name = _str(rawMeal['name']);
      if (name == null) continue; // a nameless meal is dropped, not invented.

      final rawIngredients = rawMeal['ingredients'];
      final ingredients = <PlanIngredient>[];
      if (rawIngredients is List) {
        for (final ing in rawIngredients) {
          if (ing is! Map) continue;
          final ingName = _str(ing['name']);
          if (ingName == null) continue;
          ingredients.add(PlanIngredient(name: ingName, grams: _num(ing['grams'])));
        }
      }

      meals.add(PlanMeal(
        name: name,
        slot: _slot(rawMeal['slot']),
        tier: AccuracyTier.estimate,
        ingredients: ingredients,
        kcal: _num(rawMeal['kcal']),
        proteinG: _num(rawMeal['protein_g']),
        carbsG: _num(rawMeal['carbs_g']),
        fatG: _num(rawMeal['fat_g']),
      ));
    }
    if (meals.isEmpty) continue;
    days.add(PlanDay(
      date: DateTime(weekStart.year, weekStart.month, weekStart.day)
          .add(Duration(days: i)),
      meals: meals,
    ));
  }

  if (days.isEmpty) return null; // no usable day → honest null.
  return MealPlan(id: idSeed, weekStart: weekStart, days: days);
}

/// The meal-plan client provider. Defaults to the REAL client; tests ALWAYS
/// override it with a [FakeMealPlanClient].
final mealPlanClientProvider = Provider<MealPlanClient>((ref) {
  return SupabaseMealPlanClient(Supabase.instance.client);
});
