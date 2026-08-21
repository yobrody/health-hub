// GroceryListRepo — LOCAL persistence for the Cart grocery-list notepad.
//
// **Local-only for now (R-1).** Unlike the pantry/nutrition/workout repos, the
// grocery list is NOT yet synced to Supabase — there is no `grocery_list` table
// in this release, so nothing is enqueued on the shared Outbox. Sync is a later
// phase (see the R-4 "Cart hand-off" plan); when a table exists this repo grows
// an Outbox seam exactly like the others. For now the list lives entirely in
// SharedPreferences on the device.
//
// Honesty: the list is real user data. Adds/checks/removes persist verbatim;
// nothing is fabricated. An empty list is genuinely empty (the notepad shows its
// honest empty state), never seeded with placeholder items.

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'grocery_item.dart';

/// Local persistence for the grocery list. Same interface/fake pattern as the
/// other stores: the platform impl ([SharedPrefsGroceryListStore]) is not
/// unit-tested; tests inject an in-memory fake.
abstract class GroceryListStore {
  Future<List<GroceryItem>> load();
  Future<void> save(List<GroceryItem> items);
}

/// The grocery-list data layer. Every mutation persists the whole list locally
/// and returns the new list, so callers can render the fresh state immediately.
///
/// A serialized mutation lock (mirrors [NutritionGoalsRepo]) makes two rapid
/// mutations read+write the list in order, so an add can't clobber a concurrent
/// check/remove.
class GroceryListRepo {
  // ignore: prefer_initializing_formals
  GroceryListRepo({required GroceryListStore store}) : _store = store;

  final GroceryListStore _store;

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
  /// no-op (we never persist an empty line). Returns the updated list.
  Future<List<GroceryItem>> add(String name) => _synchronized(() async {
        final trimmed = name.trim();
        if (trimmed.isEmpty) return _store.load();
        final items = await _store.load();
        final item = GroceryItem(
          id: 'grocery-${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
          name: trimmed,
        );
        final next = [...items, item];
        await _store.save(next);
        return next;
      });

  /// Toggle (or set) the `done` state of the item with [id]. Returns the
  /// updated list; an unknown id is a no-op.
  Future<List<GroceryItem>> toggle(String id, {bool? done}) =>
      _synchronized(() async {
        final items = await _store.load();
        final next = items
            .map((i) =>
                i.id == id ? i.copyWith(done: done ?? !i.done) : i)
            .toList();
        await _store.save(next);
        return next;
      });

  /// Remove the item with [id]. Returns the updated list; unknown id → no-op.
  Future<List<GroceryItem>> remove(String id) => _synchronized(() async {
        final items = await _store.load();
        final next = items.where((i) => i.id != id).toList();
        await _store.save(next);
        return next;
      });

  /// Remove every checked-off item. Returns the updated list.
  Future<List<GroceryItem>> clearDone() => _synchronized(() async {
        final items = await _store.load();
        final next = items.where((i) => !i.done).toList();
        await _store.save(next);
        return next;
      });
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
