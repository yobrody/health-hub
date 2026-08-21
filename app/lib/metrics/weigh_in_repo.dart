// ignore_for_file: prefer_initializing_formals

// WeighInRepo — local persistence + Outbox-queued sync for weigh-in history
// (many rows per user).
//
// Mirrors WorkoutRepo/NutritionRepo exactly: a pure [WeighInStore] interface
// (with a thin [SharedPrefsWeighInStore] real adapter) plus the shared [Outbox]
// and the serialized-mutation lock. Every add persists locally AND enqueues a
// `POST /weigh-ins` [PendingMutation] so it upserts into the Supabase
// `weigh_ins` table (keyed on `id`). The return is always a queued-success.
//
// Honesty: a weigh-in weight is nullable (never fabricated 0); the trend that
// reads this history (weight_trend.dart) only shows an arrow with ≥2 real
// readings. The serialized lock prevents the load→modify→save race from
// silently dropping a concurrently-added reading (the workout-repo bug).

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'weigh_in.dart';

/// Local persistence for the weigh-in list. Same interface/fake pattern as
/// [WorkoutStore]/[NutritionStore]: the platform impl ([SharedPrefsWeighInStore])
/// is not unit-tested; tests inject an in-memory fake.
abstract class WeighInStore {
  Future<List<WeighIn>> load();
  Future<void> save(List<WeighIn> weighIns);
}

/// Loads, mutates and syncs the weigh-in history.
///
/// Every mutation: (1) persist locally, (2) enqueue a [PendingMutation] via the
/// shared [Outbox], (3) return [WriteOutcome.queued]. The [SupabaseSyncSender]
/// flushes `/weigh-ins` → the `weigh_ins` table (upsert on `id`).
class WeighInRepo {
  WeighInRepo({
    required Outbox outbox,
    required WeighInStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final WeighInStore _store;

  // Serializes each load→modify→save critical section so two near-simultaneous
  // adds can't both read the same snapshot and have the second clobber the
  // first (silently dropping a reading). Mirrors [WorkoutRepo]'s _synchronized.
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

  static const String _basePath = '/weigh-ins';

  /// Dedupe bucket per reading — a re-added/edited reading supersedes its older
  /// queued mutation.
  static String _dedupeKey(String id) => 'weigh-in:$id';

  // ── Reads ────────────────────────────────────────────────────────────────

  /// The full weigh-in history (persisted order).
  Future<List<WeighIn>> all() async => _store.load();

  /// The most recent reading BY TIMESTAMP, or `null` when there are none.
  /// "Most recent" uses [WeighIn.at] (not list order), so an out-of-order insert
  /// still returns the genuinely-latest reading.
  Future<WeighIn?> latest() async {
    final all = await _store.load();
    if (all.isEmpty) return null;
    return all.reduce((a, b) => a.at.isAfter(b.at) ? a : b);
  }

  // ── Mutations (persist locally + enqueue) ──────────────────────────────────

  /// Add a weigh-in. Persists locally (idempotent on id) and enqueues
  /// `POST /weigh-ins`. Returns [WriteOutcome.queued] — a success state.
  Future<WriteOutcome> add(WeighIn weighIn) async {
    await _synchronized(() async {
      final existing = await _store.load();
      final next = [
        ...existing.where((w) => w.id != weighIn.id),
        weighIn,
      ];
      await _store.save(next);
    });
    await _outbox.enqueue(
      PendingMutation(
        id: 'weigh-in-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(weighIn.id),
        method: 'POST',
        path: _basePath,
        body: weighIn.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    return WriteOutcome.queued;
  }
}

// ── SharedPreferences-backed real WeighInStore ───────────────────────────────

const _kWeighInKey = 'hh_weigh_ins_v1';

/// Production [WeighInStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface is what makes [WeighInRepo] testable.
class SharedPrefsWeighInStore implements WeighInStore {
  const SharedPrefsWeighInStore();

  @override
  Future<List<WeighIn>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kWeighInKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(WeighIn.fromJson)
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<WeighIn> weighIns) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kWeighInKey,
        jsonEncode(weighIns.map((w) => w.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — in-memory state is still correct for this
      // session; mirror the other stores' tolerant behaviour.
    }
  }
}
