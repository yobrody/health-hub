import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'pending_mutation.dart';

/// Durable storage for mutations that FAILED to sync and cannot be retried
/// (a permanent server rejection, or one that exhausted `kMaxTries`).
///
/// This is a SIBLING of [OutboxStore], deliberately separate so the pending
/// queue and the failed list persist under different keys and neither can
/// clobber the other. The honesty contract is the whole point: a write the
/// server refused is NOT silently dropped — it lands here, survives an app
/// restart, and is surfaced to the user ("some changes couldn't sync").
///
/// The interface keeps the [Outbox] testable with an in-memory fake; the
/// SharedPreferences implementation is the production one.
abstract class FailedStore {
  Future<List<PendingMutation>> load();
  Future<void> save(List<PendingMutation> items);
}

/// An in-memory [FailedStore] that does NOT persist across restarts.
///
/// Used as the default when an [Outbox] is constructed without an explicit
/// failed store (e.g. older call sites / tests that don't exercise the failed
/// path). It still tracks failures within the session so the sync-status
/// provider reports them honestly; production wires the persistent store below.
class InMemoryFailedStore implements FailedStore {
  List<PendingMutation> _items = const [];

  @override
  Future<List<PendingMutation>> load() async => List.of(_items);

  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

const _kFailedStorageKey = 'hh_outbox_failed_v1';

/// Production [FailedStore] backed by [SharedPreferences].
///
/// Mirrors `SharedPrefsOutboxStore`: NOT unit-tested directly (platform
/// channel); corrupted/absent storage starts empty rather than crashing.
class SharedPrefsFailedStore implements FailedStore {
  const SharedPrefsFailedStore();

  @override
  Future<List<PendingMutation>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kFailedStorageKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(PendingMutation.fromJson)
          .toList();
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> save(List<PendingMutation> items) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kFailedStorageKey,
        jsonEncode(items.map((m) => m.toJson()).toList()),
      );
    } catch (e) {
      // KNOWN DATA-LOSS VECTOR: if this durable write fails (quota / access
      // denied) AND the app is force-killed before the next successful save,
      // the item is absent from BOTH the pending and failed stores on restart —
      // i.e. a queued write is silently lost, the one thing this phase otherwise
      // prevents. The in-memory cache stays correct for the current session, so
      // a graceful restart is fine; only a storage failure + hard kill loses it.
      // This is a very-low-probability SharedPreferences edge. We do NOT
      // re-throw (that just moves the imperfection up the stack); instead we log
      // it so the loss is not fully invisible in the field.
      debugPrint(
          'hh: failed-store persist FAILED, item may be lost on restart: $e');
    }
  }
}
