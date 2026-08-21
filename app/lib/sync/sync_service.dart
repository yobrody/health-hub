// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import '../api/probe_status.dart';
import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'connectivity_monitor.dart';
import 'send_result.dart';

export 'send_result.dart' show SendResult;

/// The slice of `ApiClient` [SyncService] needs to replay a queued mutation.
/// `ApiClient` satisfies it directly; tests inject a fake.
///
/// A sender exposes TWO views of the same attempt:
///  * [sendMutation] → a coarse [ProbeStatus] (kept for backward compatibility
///    and for the health-probe callers).
///  * [classifySend] → the richer [SendResult] the Outbox needs to decide
///    retry-vs-reject. Each concrete sender implements it from what it can
///    actually see: [ApiClient] reads the HTTP status; [SupabaseSyncSender]
///    reads PostgREST error codes to tell a permanent rejection apart from a
///    transient one. A sender that only has a coarse [ProbeStatus] can reuse
///    [sendResultFromProbe] — the safe never-drop mapping.
abstract class MutationSender {
  Future<ProbeStatus> sendMutation(PendingMutation m);

  /// Classify a send attempt into the richer [SendResult] the Outbox uses to
  /// decide retry-vs-reject. See [SendResult] for what each value means.
  Future<SendResult> classifySend(PendingMutation m);
}

/// Maps a coarse [ProbeStatus] to a [SendResult] the SAFE way: an ambiguous
/// non-online result is environmental (retry), never a permanent reject (which
/// would move a write out of the queue). A sender that only knows [ProbeStatus]
/// — or a test fake — reuses this so the never-drop mapping is identical.
SendResult sendResultFromProbe(ProbeStatus status) {
  switch (status) {
    case ProbeStatus.online:
      return SendResult.sent;
    case ProbeStatus.degraded:
      return SendResult.retryTransient;
    case ProbeStatus.offline:
      return SendResult.retryEnvironment;
  }
}

/// Drains the offline [Outbox] when connectivity returns.
///
/// This is the FIRST real flush caller — until P1 Task 1 the [Outbox] was
/// written to (offline saves queued) but nothing ever replayed it, so the app
/// was effectively offline-only. [SyncService] listens to a
/// [ConnectivityMonitor]; on each `online` event it flushes the shared Outbox,
/// replaying every queued [PendingMutation] via [MutationSender.sendMutation].
///
/// Flush contract (basic online/offline — full reject/max-tries is P3 Task 11):
///  - `sendMutation` → [ProbeStatus.online]  → the mutation is removed.
///  - anything else (`degraded`/`offline`)   → it stays queued and the flush
///    stops (we assume we are still unhealthy/offline). No mutation is ever
///    silently dropped, and a queued write is never reported as a failure.
class SyncService {
  SyncService({
    required Outbox outbox,
    required MutationSender sender,
    required ConnectivityMonitor monitor,
  })  : _outbox = outbox,
        _sender = sender,
        _monitor = monitor;

  final Outbox _outbox;
  final MutationSender _sender;
  final ConnectivityMonitor _monitor;

  StreamSubscription<bool>? _sub;

  /// Begin listening for connectivity changes. Idempotent.
  void start() {
    _sub ??= _monitor.onOnline.listen((online) {
      if (online) {
        // Fire-and-forget: a flush that fails simply leaves the queue intact for
        // the next `online` event.
        unawaited(flushNow());
      }
    });
  }

  /// Flush the queue once, now. Exposed so the app can trigger an eager flush at
  /// startup (in case connectivity was already up) and so tests can drive it
  /// deterministically without a real connectivity stream.
  ///
  /// Uses the sender's richer [MutationSender.classifySend] so the Outbox can
  /// retry transient failures, expire stuck ones, and move permanent rejects to
  /// the surfaced failed state — without a head-of-line block.
  Future<void> flushNow() {
    return _outbox.flushClassified(_sender.classifySend);
  }

  /// Stop listening. Safe to call more than once.
  Future<void> dispose() async {
    await _sub?.cancel();
    _sub = null;
  }
}
