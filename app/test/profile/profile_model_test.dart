// Tests for the honest Profile model (Task 8).
//
// The whole point: a field the user has NOT provided is null — never a
// fabricated default. The old React app had bugs where a missing goal became
// 2200 kcal / 140 g protein, a missing weight became 80 kg, and a missing goal
// weight became 72 kg. These tests exist to make that class of bug impossible:
// absent JSON → null; null → `—`; and NO field ever silently becomes a number.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/profile/profile_model.dart';
import 'package:health_hub/profile/profile_repo.dart';

void main() {
  group('showOrDash', () {
    test('null → em-dash', () {
      expect(showOrDash(null), '—');
    });

    test('empty string → em-dash', () {
      expect(showOrDash(''), '—');
    });

    test('whitespace-only string → em-dash', () {
      expect(showOrDash('   '), '—');
    });

    test('a real number renders its string form (no rounding away)', () {
      expect(showOrDash(62.5), '62.5');
    });

    test('an int renders its string form', () {
      expect(showOrDash(29), '29');
    });

    test('zero is a REAL value, not "missing" → renders "0" not em-dash', () {
      // Honesty cuts both ways: a genuine 0 the user entered must not be hidden.
      expect(showOrDash(0), '0');
    });

    test('a non-empty string renders as-is', () {
      expect(showOrDash('PureGym'), 'PureGym');
    });
  });

  group('Profile.fromJson — absent fields stay null (NO fabricated defaults)', () {
    test('empty map → every field null', () {
      final p = Profile.fromJson(const {});
      expect(p.heightCm, isNull);
      expect(p.ageYears, isNull);
      expect(p.sex, isNull);
      expect(p.weightKg, isNull);
      expect(p.goalDirection, isNull);
      expect(p.targetWeightKg, isNull);
      expect(p.primaryGym, isNull);
    });

    test('explicit-null JSON values → null (not coerced)', () {
      final p = Profile.fromJson(const {
        'height_cm': null,
        'age_years': null,
        'sex': null,
        'weight_kg': null,
        'goal_direction': null,
        'target_weight_kg': null,
        'primary_gym': null,
      });
      expect(p.heightCm, isNull);
      expect(p.ageYears, isNull);
      expect(p.sex, isNull);
      expect(p.weightKg, isNull);
      expect(p.goalDirection, isNull);
      expect(p.targetWeightKg, isNull);
      expect(p.primaryGym, isNull);
    });

    test('a partial map leaves the unspecified fields null', () {
      final p = Profile.fromJson(const {'height_cm': 180.0, 'sex': 'male'});
      expect(p.heightCm, 180.0);
      expect(p.sex, 'male');
      // Everything else must remain null — never invented.
      expect(p.ageYears, isNull);
      expect(p.weightKg, isNull);
      expect(p.goalDirection, isNull);
      expect(p.targetWeightKg, isNull);
      expect(p.primaryGym, isNull);
    });

    // The regression guard the whole task exists for: the old app's fake
    // reference values must NEVER appear when the field is absent.
    test('NO field ever becomes 2200/140/72/80 (or any number) when absent', () {
      final p = Profile.fromJson(const {});
      final numericValues = <num?>[
        p.heightCm,
        p.ageYears?.toDouble(),
        p.weightKg,
        p.targetWeightKg,
      ];
      for (final v in numericValues) {
        expect(v, isNull);
      }
      // Explicitly assert none of the historical fabricated defaults leaked in.
      expect(p.weightKg, isNot(80));
      expect(p.targetWeightKg, isNot(72));
      expect(p.heightCm, isNot(2200));
      expect(p.ageYears, isNot(140));
    });
  });

  group('Profile.toJson — never emits a fabricated default', () {
    test('an all-null profile serialises with no fabricated numbers', () {
      final json = const Profile().toJson();
      // Absent fields are omitted (or null) — never a stand-in number.
      expect(json['height_cm'], isNull);
      expect(json['age_years'], isNull);
      expect(json['weight_kg'], isNull);
      expect(json['target_weight_kg'], isNull);
      expect(json.values, isNot(contains(2200)));
      expect(json.values, isNot(contains(140)));
      expect(json.values, isNot(contains(72)));
      expect(json.values, isNot(contains(80)));
    });

    test('only-non-null fields appear in toJson', () {
      final json = const Profile(weightKg: 62.5, sex: 'male').toJson();
      expect(json['weight_kg'], 62.5);
      expect(json['sex'], 'male');
      expect(json.containsKey('height_cm'), isFalse);
      expect(json.containsKey('target_weight_kg'), isFalse);
    });
  });

  group('round-trip preserves nulls', () {
    test('empty profile round-trips to empty profile', () {
      final p = const Profile();
      final p2 = Profile.fromJson(p.toJson());
      expect(p2.heightCm, isNull);
      expect(p2.ageYears, isNull);
      expect(p2.sex, isNull);
      expect(p2.weightKg, isNull);
      expect(p2.goalDirection, isNull);
      expect(p2.targetWeightKg, isNull);
      expect(p2.primaryGym, isNull);
    });

    test('a fully-populated profile round-trips exactly', () {
      const p = Profile(
        heightCm: 178.0,
        ageYears: 29,
        sex: 'male',
        weightKg: 62.5,
        goalDirection: 'gain',
        targetWeightKg: 72.0,
        primaryGym: 'PureGym',
        activityLevel: 'moderate',
      );
      final p2 = Profile.fromJson(p.toJson());
      expect(p2.heightCm, 178.0);
      expect(p2.ageYears, 29);
      expect(p2.sex, 'male');
      expect(p2.weightKg, 62.5);
      expect(p2.goalDirection, 'gain');
      expect(p2.targetWeightKg, 72.0);
      expect(p2.primaryGym, 'PureGym');
      expect(p2.activityLevel, 'moderate');
    });

    test('activityLevel round-trips via toJson→fromJson (the sync data path)', () {
      // The activity level persists through the profile JSON blob (SharedPrefs
      // locally, the `data` jsonb / `activity_level` column in Supabase), so a
      // save→load cycle preserves it. Absent → stays null, never fabricated.
      final withLevel = Profile.fromJson(
        const Profile(activityLevel: 'veryActive').toJson(),
      );
      expect(withLevel.activityLevel, 'veryActive');
      expect(const Profile().toJson().containsKey('activity_level'), isFalse);
      expect(Profile.fromJson(const {}).activityLevel, isNull);
    });

    test('a partial profile round-trips, keeping the omitted fields null', () {
      const p = Profile(weightKg: 62.5, goalDirection: 'gain');
      final p2 = Profile.fromJson(p.toJson());
      expect(p2.weightKg, 62.5);
      expect(p2.goalDirection, 'gain');
      expect(p2.heightCm, isNull);
      expect(p2.targetWeightKg, isNull);
      expect(p2.primaryGym, isNull);
    });
  });

  group('goal-direction mapping is round-trippable across the backend contract', () {
    // The model vocabulary is gain|cut|maintain. The backend vocabulary is
    // gain|lose|maintain. paramsFor maps cut→lose on WRITE; fromJson must map
    // the reverse (lose→cut) on READ so a future GET /tdee/profile is consistent.
    test("backend 'lose' reads back as model 'cut'", () {
      final p = Profile.fromJson(const {'goal_direction': 'lose'});
      expect(p.goalDirection, 'cut');
    });

    test("'gain' and 'maintain' are unchanged on read", () {
      expect(Profile.fromJson(const {'goal_direction': 'gain'}).goalDirection,
          'gain');
      expect(
          Profile.fromJson(const {'goal_direction': 'maintain'}).goalDirection,
          'maintain');
    });

    test("'cut' from local storage stays 'cut' (idempotent read)", () {
      // toJson writes the model vocabulary verbatim, so a locally-persisted
      // profile round-trips without corruption.
      expect(Profile.fromJson(const {'goal_direction': 'cut'}).goalDirection,
          'cut');
    });

    test('cut write→read round-trip: cut →(paramsFor) lose →(fromJson) cut', () {
      const p = Profile(goalDirection: 'cut');
      final params = ProfileRepo.paramsFor(p);
      expect(params['goal_direction'], 'lose'); // write mapping
      final back = Profile.fromJson({'goal_direction': params['goal_direction']});
      expect(back.goalDirection, 'cut'); // read mapping restores it
    });
  });

  group('Profile.copyWith', () {
    test('overrides only the given field, keeping others', () {
      const p = Profile(weightKg: 62.5);
      final p2 = p.copyWith(goalDirection: 'gain');
      expect(p2.weightKg, 62.5);
      expect(p2.goalDirection, 'gain');
    });

    test('isEmpty is true only when every field is null', () {
      expect(const Profile().isEmpty, isTrue);
      expect(const Profile(weightKg: 62.5).isEmpty, isFalse);
    });
  });
}
