// Offline outbox — the queue behind "Health Hub never loses a log on a flaky
// connection." When a mutating API call cannot reach the server, the request
// is captured here and persisted; on reconnect it is replayed in FIFO order.
//
// This module contains:
//   • Pure list operations (no I/O, fully unit-tested).
//   • The [Outbox] class that combines those ops with an [OutboxStore].
//   • [WriteOutcome] — the API surface that callers use to distinguish a
//     queued write (offline success) from a genuine failure.
//
// Parity notes vs. legacy `src/lib/outbox.ts`:
//   – Adds [dedupeKey] (replaces same-bucket mutations instead of stacking).
//   – [flush] stops at the FIRST failing send (false return or throw); this
//     matches the task-spec contract. The legacy replayed past server-rejects;
//     that distinction is noted in outbox.ts comments and the retry/bump logic
//     is preserved here via [bumpTries]/[dropExpired].
//   – [kMaxTries] = 8, matching `MAX_TRIES` in the legacy.

import 'pending_mutation.dart';
import 'outbox_store.dart';

// ── Constants (parity with legacy MAX_TRIES = 8) ─────────────────────────────

/// A mutation is considered permanently broken and should be dropped with
/// [dropExpired] once its [PendingMutation.tries] reaches this ceiling.
const int kMaxTries = 8;

// ── WriteOutcome ─────────────────────────────────────────────────────────────

/// What happened to a write attempted while potentially offline.
///
/// [queued] is a **success state** — the write is safely stored and will be
/// replayed when connectivity returns. Callers must NEVER show [queued] as an
/// error to the user; doing so violates the app's honesty/trust contract.
enum WriteOutcome {
  /// The server accepted the mutation immediately.
  sent,

  /// The network was unavailable; the mutation is safely queued for replay.
  /// This is a success state — never report it as failure.
  queued,

  /// The mutation was rejected by the server with a non-retryable error
  /// (e.g. validation failure). The request was not saved or retried.
  failed,
}

// ── Pure list operations (no I/O — unit-tested) ──────────────────────────────

/// Append [mutation] to [current], replacing any existing entry that shares
/// the same [PendingMutation.dedupeKey].
///
/// Rule: the queue is FIFO for distinct keys. When the same logical operation
/// is re-enqueued (same [dedupeKey]), the stale entry is removed and the fresh
/// one takes its place rather than accumulating duplicates.
List<PendingMutation> enqueueInto(
  List<PendingMutation> current,
  PendingMutation mutation,
) {
  // Remove the stale entry for this dedupeKey, if any.
  final withoutStale = current
      .where((m) => m.dedupeKey != mutation.dedupeKey)
      .toList();
  return [...withoutStale, mutation];
}

/// Remove the mutation with [id] from [items]. Returns a new list.
List<PendingMutation> removeItem(List<PendingMutation> items, String id) =>
    items.where((m) => m.id != id).toList();

/// Increment [PendingMutation.tries] for the item with [id].
/// Used after a server-side rejection to track how many times we have retried.
List<PendingMutation> bumpTries(List<PendingMutation> items, String id) =>
    items.map((m) => m.id == id
        ? PendingMutation(
            id: m.id,
            dedupeKey: m.dedupeKey,
            method: m.method,
            path: m.path,
            body: m.body,
            createdAt: m.createdAt,
            tries: m.tries + 1,
          )
        : m)
        .toList();

/// Drop mutations whose [PendingMutation.tries] has reached [maxTries].
/// Prevents a permanently-rejected request from wedging the queue forever.
List<PendingMutation> dropExpired(
  List<PendingMutation> items, {
  int maxTries = kMaxTries,
}) =>
    items.where((m) => m.tries < maxTries).toList();

// ── Outbox class ──────────────────────────────────────────────────────────────

/// Manages the offline mutation queue.
///
/// Combines the pure list operations above with an [OutboxStore] for
/// persistence. Inject a [SharedPrefsOutboxStore] in production or an
/// in-memory fake in tests.
class Outbox {
  Outbox(this._store);

  final OutboxStore _store;

  // In-memory cache — avoids a load() round-trip on every enqueue/pending call.
  List<PendingMutation>? _cache;

  Future<List<PendingMutation>> _load() async {
    _cache ??= await _store.load();
    return _cache!;
  }

  Future<void> _persist(List<PendingMutation> items) async {
    _cache = items;
    await _store.save(items);
  }

  /// Add [mutation] to the queue (deduping by [PendingMutation.dedupeKey]).
  ///
  /// This is the "offline success" path — callers should treat the returned
  /// [Future] completing without error as [WriteOutcome.queued].
  Future<void> enqueue(PendingMutation mutation) async {
    final current = await _load();
    await _persist(enqueueInto(current, mutation));
  }

  /// Returns the current pending mutations in FIFO order.
  Future<List<PendingMutation>> pending() async => List.unmodifiable(await _load());

  /// Attempt to send all pending mutations via [send].
  ///
  /// Mutations are sent in FIFO order. If [send] returns `true` the mutation
  /// is removed from the queue. If [send] returns `false` OR throws, the
  /// mutation stays queued and flushing stops — we assume we are still offline
  /// (or the server is unavailable) and leave the remaining items untouched
  /// for the next flush attempt.
  ///
  /// This stop-on-first-failure contract matches the task spec. Contrast with
  /// the legacy `replayQueue`, which only stopped on network errors and
  /// continued on server-rejects (bumping tries instead). The [bumpTries] and
  /// [dropExpired] helpers are available for callers that want that finer-grained
  /// distinction.
  Future<void> flush(Future<bool> Function(PendingMutation) send) async {
    final items = List<PendingMutation>.from(await _load());
    for (final item in items) {
      bool succeeded;
      try {
        succeeded = await send(item);
      } catch (_) {
        // Treat a throw the same as a false return — stay queued, stop.
        break;
      }
      if (succeeded) {
        await _persist(removeItem(await _load(), item.id));
      } else {
        break; // Still offline — leave remaining items untouched.
      }
    }
  }
}
