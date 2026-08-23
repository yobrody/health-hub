// ignore_for_file: prefer_initializing_formals

// MealPlanRepo — local persistence + Outbox-queued sync for the user's current
// weekly meal plan (a SINGLETON, one active plan per user).
//
// Mirrors NutritionGoalsRepo exactly: every save persists locally AND enqueues a
// PUT /meal-plan on the shared Outbox so it upserts into the Supabase
// `meal_plans` table (keyed on `user_id`). The return is always a queued-success
// — an offline save is never a failure. The singleton dedupeKey is STABLE, so a
// newer plan supersedes the older queued one (regenerating the week collapses to
// the latest snapshot).
//
// Honesty: an absent plan loads as `null` (the honest "no plan yet" empty
// state), never a fabricated week of meals.

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../offline/outbox.dart';
import '../../offline/pending_mutation.dart';
import 'meal_plan.dart';

/// Local persistence for the (single) current meal plan. Same interface/fake
/// pattern as [NutritionGoalsStore]: the platform impl
/// ([SharedPrefsMealPlanStore]) is not unit-tested; tests inject a fake.
abstract class MealPlanStore {
  Future<Map<String, dynamic>?> load();
  Future<void> save(Map<String, dynamic> json);
  Future<void> clear();
}

/// Loads and saves the user's current [MealPlan] (a singleton).
///
/// Every save: (1) persist locally, (2) enqueue a `PUT /meal-plan`
/// [PendingMutation] via the shared [Outbox], (3) return [WriteOutcome.queued].
/// The [SupabaseSyncSender] flushes `/meal-plan` → the `meal_plans` table.
class MealPlanRepo {
  MealPlanRepo({
    required Outbox outbox,
    required MealPlanStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final MealPlanStore _store;

  /// Serializes the persist step so two near-simultaneous saves can't clobber
  /// each other. Mirrors [NutritionGoalsRepo]'s _synchronized (last-writer-wins).
  Future<void> _mutation = Future.value();

  Future<T> _synchronized<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _mutation = _mutation.then((_) async {
      try {
        completer.complete(await action());
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  /// The route the plan PUT targets → `meal_plans` (see supabase_tables).
  static const String _path = '/meal-plan';

  /// Stable dedupe bucket — a newer plan supersedes an older queued one (the
  /// singleton always collapses to the latest snapshot).
  static const String _dedupeKey = 'meal-plan';

  /// Load the stored plan, or `null` when none has been generated yet (the
  /// honest empty state — never a fabricated week).
  Future<MealPlan?> load() async {
    final json = await _store.load();
    if (json == null) return null;
    try {
      return MealPlan.fromJson(json);
    } catch (_) {
      // Corrupted/legacy snapshot — treat as no plan rather than crashing.
      return null;
    }
  }

  /// Persist [plan] locally and enqueue the `PUT /meal-plan` upsert. Always
  /// returns [WriteOutcome.queued] — an offline save is a success, never a
  /// failure.
  Future<WriteOutcome> save(MealPlan plan) async {
    // Persist AND enqueue inside the same serialized block so two near-
    // simultaneous saves can't interleave (store gets B while the queue keeps
    // A). Chaining them keeps the local snapshot and the queued write in
    // agreement — a later save cleanly supersedes an earlier one.
    await _synchronized(() async {
      final json = plan.toJson();
      await _store.save(json);
      await _outbox.enqueue(
        PendingMutation(
          id: 'meal-plan-${DateTime.now().microsecondsSinceEpoch}',
          dedupeKey: _dedupeKey,
          method: 'PUT',
          path: _path,
          body: json,
          createdAt: DateTime.now().millisecondsSinceEpoch,
        ),
      );
    });
    return WriteOutcome.queued;
  }
}

// ── SharedPreferences-backed real MealPlanStore ──────────────────────────────

const _kMealPlanKey = 'hh_meal_plan_v1';

/// Production [MealPlanStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface makes the repo testable.
class SharedPrefsMealPlanStore implements MealPlanStore {
  const SharedPrefsMealPlanStore();

  @override
  Future<Map<String, dynamic>?> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kMealPlanKey);
      if (raw == null) return null;
      final parsed = jsonDecode(raw);
      if (parsed is! Map) return null;
      return Map<String, dynamic>.from(parsed);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(Map<String, dynamic> json) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kMealPlanKey, jsonEncode(json));
    } catch (_) {
      // Quota / access denied — in-memory state stays correct this session.
    }
  }

  @override
  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kMealPlanKey);
    } catch (_) {
      // Best-effort.
    }
  }
}
