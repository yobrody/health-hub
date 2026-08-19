// Tests for SyncService — the FIRST real outbox-flush caller (P1 Task 1).
//
// When connectivity is (re)gained, SyncService flushes the shared Outbox,
// replaying each queued PendingMutation via ApiClient.sendMutation. A mutation
// that comes back `online` is removed; a `degraded`/`offline` one stays queued
// and flushing stops (basic online/offline contract — P3 owns reject/max-tries).
//
// Everything is driven through fakes: no connectivity_plus platform channel and
// no live Dio are required.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/sync/connectivity_monitor.dart';
import 'package:health_hub/sync/sync_service.dart';

class FakeOutboxStore implements OutboxStore {
  FakeOutboxStore([List<PendingMutation>? seed]) : _items = seed ?? [];
  List<PendingMutation> _items;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

/// A MutationSender fake (the narrow slice of ApiClient SyncService needs).
class FakeSender implements MutationSender {
  FakeSender(this._status);
  ProbeStatus _status;
  final List<PendingMutation> sent = [];
  set status(ProbeStatus s) => _status = s;
  @override
  Future<ProbeStatus> sendMutation(PendingMutation m) async {
    sent.add(m);
    return _status;
  }
}

/// A ConnectivityMonitor whose stream we can push events into by hand.
class FakeConnectivityMonitor implements ConnectivityMonitor {
  final _controller = StreamController<bool>.broadcast();
  @override
  Stream<bool> get onOnline => _controller.stream;
  void emitOnline() => _controller.add(true);
  void emitOffline() => _controller.add(false);
  Future<void> dispose() async => _controller.close();
}

PendingMutation _mut(String id) => PendingMutation(
      id: id,
      dedupeKey: id,
      method: 'PUT',
      path: '/tdee/profile',
      body: {'weight_kg': 62.5},
      createdAt: 0,
    );

void main() {
  test('regained connectivity flushes a queued mutation (online → removed)',
      () async {
    final store = FakeOutboxStore([_mut('a')]);
    final outbox = Outbox(store);
    final sender = FakeSender(ProbeStatus.online);
    final monitor = FakeConnectivityMonitor();

    final svc = SyncService(
      outbox: outbox,
      sender: sender,
      monitor: monitor,
    )..start();

    monitor.emitOnline();
    await Future<void>.delayed(Duration.zero);
    await svc.flushNow(); // deterministic settle

    expect(sender.sent.map((m) => m.id), ['a']);
    expect(await outbox.pending(), isEmpty);
    await svc.dispose();
    await monitor.dispose();
  });

  test('a non-online result keeps the mutation queued and stops', () async {
    final store = FakeOutboxStore([_mut('a'), _mut('b')]);
    final outbox = Outbox(store);
    final sender = FakeSender(ProbeStatus.offline);
    final monitor = FakeConnectivityMonitor();
    final svc = SyncService(outbox: outbox, sender: sender, monitor: monitor);

    await svc.flushNow();

    // First send returned offline → stays queued, flush stopped before 'b'.
    expect(sender.sent.map((m) => m.id), ['a']);
    final pending = await outbox.pending();
    expect(pending.map((m) => m.id), ['a', 'b']);
    await svc.dispose();
    await monitor.dispose();
  });

  test('degraded (5xx) also keeps the mutation queued', () async {
    final store = FakeOutboxStore([_mut('a')]);
    final outbox = Outbox(store);
    final sender = FakeSender(ProbeStatus.degraded);
    final svc = SyncService(
      outbox: outbox,
      sender: sender,
      monitor: FakeConnectivityMonitor(),
    );

    await svc.flushNow();
    expect((await outbox.pending()).map((m) => m.id), ['a']);
    await svc.dispose();
  });

  test('an offline connectivity event does not trigger a flush', () async {
    final store = FakeOutboxStore([_mut('a')]);
    final outbox = Outbox(store);
    final sender = FakeSender(ProbeStatus.online);
    final monitor = FakeConnectivityMonitor();
    SyncService(outbox: outbox, sender: sender, monitor: monitor).start();

    monitor.emitOffline();
    await Future<void>.delayed(Duration.zero);

    expect(sender.sent, isEmpty);
    await monitor.dispose();
  });

  test('empty queue: a flush is a harmless no-op', () async {
    final outbox = Outbox(FakeOutboxStore());
    final sender = FakeSender(ProbeStatus.online);
    final svc = SyncService(
      outbox: outbox,
      sender: sender,
      monitor: FakeConnectivityMonitor(),
    );
    await svc.flushNow();
    expect(sender.sent, isEmpty);
    await svc.dispose();
  });
}
