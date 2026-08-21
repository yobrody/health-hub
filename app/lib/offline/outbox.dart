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

import 'dart:async';

import '../sync/send_result.dart';
import 'failed_store.dart';
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

// ── SyncSnapshot ─────────────────────────────────────────────────────────────

/// An honest, at-a-glance view of the Outbox for the UI.
///
/// Nothing here is ever fabricated: [pendingCount] is the real number of writes
/// still queued for replay, and [failedCount] is the real number that could not
/// sync (a permanent server reject, or one that exhausted `kMaxTries`) and are
/// surfaced to the user rather than silently dropped. The [status] derives a
/// single tri-state from the two counts — with a failure present it NEVER
/// reports a clean "synced".
class SyncSnapshot {
  const SyncSnapshot({required this.pendingCount, required this.failedCount});

  const SyncSnapshot.empty()
      : pendingCount = 0,
        failedCount = 0;

  final int pendingCount;
  final int failedCount;

  /// The single honest state the UI shows.
  ///  * [SyncStatus.failed]  — at least one write could not sync (takes
  ///    precedence: the user must be told, even if others are still pending).
  ///  * [SyncStatus.pending] — writes are queued and none have failed.
  ///  * [SyncStatus.synced]  — nothing queued and nothing failed. Only THEN.
  SyncStatus get status {
    if (failedCount > 0) return SyncStatus.failed;
    if (pendingCount > 0) return SyncStatus.pending;
    return SyncStatus.synced;
  }

  @override
  bool operator ==(Object other) =>
      other is SyncSnapshot &&
      other.pendingCount == pendingCount &&
      other.failedCount == failedCount;

  @override
  int get hashCode => Object.hash(pendingCount, failedCount);

  @override
  String toString() =>
      'SyncSnapshot(pending: $pendingCount, failed: $failedCount)';
}

