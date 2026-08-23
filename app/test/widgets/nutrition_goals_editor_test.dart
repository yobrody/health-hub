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
import 'package:health_hub/profile/profile_model.dart';
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

Widget _host(
  NutritionGoalsRepo repo,
  NutritionGoals current, {
  Profile? profile,
}) =>
    MaterialApp(
      theme: lightTheme,
      home: Scaffold(
        body: NutritionGoalsEditor(
          repo: repo,
          current: current,
          profile: profile,
        ),
      ),
    );

/// A complete profile — enough for a real TDEE suggestion. Male sedentary gain,
/// 80 kg / 180 cm / 30 yr: BMR 1780 × 1.2 = 2136; +200 surplus → 2350 kcal;
/// protein 80 × 2.0 = 160 g.
const _completeProfile = Profile(
  heightCm: 180,
  ageYears: 30,
  sex: 'male',
  weightKg: 80,
  goalDirection: 'gain',
  activityLevel: 'sedentary',
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

  // ── Suggest from your body (TDEE) ──────────────────────────────────────────

  testWidgets(
      'complete profile: Suggest PREFILLS calorie + protein (not auto-saved)',
      (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    await tester.pumpWidget(
      _host(repo, const NutritionGoals(), profile: _completeProfile),
    );

    await tester.tap(find.byKey(const Key('goals-suggest-tdee')));
    await tester.pumpAndSettle();

    // Fields prefilled with the honest estimate — 2350 kcal, 160 g protein.
    final kcal = tester.widget<TextField>(find.byKey(const Key('goals-kcal')));
    final protein =
        tester.widget<TextField>(find.byKey(const Key('goals-protein')));
    expect(kcal.controller!.text, '2350');
    expect(protein.controller!.text, '160');

    // Disclosed as an ESTIMATE.
    expect(find.byKey(const Key('goals-suggestion-note')), findsOneWidget);

    // NOTHING saved until the user confirms — no persist, no queued mutation.
    expect(store._saved, isNull);
  });

  testWidgets('the suggestion is saved only after the user confirms (Save)',
      (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    await tester.pumpWidget(
      _host(repo, const NutritionGoals(), profile: _completeProfile),
    );

    await tester.tap(find.byKey(const Key('goals-suggest-tdee')));
    await tester.pumpAndSettle();
    // User accepts the estimate as-is and Saves.
    await tester.tap(find.byKey(const Key('goals-save')));
    await tester.pumpAndSettle();

    final saved = await repo.load();
    expect(saved.caloriesKcal, 2350);
    expect(saved.proteinG, 160);
  });

  testWidgets('incomplete profile: honest prompt, NO fabricated numbers',
      (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    // Missing weight + activity → cannot suggest.
    await tester.pumpWidget(
      _host(
        repo,
        const NutritionGoals(),
        profile: const Profile(heightCm: 180, ageYears: 30, sex: 'male'),
      ),
    );

    await tester.tap(find.byKey(const Key('goals-suggest-tdee')));
    await tester.pumpAndSettle();

    // Honest "add your body data" prompt, not a prefilled number.
    expect(find.byKey(const Key('goals-suggest-incomplete')), findsOneWidget);
    final kcal = tester.widget<TextField>(find.byKey(const Key('goals-kcal')));
    expect(kcal.controller!.text, ''); // still blank — nothing fabricated.
    expect(find.byKey(const Key('goals-suggestion-note')), findsNothing);
  });

  testWidgets(
      'no activity level in profile: picks one in the sheet, then prefills',
      (tester) async {
    final store = _FakeGoalsStore();
    final repo = _repo(store);
    // Complete body data but NO activity level → the picker appears.
    await tester.pumpWidget(
      _host(
        repo,
        const NutritionGoals(),
        profile: const Profile(
          heightCm: 180,
          ageYears: 30,
          sex: 'male',
          weightKg: 80,
          goalDirection: 'gain',
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('goals-suggest-tdee')));
    await tester.pumpAndSettle();
    // Activity picker shown; choose sedentary.
    expect(find.byKey(const Key('activity-sedentary')), findsOneWidget);
    await tester.tap(find.byKey(const Key('activity-sedentary')));
    await tester.pumpAndSettle();

    final kcal = tester.widget<TextField>(find.byKey(const Key('goals-kcal')));
    expect(kcal.controller!.text, '2350'); // same worked example.
  });
}
