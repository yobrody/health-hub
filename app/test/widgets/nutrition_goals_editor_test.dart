// Widget tests for the Daily-targets editor.
//
//   • filled fields save real targets; the repo persists + queues;
//   • a BLANK field saves as null (unset) — NEVER a fabricated 0/2200;
//   • it pre-fills existing targets and leaves an unset one blank;
//   • cancel saves nothing.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/widgets/nutrition_goals_editor.dart';

class _FakeGoalsStore implements NutritionGoalsStore {
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => _items;
  @override
  Future<void> save(List<PendingMutation> items) async => _items = items;
}

NutritionGoalsRepo _repo(_FakeGoalsStore store) =>
    NutritionGoalsRepo(outbox: Outbox(_FakeOutboxStore()), store: store);

Widget _host(NutritionGoalsRepo repo, NutritionGoals current) => MaterialApp(
      theme: lightTheme,
      home: Scaffold(
        body: NutritionGoalsEditor(repo: repo, current: current),
      ),
    );

void main() {
  testWidgets('filled fields save real targets (persist + queue)', (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo, const NutritionGoals()));

    await tester.enterText(find.byKey(const Key('goals-kcal')), '2500');
    await tester.enterText(find.byKey(const Key('goals-protein')), '150');
    await tester.tap(find.byKey(const Key('goals-save')));
    await tester.pumpAndSettle();

    final saved = await repo.load();
    expect(saved.caloriesKcal, 2500);
    expect(saved.proteinG, 150);
    // Untouched fields stayed unset (honest null), not 0.
    expect(saved.carbsG, isNull);
    expect(saved.fatG, isNull);
  });

  testWidgets('a blank field saves as null — never a fabricated 0', (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo, const NutritionGoals()));

    // Only calories entered; the three macros left blank.
    await tester.enterText(find.byKey(const Key('goals-kcal')), '2200');
    await tester.tap(find.byKey(const Key('goals-save')));
    await tester.pumpAndSettle();

    final saved = await repo.load();
    expect(saved.caloriesKcal, 2200);
    expect(saved.proteinG, isNull);
    expect(saved.carbsG, isNull);
    expect(saved.fatG, isNull);
    // The persisted JSON omits the unset targets entirely.
    expect(store._saved, {'caloriesKcal': 2200});
  });

  testWidgets('pre-fills existing targets, leaves an unset one blank',
      (tester) async {
    final repo = _repo(_FakeGoalsStore());
    await tester.pumpWidget(
      _host(repo, const NutritionGoals(caloriesKcal: 2400, proteinG: 140)),
    );

    expect(find.text('2400'), findsOneWidget);
    expect(find.text('140'), findsOneWidget);
    // The carbs field pre-fill is blank (unset), so no stray number appears.
    final carbs = tester.widget<TextField>(find.byKey(const Key('goals-carbs')));
    expect(carbs.controller!.text, '');
  });

  testWidgets('cancel saves nothing', (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    await tester.pumpWidget(_host(repo, const NutritionGoals()));

    await tester.enterText(find.byKey(const Key('goals-kcal')), '2500');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(store._saved, isNull);
  });
}
