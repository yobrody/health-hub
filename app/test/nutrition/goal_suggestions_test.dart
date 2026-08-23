// Pure-logic tests for the TDEE-derived goal suggestions (Mifflin–St Jeor).
//
// These prove the engine is:
//  • correct — known worked examples for male + female;
//  • HONEST — null when ANY required input (height/age/sex/weight/direction) is
//    missing, never a fabricated default TDEE or goal;
//  • direction-aware — gain surplus / cut deficit / maintain hold;
//  • transparent — protein g/kg per direction; documented unknown-sex rule.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/goal_suggestions.dart';

void main() {
  group('mifflinBmr — known worked examples', () {
    test('male: 10·kg + 6.25·cm − 5·age + 5', () {
      // 80 kg, 180 cm, 30 yr → 800 + 1125 − 150 + 5 = 1780
      final bmr = mifflinBmr(
        heightCm: 180,
        ageYears: 30,
        sex: 'male',
        weightKg: 80,
      );
      expect(bmr, closeTo(1780, 1e-9));
    });

    test('female: 10·kg + 6.25·cm − 5·age − 161', () {
      // 60 kg, 165 cm, 30 yr → 600 + 1031.25 − 150 − 161 = 1320.25
      final bmr = mifflinBmr(
        heightCm: 165,
        ageYears: 30,
        sex: 'female',
        weightKg: 60,
      );
      expect(bmr, closeTo(1320.25, 1e-9));
    });

    test('accepts the short forms m / f', () {
      expect(
        mifflinBmr(heightCm: 180, ageYears: 30, sex: 'm', weightKg: 80),
        closeTo(1780, 1e-9),
      );
      expect(
        mifflinBmr(heightCm: 165, ageYears: 30, sex: 'F', weightKg: 60),
        closeTo(1320.25, 1e-9),
      );
    });

    test('unknown-but-present sex uses the AVERAGED constant (−78), disclosed', () {
      // 80 kg, 180 cm, 30 yr → 800 + 1125 − 150 + (−78) = 1697
      final bmr = mifflinBmr(
        heightCm: 180,
        ageYears: 30,
        sex: 'non-binary',
        weightKg: 80,
      );
      expect(bmr, closeTo(1697, 1e-9));
    });
  });

  group('mifflinBmr — honest null on missing input (no fabrication)', () {
    test('null when height missing', () {
      expect(
        mifflinBmr(heightCm: null, ageYears: 30, sex: 'male', weightKg: 80),
        isNull,
      );
    });
    test('null when age missing', () {
      expect(
        mifflinBmr(heightCm: 180, ageYears: null, sex: 'male', weightKg: 80),
        isNull,
      );
    });
    test('null when weight missing', () {
      expect(
        mifflinBmr(heightCm: 180, ageYears: 30, sex: 'male', weightKg: null),
        isNull,
      );
    });
    test('null when sex missing OR empty (can\'t pick a formula band)', () {
      expect(
        mifflinBmr(heightCm: 180, ageYears: 30, sex: null, weightKg: 80),
        isNull,
      );
      expect(
        mifflinBmr(heightCm: 180, ageYears: 30, sex: '   ', weightKg: 80),
        isNull,
      );
    });
    test('null for non-positive / non-finite inputs (not a fabricated 0)', () {
      expect(
        mifflinBmr(heightCm: 0, ageYears: 30, sex: 'male', weightKg: 80),
        isNull,
      );
      expect(
        mifflinBmr(heightCm: 180, ageYears: -1, sex: 'male', weightKg: 80),
        isNull,
      );
      expect(
        mifflinBmr(
            heightCm: double.nan, ageYears: 30, sex: 'male', weightKg: 80),
        isNull,
      );
    });
  });

  group('tdee — BMR × activity multiplier', () {
    test('applies the standard multipliers', () {
      const bmr = 1780.0;
      expect(tdee(bmr, ActivityLevel.sedentary), closeTo(1780 * 1.2, 1e-9));
      expect(tdee(bmr, ActivityLevel.light), closeTo(1780 * 1.375, 1e-9));
      expect(tdee(bmr, ActivityLevel.moderate), closeTo(1780 * 1.55, 1e-9));
      expect(tdee(bmr, ActivityLevel.active), closeTo(1780 * 1.725, 1e-9));
      expect(tdee(bmr, ActivityLevel.veryActive), closeTo(1780 * 1.9, 1e-9));
    });

    test('multiplier table is exactly the documented values', () {
      expect(ActivityLevel.sedentary.multiplier, 1.2);
      expect(ActivityLevel.light.multiplier, 1.375);
      expect(ActivityLevel.moderate.multiplier, 1.55);
      expect(ActivityLevel.active.multiplier, 1.725);
      expect(ActivityLevel.veryActive.multiplier, 1.9);
    });

    test('null BMR → null TDEE (propagates honestly)', () {
      expect(tdee(null, ActivityLevel.moderate), isNull);
      expect(tdee(0, ActivityLevel.moderate), isNull);
    });
  });

  group('ActivityLevel.fromName', () {
    test('round-trips every enum name', () {
      for (final level in ActivityLevel.values) {
        expect(ActivityLevel.fromName(level.name), level);
      }
    });
    test('null / unknown → null (never a fabricated default)', () {
      expect(ActivityLevel.fromName(null), isNull);
      expect(ActivityLevel.fromName('bogus'), isNull);
    });
  });

  group('suggestGoals — worked examples (calories + protein)', () {
    test('male sedentary gain: TDEE 2136 + 200 surplus → 2350; protein 160', () {
      final s = suggestGoals(
        heightCm: 180,
        ageYears: 30,
        sex: 'male',
        weightKg: 80,
        activity: ActivityLevel.sedentary,
        direction: 'gain',
      );
      expect(s, isNotNull);
      // BMR 1780 × 1.2 = 2136; +200 = 2336 → round50 = 2350.
      expect(s!.tdee, 2150); // 2136 → nearest 50
      expect(s.calorieDelta, kGainSurplusKcal);
      expect(s.calories, 2350);
      expect(s.proteinPerKg, 2.0);
      expect(s.protein, 160); // 80 × 2.0
      expect(s.usedAveragedSexConstant, isFalse);
    });

    test('female moderate maintain: TDEE ≈2046 → 2050; protein 96', () {
      final s = suggestGoals(
        heightCm: 165,
        ageYears: 30,
        sex: 'female',
        weightKg: 60,
        activity: ActivityLevel.moderate,
        direction: 'maintain',
      );
      expect(s, isNotNull);
      // BMR 1320.25 × 1.55 = 2046.3875 → round50 = 2050.
      expect(s!.calorieDelta, 0);
      expect(s.calories, 2050);
      expect(s.tdee, 2050);
      expect(s.proteinPerKg, 1.6);
      expect(s.protein, 96); // 60 × 1.6
    });

    test('cut applies a deficit and a higher protein g/kg', () {
      final s = suggestGoals(
        heightCm: 180,
        ageYears: 30,
        sex: 'male',
        weightKg: 80,
        activity: ActivityLevel.sedentary,
        direction: 'cut',
      );
      expect(s, isNotNull);
      // 2136 − 500 = 1636 → round50 = 1650.
      expect(s!.calorieDelta, -kCutDeficitKcal);
      expect(s.calories, 1650);
      expect(s.proteinPerKg, 2.2);
      expect(s.protein, 176); // 80 × 2.2
    });

    test('direction changes ONLY the delta + protein, not the TDEE baseline', () {
      GoalSuggestion s(String dir) => suggestGoals(
            heightCm: 180,
            ageYears: 30,
            sex: 'male',
            weightKg: 80,
            activity: ActivityLevel.sedentary,
            direction: dir,
          )!;
      expect(s('gain').tdee, s('cut').tdee);
      expect(s('gain').tdee, s('maintain').tdee);
      expect(s('gain').calories, greaterThan(s('maintain').calories));
      expect(s('cut').calories, lessThan(s('maintain').calories));
    });

    test('rounds calories to the nearest 50 (half-up parity with legacy)', () {
      // Craft a TDEE landing on a .5×50 boundary. Use active (×1.725).
      final s = suggestGoals(
        heightCm: 180,
        ageYears: 30,
        sex: 'male',
        weightKg: 80,
        activity: ActivityLevel.active,
        direction: 'maintain',
      );
      // 1780 × 1.725 = 3070.5 → /50 = 61.41 → round = 61 → 3050.
      expect(s!.calories % 50, 0);
      expect(s.calories, 3050);
    });

    test('scales protein with real bodyweight, not a fixed number', () {
      final light = suggestGoals(
        heightCm: 170,
        ageYears: 30,
        sex: 'male',
        weightKg: 60,
        activity: ActivityLevel.moderate,
        direction: 'gain',
      )!;
      final heavy = suggestGoals(
        heightCm: 170,
        ageYears: 30,
        sex: 'male',
        weightKg: 90,
        activity: ActivityLevel.moderate,
        direction: 'gain',
      )!;
      expect(heavy.protein, greaterThan(light.protein));
      expect(light.protein, 120); // 60 × 2.0
      expect(heavy.protein, 180); // 90 × 2.0
    });

    test('flags the averaged-sex-constant estimate for an "other" sex', () {
      final s = suggestGoals(
        heightCm: 180,
        ageYears: 30,
        sex: 'other',
        weightKg: 80,
        activity: ActivityLevel.sedentary,
        direction: 'maintain',
      );
      expect(s, isNotNull);
      expect(s!.usedAveragedSexConstant, isTrue);
      // BMR 1697 × 1.2 = 2036.4 → round50 = 2050.
      expect(s.calories, 2050);
    });
  });

  group('suggestGoals — honest null (never fabricate a suggestion)', () {
    GoalSuggestion? call({
      double? heightCm = 180,
      int? ageYears = 30,
      String? sex = 'male',
      double? weightKg = 80,
      String? direction = 'gain',
    }) =>
        suggestGoals(
          heightCm: heightCm,
          ageYears: ageYears,
          sex: sex,
          weightKg: weightKg,
          activity: ActivityLevel.moderate,
          direction: direction,
        );

    test('null when height missing', () => expect(call(heightCm: null), isNull));
    test('null when age missing', () => expect(call(ageYears: null), isNull));
    test('null when sex missing', () => expect(call(sex: null), isNull));
    test('null when sex empty', () => expect(call(sex: ''), isNull));
    test('null when weight missing', () => expect(call(weightKg: null), isNull));
    test('null when direction missing', () => expect(call(direction: null), isNull));
    test('null when direction unrecognised', () => expect(call(direction: 'bulk'), isNull));

    test('non-null only when EVERYTHING is present', () {
      expect(call(), isNotNull);
    });
  });
}
