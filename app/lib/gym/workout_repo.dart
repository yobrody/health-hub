// ignore_for_file: prefer_initializing_formals

// WorkoutRepo — local persistence + Outbox-queued sync for live workout
// tracking.
//
// Mirrors PantryRepo/NutritionRepo exactly: a pure [WorkoutStore] interface
// (with a thin [SharedPrefsWorkoutStore] real adapter) plus the shared [Outbox].
// EVERY mutation persists locally AND enqueues a [PendingMutation] so it syncs
// once a backend `/workouts` endpoint exists — the return is always a
// queued-success, never "failed".
//
// The load-bearing honesty rule for THIS repo: **a session must survive an app
// restart.** Every set save writes through to the store immediately, so an
// interrupted session isn't lost (a real bug in the old app). The "fresh repo,
// same store" test proves it.

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'workout_session.dart';

/// Local persistence for the workout-session list. Same interface/fake pattern
/// as [PantryStore]/[NutritionStore]: the platform impl
/// ([SharedPrefsWorkoutStore]) is not unit-tested; tests inject an in-memory
/// fake.
abstract class WorkoutStore {
  Future<List<WorkoutSession>> load();
  Future<void> save(List<WorkoutSession> sessions);
}

/// Loads, mutates and syncs workout sessions.
///
/// Every mutation: (1) persist locally, (2) enqueue a [PendingMutation] via the
/// shared [Outbox], (3) return [WriteOutcome.queued] — a SUCCESS state. There is
/// no live `/workouts` backend yet, so writes are always queued; when the
/// endpoint lands, [SyncService] replays them unchanged.
class WorkoutRepo {
  WorkoutRepo({
    required Outbox outbox,
    required WorkoutStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final WorkoutStore _store;

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  static const String _basePath = '/workouts';

  /// Dedupe bucket per session — a newer mutation for the same session
  /// supersedes an older queued one (start→saveSet→finish collapse to the
  /// latest full-session snapshot).
  static String _dedupeKey(String id) => 'workout:$id';

  // ── Reads ──────────────────────────────────────────────────────────────────

  /// All sessions (persisted order).
  Future<List<WorkoutSession>> all() async => _store.load();

  /// The active (latest unfinished) session, or `null` when none is in
  /// progress. "Latest" = last in persisted order, which is the most recently
  /// started (sessions are appended on [startSession]).
  Future<WorkoutSession?> activeSession() async {
    final sessions = await _store.load();
    for (final s in sessions.reversed) {
      if (!s.finished) return s;
    }
    return null;
  }

  // ── Mutations (persist locally + enqueue) ───────────────────────────────────

  /// Start a new empty session. Persists locally and enqueues `POST /workouts`.
  Future<WorkoutSession> startSession() async {
    final now = DateTime.now();
    final session = WorkoutSession(
      id: 'w-${now.microsecondsSinceEpoch}',
      at: now,
      exercises: const [],
    );
    final sessions = await _store.load();
    await _store.save([...sessions, session]);
    await _enqueue('POST', _basePath, session);
    return session;
  }

  /// Add an exercise to a session (no-op if already present). Persists locally
  /// and enqueues `PUT /workouts/{id}`.
  Future<WriteOutcome> addExercise(String sessionId, String exerciseId) async {
    return _mutateSession(sessionId, (session) {
      if (session.exercises.any((e) => e.exerciseId == exerciseId)) {
        return session;
      }
      return session.copyWith(
        exercises: [
          ...session.exercises,
          ExerciseLog(exerciseId: exerciseId, sets: const []),
        ],
      );
    });
  }

  /// Upsert the set at [setIndex] for [exerciseId] within [sessionId].
  /// **Persists immediately** so an interrupted session isn't lost. Enqueues
  /// `PUT /workouts/{id}`. Auto-adds the exercise if it isn't present yet.
  ///
  /// [setIndex] semantics: an index within the current sets replaces that set;
  /// an index at/beyond the end appends (so index 0 on an empty list adds the
  /// first set).
  Future<WriteOutcome> saveSet(
    String sessionId,
    String exerciseId,
    int setIndex,
    SetEntry entry,
  ) async {
    return _mutateSession(sessionId, (session) {
      final logs = [...session.exercises];
      var idx = logs.indexWhere((e) => e.exerciseId == exerciseId);
      if (idx < 0) {
        logs.add(ExerciseLog(exerciseId: exerciseId, sets: const []));
        idx = logs.length - 1;
      }
      final sets = [...logs[idx].sets];
      if (setIndex >= 0 && setIndex < sets.length) {
        sets[setIndex] = entry;
      } else {
        sets.add(entry);
      }
      logs[idx] = logs[idx].copyWith(sets: sets);
      return session.copyWith(exercises: logs);
    });
  }

  /// Mark a session finished. Persists locally and enqueues `PUT /workouts/{id}`.
  Future<WriteOutcome> finishSession(String sessionId) async {
    return _mutateSession(sessionId, (session) => session.copyWith(finished: true));
  }

  /// Load → apply [transform] to the matching session → persist → enqueue a PUT.
  /// Returns [WriteOutcome.queued] on success, [WriteOutcome.failed] only when
  /// the session id is unknown (nothing to write).
  Future<WriteOutcome> _mutateSession(
    String sessionId,
    WorkoutSession Function(WorkoutSession) transform,
  ) async {
    final sessions = await _store.load();
    final idx = sessions.indexWhere((s) => s.id == sessionId);
    if (idx < 0) return WriteOutcome.failed;

    final updated = transform(sessions[idx]);
    final next = [...sessions];
    next[idx] = updated;
    await _store.save(next); // persist eagerly — survives restart.
    await _enqueue('PUT', '$_basePath/$sessionId', updated);
    return WriteOutcome.queued;
  }

  Future<void> _enqueue(String method, String path, WorkoutSession session) {
    return _outbox.enqueue(
      PendingMutation(
        id: 'workout-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(session.id),
        method: method,
        path: path,
        body: session.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }
}

// ── SharedPreferences-backed real WorkoutStore ───────────────────────────────

const _kWorkoutKey = 'hh_workouts_v1';

/// Production [WorkoutStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface is what makes [WorkoutRepo] testable.
class SharedPrefsWorkoutStore implements WorkoutStore {
  const SharedPrefsWorkoutStore();

  @override
  Future<List<WorkoutSession>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kWorkoutKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(WorkoutSession.fromJson)
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<WorkoutSession> sessions) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kWorkoutKey,
        jsonEncode(sessions.map((s) => s.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — in-memory state is still correct for this
      // session; mirror the Pantry/Nutrition/Outbox stores' tolerant behaviour.
    }
  }
}
