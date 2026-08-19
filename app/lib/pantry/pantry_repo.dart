// ignore_for_file: prefer_initializing_formals

// PantryRepo — local persistence + Outbox-queued sync for the Pantry keystone.
//
// Mirrors ProfileRepo exactly: a pure [PantryStore] interface (with a thin
// [SharedPrefsPantryStore] real adapter) plus the shared [Outbox]. EVERY
// mutation persists locally AND enqueues a [PendingMutation] so it syncs once a
// backend `/pantry` endpoint exists — the return is always a queued-success,
// never "failed".
//
// Honesty invariants enforced here:
//  • qty NEVER goes below 0 — a decrement that would go negative is clamped to
//    0 and the result flags a shortfall (see [AdjustResult]); the negative is
//    neither silently written nor silently hidden.

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'pantry_item.dart';

/// Local persistence for the pantry item list. Same interface/fake pattern as
/// [ProfileStore] / [OutboxStore]: the platform impl ([SharedPrefsPantryStore])
/// is not unit-tested; tests inject an in-memory fake.
abstract class PantryStore {
  Future<List<PantryItem>> load();
  Future<void> save(List<PantryItem> items);
}

/// Outcome of an [PantryRepo.adjustQty] call — the clean no-negative-qty
/// surface. `qty` on [item] is guaranteed `>= 0`.
class AdjustResult {
  const AdjustResult({
    required this.item,
    required this.outcome,
    required this.shortfall,
    this.shortfallAmount = 0,
  });

  /// The updated item after the (clamped) adjustment, or `null` when no item
  /// with the requested id exists (nothing was written or queued).
  final PantryItem? item;

  /// The queue outcome for the write, or `null` when there was nothing to
  /// write (unknown id).
  final WriteOutcome? outcome;

  /// True when the requested decrement was larger than the quantity on hand,
  /// so the result was clamped to 0. Callers surface this honestly (e.g. "only
  /// N left") rather than pretending the full amount was deducted.
  final bool shortfall;

  /// How much of the requested decrement could NOT be covered (the clamped
  /// amount). `0` when there was no shortfall.
  final double shortfallAmount;
}

/// Loads, mutates and syncs the pantry inventory.
///
/// Every mutation: (1) persist locally, (2) enqueue a [PendingMutation] via the
/// shared [Outbox], (3) return [WriteOutcome.queued] — a SUCCESS state. There is
/// no live `/pantry` backend yet, so writes are always queued; when the endpoint
/// lands, [SyncService] replays them unchanged.
class PantryRepo {
  PantryRepo({
    required Outbox outbox,
    required PantryStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final PantryStore _store;

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  static const String _basePath = '/pantry';

  /// Dedupe bucket per item — a newer mutation for the same item supersedes an
  /// older queued one (add→update→delete collapse to the latest intent).
  static String _dedupeKey(String id) => 'pantry:$id';

  // ── Reads ──────────────────────────────────────────────────────────────────

  /// All items currently on hand.
  Future<List<PantryItem>> all() async => _store.load();

  /// Items in a single [zone].
  Future<List<PantryItem>> byZone(PantryZone zone) async {
    final items = await _store.load();
    return items.where((i) => i.zone == zone).toList();
  }

  // ── Mutations (persist locally + enqueue) ───────────────────────────────────

  /// Add a new item. Persists locally and enqueues `POST /pantry`.
  Future<WriteOutcome> add(PantryItem item) async {
    final items = await _store.load();
    // Replace any existing item with the same id (idempotent add).
    final next = [
      ...items.where((i) => i.id != item.id),
      item,
    ];
    await _store.save(next);
    await _enqueue('POST', _basePath, item);
    return WriteOutcome.queued;
  }

  /// Update an existing item (matched by id). Persists locally and enqueues
  /// `PUT /pantry/{id}`. If the id is absent it is treated as an upsert.
  Future<WriteOutcome> update(PantryItem item) async {
    final items = await _store.load();
    final next = [
      for (final i in items)
        if (i.id == item.id) item else i,
    ];
    // Upsert if it wasn't already present.
    if (!items.any((i) => i.id == item.id)) next.add(item);
    await _store.save(next);
    await _enqueue('PUT', '$_basePath/${item.id}', item);
    return WriteOutcome.queued;
  }

  /// Delete an item by id. Persists locally and enqueues `DELETE /pantry/{id}`.
  Future<WriteOutcome> delete(String id) async {
    final items = await _store.load();
    await _store.save(items.where((i) => i.id != id).toList());
    await _outbox.enqueue(
      PendingMutation(
        id: 'pantry-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(id),
        method: 'DELETE',
        path: '$_basePath/$id',
        body: null,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    return WriteOutcome.queued;
  }

  /// Adjust an item's quantity by [delta] (negative to consume, positive to
  /// restock). **qty is clamped to a floor of 0** — a decrement larger than the
  /// amount on hand yields qty 0 and [AdjustResult.shortfall] true (with the
  /// uncovered amount in [AdjustResult.shortfallAmount]), never a negative.
  ///
  /// A `null` current qty is treated as a base of 0 (unknown-on-hand → can't go
  /// negative). An unknown id returns a not-found result (no write/queue).
  Future<AdjustResult> adjustQty(String id, double delta) async {
    final items = await _store.load();
    final idx = items.indexWhere((i) => i.id == id);
    if (idx < 0) {
      return const AdjustResult(
        item: null,
        outcome: null,
        shortfall: false,
      );
    }

    final current = items[idx];
    final base = current.qty ?? 0;
    final raw = base + delta;
    final clamped = raw < 0 ? 0.0 : raw;
    final shortfall = raw < 0;
    final shortfallAmount = shortfall ? -raw : 0.0;

    final updated = current.copyWith(qty: clamped);
    final next = [...items];
    next[idx] = updated;
    await _store.save(next);
    await _enqueue('PUT', '$_basePath/$id', updated);

    return AdjustResult(
      item: updated,
      outcome: WriteOutcome.queued,
      shortfall: shortfall,
      shortfallAmount: shortfallAmount,
    );
  }

  Future<void> _enqueue(String method, String path, PantryItem item) {
    return _outbox.enqueue(
      PendingMutation(
        id: 'pantry-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey(item.id),
        method: method,
        path: path,
        body: item.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }
}

// ── SharedPreferences-backed real PantryStore ────────────────────────────────

const _kPantryKey = 'hh_pantry_v1';

/// Production [PantryStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface is what makes [PantryRepo] testable.
class SharedPrefsPantryStore implements PantryStore {
  const SharedPrefsPantryStore();

  @override
  Future<List<PantryItem>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kPantryKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(PantryItem.fromJson)
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<PantryItem> items) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kPantryKey,
        jsonEncode(items.map((i) => i.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — the in-memory state is still correct for this
      // session; mirror the Outbox/Profile stores' tolerant behaviour.
    }
  }
}
