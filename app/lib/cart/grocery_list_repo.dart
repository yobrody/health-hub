// ignore_for_file: prefer_initializing_formals

// GroceryListRepo — local persistence + Outbox-queued sync for the Cart
// grocery-list notepad.
//
// This was the LAST local-only domain. Every other aggregate (pantry, food log,
// workouts, weigh-ins, goals, profile) already syncs through the shared offline
// [Outbox] → Supabase; the grocery list now does too. Mirrors PantryRepo /
// NutritionRepo exactly: a pure [GroceryListStore] interface (with a thin
// [SharedPrefsGroceryListStore] real adapter) plus the shared [Outbox]. EVERY
// mutation (add / toggle / remove / clearDone) persists locally AND enqueues a
// [PendingMutation] that flushes to the `grocery_list` table.
//
// Offline / honesty contract:
//  • Local is the source of truth for the reactive `groceryListProvider`, so
//    each mutation still returns the fresh list (callers + tests unchanged).
//  • A queued write is a SUCCESS — a flaky connection (or being signed out)
//    never loses a line; the Outbox replays it on reconnect/login.
//  • A [_synchronized] lock serializes load→modify→persist+enqueue, so two rapid
//    mutations can't clobber each other (no lost update).
//  • A REMOVED item enqueues a real `DELETE /grocery/{id}` (which the sender maps
//    to a genuine row delete), so it disappears cross-device — never a ghost row.
//  • An empty list is genuinely empty (the notepad shows its honest empty state);
//    nothing is ever seeded with placeholder items.

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'grocery_item.dart';

/// Local persistence for the grocery list. Same interface/fake pattern as the
/// other stores: the platform impl ([SharedPrefsGroceryListStore]) is not
/// unit-tested; tests inject an in-memory fake.
abstract class GroceryListStore {
  Future<List<GroceryItem>> load();
  Future<void> save(List<GroceryItem> items);
}

/// The grocery-list data layer. Every mutation persists the whole list locally,
/// enqueues the matching [PendingMutation] on the shared [Outbox], and returns
/// the new list so callers can render the fresh state immediately.
///
/// A serialized mutation lock (mirrors [NutritionGoalsRepo]) makes two rapid
/// mutations read+write the list in order, so an add can't clobber a concurrent
/// check/remove.
class GroceryListRepo {
  GroceryListRepo({
    required Outbox outbox,
    required GroceryListStore store,
  })  : _outbox = outbox,
        _store = store;

  final Outbox _outbox;
  final GroceryListStore _store;

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  static const String _basePath = '/grocery';

  /// Dedupe bucket per item — a newer mutation for the same item supersedes an
  /// older queued one (add→toggle→remove collapse to the latest intent).
  static String _dedupeKey(String id) => 'grocery:$id';

  /// A monotonic counter appended to each new id so two adds in the same
  /// microsecond can't collide (a collision would make toggle/remove affect
  /// both items). Timestamp + counter keeps ids unique and roughly ordered.
  int _seq = 0;

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

  /// The current list, in insertion order. Absent → an empty list (honest
  /// "nothing added yet"), never a fabricated set of items.
  Future<List<GroceryItem>> all() => _store.load();

  /// Add a new item with the given [name]. A blank/whitespace-only name is a
  /// no-op (we never persist an empty line, and never enqueue one). Returns the
  /// updated list.
  Future<List<GroceryItem>> add(String name) => _synchronized(() async {
        final trimmed = name.trim();
        if (trimmed.isEmpty) return _store.load();
        final items = await _store.load();
        final item = GroceryItem(
          id: 'grocery-${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
          name: trimmed,
          createdAt: DateTime.now().toUtc(),
        );
        final next = [...items, item];
        await _store.save(next);
        await _enqueueUpsert('POST', _basePath, item);
        return next;
      });

  /// Toggle (or set) the `done` state of the item with [id]. Returns the
  /// updated list; an unknown id is a no-op (nothing persisted or enqueued).
  Future<List<GroceryItem>> toggle(String id, {bool? done}) =>
      _synchronized(() async {
        final items = await _store.load();
        if (!items.any((i) => i.id == id)) return items;
        GroceryItem? updated;
        final next = items.map((i) {
          if (i.id != id) return i;
          updated = i.copyWith(done: done ?? !i.done);
          return updated!;
        }).toList();
        await _store.save(next);
        await _enqueueUpsert('PUT', '$_basePath/$id', updated!);
        return next;
      });

  /// Remove the item with [id]. Returns the updated list; unknown id → no-op.
  /// Enqueues a real `DELETE /grocery/{id}` so the row is deleted cross-device
  /// (no ghost row left behind).
  Future<List<GroceryItem>> remove(String id) => _synchronized(() async {
        final items = await _store.load();
        if (!items.any((i) => i.id == id)) return items;
        final next = items.where((i) => i.id != id).toList();
        await _store.save(next);
        await _enqueueDelete(id);
        return next;
      });

  /// Remove every checked-off item. Returns the updated list. Enqueues a real
  /// DELETE for EACH removed item, so every cleared line disappears
  /// cross-device (no ghost rows).
  Future<List<GroceryItem>> clearDone() => _synchronized(() async {
        final items = await _store.load();
        final removed = items.where((i) => i.done).toList();
        if (removed.isEmpty) return items;
        final next = items.where((i) => !i.done).toList();
        await _store.save(next);
        for (final item in removed) {
          await _enqueueDelete(item.id);
        }
        return next;
      });

  Future<void> _enqueueUpsert(String method, String path, GroceryItem item) {
    return _outbox.enqueue(
      PendingMutation(
        id: 'grocery-${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
        dedupeKey: _dedupeKey(item.id),
        method: method,
        path: path,
        body: item.toJson(),
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }

  Future<void> _enqueueDelete(String id) {
    return _outbox.enqueue(
      PendingMutation(
        id: 'grocery-${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
        dedupeKey: _dedupeKey(id),
        method: 'DELETE',
        path: '$_basePath/$id',
        body: null,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }
}

// ── SharedPreferences-backed real GroceryListStore ───────────────────────────

const _kGroceryKey = 'hh_grocery_list_v1';

/// Production [GroceryListStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface makes the repo testable.
class SharedPrefsGroceryListStore implements GroceryListStore {
  const SharedPrefsGroceryListStore();

  @override
  Future<List<GroceryItem>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kGroceryKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map>()
          .map((m) => GroceryItem.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } catch (_) {
      // Corrupted storage — treat as empty rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<GroceryItem> items) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kGroceryKey,
        jsonEncode(items.map((i) => i.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — in-memory state is still correct for this
      // session; mirror the other stores' tolerant behaviour.
    }
  }
}