/// The tri-state the UI renders. See [SyncSnapshot.status].
enum SyncStatus { synced, pending, failed }

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
  Outbox(this._store, {FailedStore? failedStore})
      : _failedStore = failedStore ?? InMemoryFailedStore();

  final OutboxStore _store;

  /// Durable store for mutations that FAILED to sync (permanent reject, or
  /// tries exhausted). Separate from [_store] so the pending queue and the
  /// failed list can never clobber each other. Defaults to an in-memory store
  /// when not supplied — the failed items still surface within the session.
  final FailedStore _failedStore;

  // In-memory cache — avoids a load() round-trip on every enqueue/pending call.
  List<PendingMutation>? _cache;

  // In-memory cache for the failed list.
  List<PendingMutation>? _failedCache;

  // Broadcasts a fresh [SyncSnapshot] on every change to the pending or failed
  // lists, so a status provider can react without polling. Broadcast so multiple
  // listeners (a banner, a settings line) can subscribe.
  final StreamController<SyncSnapshot> _snapshots =
      StreamController<SyncSnapshot>.broadcast();

  /// A live stream of the sync state. Emits after every enqueue / flush change.
  /// Listen to drive an honest UI indicator (pending / failed / synced).
  Stream<SyncSnapshot> get snapshots => _snapshots.stream;

  // Serializes all mutating critical sections (load→modify→persist). Without
  // this, two near-simultaneous enqueue calls — or an enqueue interleaved with
  // a flush — both read the same cache snapshot and the second persist clobbers
  // the first, permanently losing a queued write (data loss). Mutations chain
  // on this tail future so no two run concurrently.
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

  Future<List<PendingMutation>> _load() async {
    _cache ??= await _store.load();
    return _cache!;
  }

  Future<void> _persist(List<PendingMutation> items) async {
    await _persistQuiet(items);
    _emitSnapshot();
  }

  /// Persist the pending list WITHOUT broadcasting a snapshot. Used mid-way
  /// through an atomic move (pending→failed) so the stream never emits the
  /// intermediate state — which would momentarily read as a fabricated "synced"
  /// (pending down, failed not yet up). Only the final step broadcasts.
  Future<void> _persistQuiet(List<PendingMutation> items) async {
    _cache = items;
    await _store.save(items);
  }

  Future<List<PendingMutation>> _loadFailed() async {
    _failedCache ??= await _failedStore.load();
    return _failedCache!;
  }

  Future<void> _persistFailed(List<PendingMutation> items) async {
    _failedCache = items;
    await _failedStore.save(items);
    _emitSnapshot();
  }

  /// Emit a fresh snapshot from the current in-memory caches (best-effort — if
  /// a cache hasn't loaded yet it counts as empty, which the next load corrects).
  void _emitSnapshot() {
    if (_snapshots.isClosed) return;
    _snapshots.add(SyncSnapshot(
      pendingCount: _cache?.length ?? 0,
      failedCount: _failedCache?.length ?? 0,
    ));
  }

  /// Add [mutation] to the queue (deduping by [PendingMutation.dedupeKey]).
  ///
  /// This is the "offline success" path — callers should treat the returned
  /// [Future] completing without error as [WriteOutcome.queued].
  Future<void> enqueue(PendingMutation mutation) => _synchronized(() async {
        final current = await _load();
        await _persist(enqueueInto(current, mutation));
      });

  /// Returns the current pending mutations in FIFO order.
  Future<List<PendingMutation>> pending() async => List.unmodifiable(await _load());

  /// Returns the mutations that FAILED to sync (surfaced, never dropped).
  Future<List<PendingMutation>> failed() async =>
      List.unmodifiable(await _loadFailed());

  /// A one-shot [SyncSnapshot] of the current pending + failed counts. Handy for
  /// an initial UI render before the [snapshots] stream emits.
  Future<SyncSnapshot> snapshot() async => SyncSnapshot(
        pendingCount: (await _load()).length,
        failedCount: (await _loadFailed()).length,
      );

  /// Release the snapshot stream. Call when the owning provider is disposed.
  Future<void> dispose() async {
    if (!_snapshots.isClosed) await _snapshots.close();
  }

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
        // Atomic load→remove→persist so a concurrent enqueue is not clobbered
        // and a sent item is never resurrected by a stale snapshot.
        await _synchronized(() async {
          await _persist(removeItem(await _load(), item.id));
        });
      } else {
        break; // Still offline — leave remaining items untouched.
      }
    }
  }

  /// Flush the queue with full retry/reject classification (P4-E).
  ///
  /// For each pending mutation in FIFO order, [classify] returns a [SendResult]
  /// the Outbox acts on honestly:
  ///
  ///  * [SendResult.sent] → remove from the queue (the write is confirmed).
  ///
  ///  * [SendResult.retryEnvironment] → we're offline / not signed in. Leave the
  ///    WHOLE queue intact, do NOT bump tries (it isn't a bad mutation), and
  ///    STOP — every later item would fail identically. (Preserves the original
  ///    stop-on-offline behaviour.) A thrown classifier is treated the same way.
  ///
  ///  * [SendResult.retryTransient] → a 5xx / timeout on THIS mutation. BUMP its
  ///    tries; if that reaches [kMaxTries] MOVE it to the failed state (so a
  ///    chronically-failing write can't wedge the queue), else leave it queued.
  ///    Either way CONTINUE to the next item.
  ///
  ///  * [SendResult.rejectPermanent] → a bad mutation a retry can't fix. MOVE it
  ///    to the failed state IMMEDIATELY and CONTINUE — a permanently-bad write
  ///    must never trap the good writes behind it in the FIFO queue
  ///    (head-of-line blocking). It is surfaced, never silently dropped.
  ///
  /// The [_synchronized] lock guards every persist so a concurrent enqueue is
  /// never lost and a handled item is never resurrected.
  Future<void> flushClassified(
    Future<SendResult> Function(PendingMutation) classify,
  ) async {
    final items = List<PendingMutation>.from(await _load());
    for (final item in items) {
      SendResult result;
      try {
        result = await classify(item);
      } catch (_) {
        // An unclassified throw is environmental (network) by default — never a
        // reason to drop or reject a write. Stay queued, stop.
        break;
      }

      switch (result) {
        case SendResult.sent:
          await _synchronized(() async {
            await _persist(removeItem(await _load(), item.id));
          });

        case SendResult.retryEnvironment:
          // Offline / no-auth — leave everything queued, no bump, stop.
          return;

        case SendResult.retryTransient:
          // Bump this item's tries; expire → failed once it hits the ceiling.
          await _synchronized(() async {
            final bumped = bumpTries(await _load(), item.id);
            final me = bumped.firstWhere((m) => m.id == item.id);
            if (me.tries >= kMaxTries) {
              // Exhausted — move to failed (surfaced), out of the pending queue.
              await _moveToFailedLocked(bumped, me);
            } else {
              await _persist(bumped);
            }
          });
          // Continue to the next item — a transient failure on ONE mutation must
          // not stop the others (only an environmental/offline result stops).

        case SendResult.rejectPermanent:
          // Head-of-line-block fix: pull the bad mutation OUT immediately and
          // keep going so good writes behind it still sync. Surfaced as failed.
          await _synchronized(() async {
            final current = await _load();
            final me = current.firstWhere(
              (m) => m.id == item.id,
              orElse: () => item,
            );
            await _moveToFailedLocked(current, me);
          });
      }
    }
  }

  /// Move [mutation] from the pending list [current] into the durable failed
  /// list. MUST be called inside [_synchronized]. Deduped by id in both lists so
  /// a replay never double-records. The write is surfaced, never dropped.
  Future<void> _moveToFailedLocked(
    List<PendingMutation> current,
    PendingMutation mutation,
  ) async {
    // Remove from pending QUIETLY — no broadcast yet, so the stream never sees
    // the intermediate "pending down, failed not yet up" state (a transient
    // fake "synced"). Ensure the failed list is loaded first so the single
    // broadcast below carries an accurate failedCount.
    final failedNow = await _loadFailed();
    await _persistQuiet(removeItem(current, mutation.id));
    // Add to failed (replacing any stale entry with the same id) and broadcast
    // the complete, correct state exactly once.
    final deduped = failedNow.where((m) => m.id != mutation.id).toList()
      ..add(mutation);
    await _persistFailed(deduped);
  }

  /// Requeue every FAILED mutation for another flush attempt, resetting its
  /// [PendingMutation.tries] to 0 (a user-initiated "try again"). The failed
  /// list is cleared; the items rejoin the pending queue (deduped by dedupeKey).
  /// Nothing is dropped — the writes move from surfaced-failed back to pending.
  Future<void> retryFailed() => _synchronized(() async {
        final failedNow = await _loadFailed();
        if (failedNow.isEmpty) return;
        var pendingNow = await _load();
        for (final m in failedNow) {
          final requeued = PendingMutation(
            id: m.id,
            dedupeKey: m.dedupeKey,
            method: m.method,
            path: m.path,
            body: m.body,
            createdAt: m.createdAt,
            // Reset the counter — the user is explicitly asking to retry.
          );
          pendingNow = enqueueInto(pendingNow, requeued);
        }
        await _persist(pendingNow);
        await _persistFailed(const []);
      });
}
