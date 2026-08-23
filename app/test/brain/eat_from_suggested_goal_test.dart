// End-to-end: a TDEE-derived goal SUGGESTION, once SAVED, makes the Brain's EAT
// insight fire honestly — instead of the "Set a daily goal" setup prompt.
//
// This ties the three pieces together with real code (no mocked engine):
//   suggestGoals(real profile) → NutritionGoalsRepo.save → repo.load →
//   computeInsights → a real EAT insight grounded in the saved calorie/protein.
//
// It proves the feature's payoff: a suggestion the user confirmed becomes a REAL
// goal the Brain reasons over — the whole point of the honest suggest flow.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/brain/brain.dart';
import 'package:health_hub/brain/insight.dart';
import 'package:health_hub/nutrition/goal_suggestions.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_model.dart';

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

void main() {
  test('a saved TDEE suggestion makes the EAT insight fire (not the setup prompt)',
      () async {
    // 1. A real, complete profile.
    const profile = Profile(
      heightCm: 180,
      ageYears: 30,
      sex: 'male',
      weightKg: 80,
      goalDirection: 'gain',
      activityLevel: 'sedentary',
    );

    // 2. Compute the honest suggestion from that real data.
    final suggestion = suggestGoals(
      heightCm: profile.heightCm,
      ageYears: profile.ageYears,
      sex: profile.sex,
      weightKg: profile.weightKg,
      activity: ActivityLevel.fromName(profile.activityLevel)!,
      direction: profile.goalDirection,
    )!;
    expect(suggestion.calories, 2350);
    expect(suggestion.protein, 160);

    // 3. Save it through the REAL repo (as the user confirming in the editor).
    final store = _FakeGoalsStore();
    final repo = NutritionGoalsRepo(
      outbox: Outbox(_FakeOutboxStore()),
      store: store,
    );
    await repo.save(NutritionGoals(
      caloriesKcal: suggestion.calories,
      proteinG: suggestion.protein,
    ));

    // 4. Load it back and feed the Brain (no mocked engine).
    final goals = await repo.load();
    final insights = computeInsights(BrainInputs(
      now: DateTime(2026, 8, 22, 12),
      goals: goals,
      profile: profile,
    ));

    // 5. A real EAT insight fires, grounded in the saved numbers — the honest
    //    "Set a daily goal" setup prompt is gone.
    final eat = insights.firstWhere((i) => i.kind == InsightKind.eat);
    expect(insights.any((i) => i.id == 'eat-setup'), isFalse);
    // Nothing eaten yet → the full goal is "left today".
    expect(eat.title, contains('2350 kcal'));
    expect(eat.title, contains('160 g protein'));
    // Its `why` cites the REAL saved goal (not a fabricated target).
    expect(
      eat.why.any((w) => w.label == 'Calorie goal' && w.value == '2350 kcal'),
      isTrue,
    );
    expect(
      eat.why.any((w) => w.label == 'Protein goal' && w.value == '160 g'),
      isTrue,
    );
  });

  test('WITHOUT a saved goal the Brain honestly shows the setup prompt', () async {
    // Same complete profile, but no goal saved → the Brain must NOT invent one.
    const profile = Profile(
      heightCm: 180,
      ageYears: 30,
      sex: 'male',
      weightKg: 80,
      goalDirection: 'gain',
      activityLevel: 'sedentary',
    );
    final insights = computeInsights(BrainInputs(
      now: DateTime(2026, 8, 22, 12),
      goals: const NutritionGoals(), // unset
      profile: profile,
    ));
    // The honest setup prompt, never a fabricated EAT target from the profile.
    expect(insights.any((i) => i.id == 'eat-setup'), isTrue);
    expect(insights.any((i) => i.kind == InsightKind.eat), isFalse);
  });
}
