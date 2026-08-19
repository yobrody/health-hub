// ignore_for_file: prefer_initializing_formals

// NutritionRepo — local persistence + Outbox-queued sync for the food log.
//
// Mirrors PantryRepo exactly: a pure [NutritionStore] interface (with a thin
// [SharedPrefsNutritionStore] real adapter) plus the shared [Outbox]. EVERY
// mutation persists locally AND enqueues a [PendingMutation] so it syncs once a
// backend `/nutrition` endpoint exists — the return is always a queued-success,
// never "failed".
//
// Pantry-agnostic BY CONSTRUCTION: this repo takes NO pantry dependency, so an
// eating-out entry (which records spend and must NOT deduct from the pantry)
// simply cannot touch pantry logic. The eating-in/deduction path lives entirely
// in [EatInService], keeping the two flows honestly separate.

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'food_log_entry.dart';

/// Local persistence for the food-log list. Same interface/fake pattern as
/// [PantryStore]/[ProfileStore]: the platform impl ([SharedPrefsNutritionStore])
/// is not unit-tested; tests inject an in-memory fake.
abstract class NutritionStore {
  Future<List<FoodLogEntry>> load();
  Future<void> save(List<FoodLogEntry> entries);
}

/// Loads, mutates and syncs the nutrition food log.
///
/// Every mutation: (1) persist locally, (2) enqueue a [PendingMutation] via the
/// shared [Outbox], (3) return [WriteOutcome.queued] — a SUCCESS state. There is
/// no live `/nutrition` backend yet, so writes are always queued; when the
/// endpoint lands, [SyncService] replays them unchanged.
class NutritionRepo {
  NutritionRepo({
    required Outbox outbox,
    required NutritionStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final NutritionStore _store;

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  static const String _basePath = '/nutrition';

  /// Dedupe bucket per entry — a newer mutation for the same entry supersedes an
  /// older queued one (add→update→delete collapse to the latest intent).
  static String _dedupeKey(String id) => 'nutrition:$id';

  // ── Reads ──────────────────────────────────────────────────────────────────

  /// All food-log entries.
  Future<List<FoodLogEntry>> all() async => _store.load();

  /// Entries logged on [day]'s LOCAL calendar date. Filters against local Y/M/D
  /// components (not UTC) so an entry logged just after local midnight belongs
  /// to the correct day for the user, regardless of timezone offset.
  ///
  /// Pure over [entries] (no I/O) so callers control the snapshot; pass
  /// `await all()`.
  List<FoodLogEntry> logsForDay(List<FoodLogEntry> entries, DateTime day) {
    return entries.where((e) => _sameLocalDay(e.at, day)).toList();
  }

  static bool _sameLocalDay(DateTime a, DateTime b) {
    final la = a.toLocal();
    final lb = b.toLocal();
    return la.year == lb.year && la.month == lb.month && la.day == lb.day;
  }

  // ── Mutations (persist locally + enqueue) ───────────────────────────────────

  /// Add a new entry. Persists locally and enqueues `POST /nutrition`.
  Future<WriteOutcome> add(FoodLogEntry entry) async {
    final entries = await _store.load();
    // Replace any existing entry with the same id (idempotent add).
    final next = [
      ...entries.where((e) => e.id != entry.id),
      entry,
    ];
    await _store.save(next);
    await _enqueue('POST', _basePath, entry);
    return WriteOutcome.queued;
  }

  /// Update an existing entry (matched by id). Persists locally and enqueues
  /// `PUT /nutrition/{id}`. If the id is absent it is treated as an upsert.
  Future<WriteOutcome> update(FoodLogEntry entry) async {
    final entries = await _store.load();
    final next = [
      for (final e in entries)
        if (e.id == entry.id) entry else e,
    ];
    if (!entries.any((e) => e.id == entry.id)) next.add(entry);
    await _store.save(next);
    await _enqueue('PUT', '$_basePath/${entry.id}', entry);
    return WriteOutcome.queued;
  }

  /// Delete an entry by id. Persists locally and enqueues `DELETE /nutrition/{id}`.
  Future<WriteOutcome> delete(String id) async {
    final entries = await _store.load();
    await _store.save(entries.where((e) => e.id != id).toList());
    await _outbox.enqueue(
      PendingMutation(
        id: 'nutrition-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(id),
        method: 'DELETE',
        path: '$_basePath/$id',
        body: null,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    return WriteOutcome.queued;
  }

  Future<void> _enqueue(String method, String path, FoodLogEntry entry) {
    return _outbox.enqueue(
      PendingMutation(
        id: 'nutrition-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(entry.id),
        method: method,
        path: path,
        body: entry.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }
}

// ── SharedPreferences-backed real NutritionStore ─────────────────────────────

const _kNutritionKey = 'hh_nutrition_v1';

/// Production [NutritionStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface is what makes [NutritionRepo] testable.
class SharedPrefsNutritionStore implements NutritionStore {
  const SharedPrefsNutritionStore();

  @override
  Future<List<FoodLogEntry>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kNutritionKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(FoodLogEntry.fromJson)
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<FoodLogEntry> entries) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kNutritionKey,
        jsonEncode(entries.map((e) => e.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — in-memory state is still correct for this
      // session; mirror the Pantry/Outbox/Profile stores' tolerant behaviour.
    }
  }
}
