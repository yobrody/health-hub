import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'pending_mutation.dart';

/// Storage interface for the outbox queue.
///
/// Separating the interface from the implementation lets unit tests inject an
/// in-memory fake ([FakeOutboxStore] is defined in the test file) without
/// touching shared_preferences or any platform channel.
abstract class OutboxStore {
  Future<List<PendingMutation>> load();
  Future<void> save(List<PendingMutation> items);
}

// ── SharedPreferences-backed real implementation ───────────────────────────

const _kStorageKey = 'hh_outbox_v1';

/// Production [OutboxStore] backed by [SharedPreferences].
///
/// NOT unit-tested directly (platform channel); exercised by integration /
/// widget tests when needed. The interface above enables full unit coverage of
/// all business logic via the in-memory fake.
class SharedPrefsOutboxStore implements OutboxStore {
  const SharedPrefsOutboxStore();

  @override
  Future<List<PendingMutation>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kStorageKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map<String, dynamic>>()
          .map(PendingMutation.fromJson)
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<PendingMutation> items) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kStorageKey,
        jsonEncode(items.map((m) => m.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — keep going; the in-memory state is still
      // correct for this session, mirroring the legacy localStorage behaviour.
    }
  }
}
