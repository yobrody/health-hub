// Widget tests for the quick log-weight sheet.
//
//   • a valid number logs a weigh-in (persist + queue) anchored to now;
//   • Save is DISABLED until a real number is entered (never a fabricated 0);
//   • cancel logs nothing.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/widgets/log_weight_sheet.dart';

class _FakeWeighInStore implements WeighInStore {
  List<WeighIn> _items = [];
  @override
  Future<List<WeighIn>> load() async => _items;
  @override
  Future<void> save(List<WeighIn> items) async => _items = items;
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => _items;
  @override
  Future<void> save(List<PendingMutation> items) async => _items = items;
}

WeighInRepo _repo(_FakeWeighInStore store) =>
    WeighInRepo(outbox: Outbox(_FakeOutboxStore()), store: store);

Widget _host(WeighInRepo repo) => MaterialApp(
      theme: lightTheme,
      home: Scaffold(body: LogWeightSheet(repo: repo)),
    );

void main() {
  testWidgets('a valid number logs a weigh-in (persist + queue)', (tester) async {
    final store = _FakeWeighInStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo));

    await tester.enterText(find.byKey(const Key('log-weight-field')), '62.5');
    await tester.pump(); // let the button enable
    await tester.tap(find.byKey(const Key('log-weight-save')));
    await tester.pumpAndSettle();

    final all = await repo.all();
    expect(all.single.weightKg, 62.5);
    // Anchored to a real moment.
    expect(all.single.at, isNotNull);
    // And queued for sync.
    expect((await repo.outbox.pending()).single.path, '/weigh-ins');
  });

  testWidgets('Save is disabled until a real number is entered', (tester) async {
    final store = _FakeWeighInStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo));

    // No input yet → the Log button is disabled.
    FilledButton btn() => tester.widget<FilledButton>(
        find.byKey(const Key('log-weight-save')));
    expect(btn().onPressed, isNull);

    // A non-numeric entry keeps it disabled (never a fabricated 0).
    await tester.enterText(find.byKey(const Key('log-weight-field')), 'abc');
    await tester.pump();
    expect(btn().onPressed, isNull);

    // A real number enables it.
    await tester.enterText(find.byKey(const Key('log-weight-field')), '63');
    await tester.pump();
    expect(btn().onPressed, isNotNull);
  });

  testWidgets('cancel logs nothing', (tester) async {
    final store = _FakeWeighInStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo));

    await tester.enterText(find.byKey(const Key('log-weight-field')), '62.5');
    await tester.pump();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(await repo.all(), isEmpty);
  });
}
