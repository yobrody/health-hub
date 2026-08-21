// Widget tests for the app-wide SyncStatusBanner (P4-E).
//
// It reflects the REAL Outbox state via syncStatusProvider and must be honest:
//   • synced  → renders nothing (no fake "all good" reassurance);
//   • pending → a quiet "Syncing…" line;
//   • failed  → a "couldn't sync" warning + a Try-again that requeues.
// No network, no platform channel — an in-memory Outbox drives every state.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/offline/failed_store.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/sync/send_result.dart';
import 'package:health_hub/sync/sync_status_banner.dart';

class _FakeOutboxStore implements OutboxStore {
  _FakeOutboxStore([List<PendingMutation>? seed]) : _items = seed ?? [];
  List<PendingMutation> _items;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class _FakeFailedStore implements FailedStore {
  _FakeFailedStore([List<PendingMutation>? seed]) : _items = seed ?? [];
  List<PendingMutation> _items;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

PendingMutation _mut(String id) => PendingMutation(
      id: id,
      dedupeKey: id,
      method: 'POST',
      path: '/food',
      body: {'id': id},
      createdAt: 0,
    );

Future<void> _pump(WidgetTester tester, Outbox outbox) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [outboxProvider.overrideWithValue(outbox)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: SyncStatusBanner()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('synced state renders nothing (no fake reassurance)',
      (tester) async {
    final outbox = Outbox(_FakeOutboxStore(), failedStore: _FakeFailedStore());
    await _pump(tester, outbox);
    expect(find.byKey(const Key('sync-status-pending')), findsNothing);
    expect(find.byKey(const Key('sync-status-failed')), findsNothing);
  });

  testWidgets('pending state shows a Syncing… line', (tester) async {
    final outbox =
        Outbox(_FakeOutboxStore([_mut('a')]), failedStore: _FakeFailedStore());
    await _pump(tester, outbox);
    expect(find.byKey(const Key('sync-status-pending')), findsOneWidget);
    expect(find.textContaining('Syncing'), findsOneWidget);
    expect(find.byKey(const Key('sync-status-failed')), findsNothing);
  });

  testWidgets('failed state shows the warning + a Try-again affordance',
      (tester) async {
    final outbox =
        Outbox(_FakeOutboxStore([_mut('bad')]), failedStore: _FakeFailedStore());
    // Move 'bad' to the failed list (a permanent reject).
    await outbox.flushClassified((m) async => SendResult.rejectPermanent);
    await _pump(tester, outbox);

    expect(find.byKey(const Key('sync-status-failed')), findsOneWidget);
    expect(find.textContaining("couldn't sync"), findsOneWidget);
    expect(find.byKey(const Key('sync-status-retry')), findsOneWidget);
  });

  testWidgets('Try-again requeues the failed writes (failed → pending)',
      (tester) async {
    final outbox =
        Outbox(_FakeOutboxStore([_mut('bad')]), failedStore: _FakeFailedStore());
    await outbox.flushClassified((m) async => SendResult.rejectPermanent);
    await _pump(tester, outbox);
    expect(find.byKey(const Key('sync-status-failed')), findsOneWidget);

    await tester.tap(find.byKey(const Key('sync-status-retry')));
    await tester.pumpAndSettle();

    // The write moved back to pending → the banner now reads "Syncing…", never
    // a fake "synced" (the write still hasn't reached the server).
    expect(await outbox.failed(), isEmpty);
    expect((await outbox.pending()).single.id, 'bad');
    expect(find.byKey(const Key('sync-status-pending')), findsOneWidget);
    expect(find.byKey(const Key('sync-status-failed')), findsNothing);
  });
}
