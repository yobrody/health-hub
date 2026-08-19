// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import '../api/probe_status.dart';
import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'connectivity_monitor.dart';

/// The slice of `ApiClient` [SyncService] needs to replay a queued mutation.
/// `ApiClient` satisfies it directly; tests inject a fake.
abstract class MutationSender {
  Future<ProbeStatus> sendMutation(PendingMutation m);
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
  Future<void> flushNow() {
    return _outbox.flush(
      (m) async => (await _sender.sendMutation(m)) == ProbeStatus.online,
    );
  }

  /// Stop listening. Safe to call more than once.
  Future<void> dispose() async {
    await _sub?.cancel();
    _sub = null;
  }
}
