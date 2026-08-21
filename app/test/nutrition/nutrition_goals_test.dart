// Model tests for NutritionGoals — the honesty rules of the daily-targets
// singleton: every target nullable, nulls omitted from toJson (never 0/2200),
// a genuine 0 preserved, round-trip fidelity, copyWith.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';

void main() {
  test('an empty goals object is isEmpty and serialises to {}', () {
    const g = NutritionGoals();
    expect(g.isEmpty, isTrue);
    expect(g.toJson(), isEmpty);
  });

  test('toJson omits null targets — never a fabricated 0/2200', () {
    const g = NutritionGoals(caloriesKcal: 2500);
    final json = g.toJson();
    expect(json, {'caloriesKcal': 2500});
    // The three unset macros are absent, not 0.
    expect(json.containsKey('proteinG'), isFalse);
    expect(json.containsKey('carbsG'), isFalse);
    expect(json.containsKey('fatG'), isFalse);
  });

  test('a genuine 0 target is a real value and is preserved', () {
    const g = NutritionGoals(fatG: 0);
    expect(g.isEmpty, isFalse);
    expect(g.toJson(), {'fatG': 0});
    expect(NutritionGoals.fromJson(g.toJson()).fatG, 0);
  });

  test('round-trips all four targets faithfully', () {
    const g = NutritionGoals(
      caloriesKcal: 2500,
      proteinG: 150,
      carbsG: 250,
      fatG: 70,
    );
    final back = NutritionGoals.fromJson(g.toJson());
    expect(back.caloriesKcal, 2500);
    expect(back.proteinG, 150);
    expect(back.carbsG, 250);
    expect(back.fatG, 70);
    expect(back.isEmpty, isFalse);
  });

  test('fromJson: absent + explicit-null BOTH become null (no coalesce)', () {
    final g = NutritionGoals.fromJson({'caloriesKcal': null});
    expect(g.caloriesKcal, isNull);
    expect(g.isEmpty, isTrue);
  });

  test('copyWith overrides only the given target, keeps the rest', () {
    const g = NutritionGoals(caloriesKcal: 2000, proteinG: 120);
    final g2 = g.copyWith(proteinG: 150);
    expect(g2.caloriesKcal, 2000);
    expect(g2.proteinG, 150);
  });
}
