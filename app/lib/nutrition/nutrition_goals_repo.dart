// ignore_for_file: prefer_initializing_formals

// NutritionGoalsRepo — local persistence + Outbox-queued sync for the user's
// daily nutrition targets (a SINGLETON, one goals object per user).
//
// Mirrors ProfileRepo's singleton shape and WorkoutRepo's serialized-mutation
// lock: every save persists locally AND enqueues a [PendingMutation] on `/goals`
// so it upserts into the Supabase `nutrition_goals` table (keyed on `user_id`).
// The return is always a queued-success — an offline save is never a failure.
//
// Honesty: an unset target is `null` (omitted from the body), never `0`/2200.
// The singleton dedupeKey is STABLE, so a newer save supersedes the older queued
// one — the outbox always flushes the latest full goals snapshot.

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'nutrition_goals.dart';

/// Local persistence for the (single) goals object. Same interface/fake pattern
/// as [ProfileStore]: the platform impl ([SharedPrefsNutritionGoalsStore]) is
/// not unit-tested; tests inject an in-memory fake.
abstract class NutritionGoalsStore {
  Future<Map<String, dynamic>?> load();
  Future<void> save(Map<String, dynamic> json);
}

/// Loads and saves the user's [NutritionGoals] (a singleton).
///
/// Every save: (1) persist locally, (2) enqueue a `PUT /goals` [PendingMutation]
/// via the shared [Outbox], (3) return [WriteOutcome.queued] — a SUCCESS state.
/// The [SupabaseSyncSender] flushes `/goals` → the `nutrition_goals` table.
class NutritionGoalsRepo {
  NutritionGoalsRepo({
    required Outbox outbox,
    required NutritionGoalsStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final NutritionGoalsStore _store;

  /// Serializes the persist step so two near-simultaneous saves can't read the
  /// same snapshot and clobber each other. Mirrors [WorkoutRepo]'s _synchronized
  /// (the "never lose a write" lock). The goals object is a singleton, so this
  /// mostly guards ordering, but it keeps the last-writer-wins guarantee honest.
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

  /// The route the goals PUT targets → `nutrition_goals` (see supabase_tables).
  static const String _path = '/goals';

  /// Stable dedupe bucket — a newer goals save supersedes an older queued one
  /// (the singleton always collapses to the latest snapshot).
  static const String _dedupeKey = 'goals';

  /// Load the stored goals. Absent → an all-null [NutritionGoals] (honest empty,
  /// every ring stays in its empty state), never a fabricated set of targets.
  Future<NutritionGoals> load() async {
    final json = await _store.load();
    if (json == null) return const NutritionGoals();
    return NutritionGoals.fromJson(json);
  }

  /// Persist [goals] locally and enqueue the `PUT /goals` upsert. Always returns
  /// [WriteOutcome.queued] — an offline save is a success, never a failure.
  Future<WriteOutcome> save(NutritionGoals goals) async {
    await _synchronized(() async {
      await _store.save(goals.toJson());
    });
    await _outbox.enqueue(
      PendingMutation(
        id: 'goals-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey,
        method: 'PUT',
        path: _path,
        body: goals.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    return WriteOutcome.queued;
  }
}

// ── SharedPreferences-backed real NutritionGoalsStore ────────────────────────

const _kGoalsKey = 'hh_nutrition_goals_v1';

/// Production [NutritionGoalsStore] backed by [SharedPreferences]. Not
/// unit-tested (platform channel); the interface makes the repo testable.
class SharedPrefsNutritionGoalsStore implements NutritionGoalsStore {
  const SharedPrefsNutritionGoalsStore();

  @override
  Future<Map<String, dynamic>?> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kGoalsKey);
      if (raw == null) return null;
      final parsed = jsonDecode(raw);
      if (parsed is! Map) return null;
      return Map<String, dynamic>.from(parsed);
    } catch (_) {
      // Corrupted storage — treat as unset rather than crashing.
      return null;
    }
  }

  @override
  Future<void> save(Map<String, dynamic> json) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kGoalsKey, jsonEncode(json));
    } catch (_) {
      // Quota / access denied — in-memory state is still correct for this
      // session; mirror the Profile/Outbox stores' tolerant behaviour.
    }
  }
}
