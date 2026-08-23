// Unit tests for NutritionEstimate (AI nutrition estimate model).
//
// Honesty invariants under test:
//  • Null macros round-trip as null and are OMITTED from toJson (never 0).
//  • A real 0 is preserved (a measured/estimated zero is legitimate).
//  • confidence is clamped into [0, 1]; NaN → 0.
//  • Negative / non-finite macros parse to null (never a fabricated number).
//  • A blank name / note becomes null.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/estimate/nutrition_estimate.dart';

void main() {
  group('NutritionEstimate.fromJson', () {
    test('parses a full estimate', () {
      final e = NutritionEstimate.fromJson({
        'name': 'Chicken salad',
        'kcal': 420,
        'protein_g': 38,
        'carbs_g': 12,
        'fat_g': 24,
        'confidence': 0.6,
        'note': 'Assumed a standard bowl.',
      });
      expect(e.name, 'Chicken salad');
      expect(e.kcal, 420);
      expect(e.proteinG, 38);
      expect(e.carbsG, 12);
      expect(e.fatG, 24);
      expect(e.confidence, 0.6);
      expect(e.note, 'Assumed a standard bowl.');
      expect(e.hasAnyMacro, isTrue);
    });

    test('absent macros stay null, never fabricated 0', () {
      final e = NutritionEstimate.fromJson({
        'name': 'Mystery dish',
        'confidence': 0.3,
      });
      expect(e.kcal, isNull);
      expect(e.proteinG, isNull);
      expect(e.carbsG, isNull);
      expect(e.fatG, isNull);
      expect(e.hasAnyMacro, isFalse);
    });

    test('a real 0 is preserved (not treated as unknown)', () {
      final e = NutritionEstimate.fromJson({'kcal': 0, 'confidence': 0.5});
      expect(e.kcal, 0);
      expect(e.hasAnyMacro, isTrue);
    });

    test('negative / non-finite macros parse to null', () {
      final e = NutritionEstimate.fromJson({
        'kcal': -5,
        'protein_g': double.nan,
        'carbs_g': double.infinity,
        'confidence': 0.5,
      });
      expect(e.kcal, isNull);
      expect(e.proteinG, isNull);
      expect(e.carbsG, isNull);
    });

    test('confidence clamped into [0,1]; NaN → 0', () {
      expect(
        NutritionEstimate.fromJson({'confidence': 1.7, 'kcal': 1}).confidence,
        1.0,
      );
      expect(
        NutritionEstimate.fromJson({'confidence': -0.4, 'kcal': 1}).confidence,
        0.0,
      );
      expect(
        NutritionEstimate.fromJson({'confidence': double.nan, 'kcal': 1})
            .confidence,
        0.0,
      );
      expect(NutritionEstimate.fromJson({'kcal': 1}).confidence, 0.0);
    });

    test('blank name / note become null', () {
      final e = NutritionEstimate.fromJson({
        'name': '   ',
        'note': '',
        'kcal': 100,
        'confidence': 0.4,
      });
      expect(e.name, isNull);
      expect(e.note, isNull);
    });
  });

  group('NutritionEstimate.toJson', () {
    test('omits null macros; keeps confidence', () {
      const e = NutritionEstimate(
        name: 'Toast',
        kcal: 120,
        proteinG: null,
        carbsG: 20,
        fatG: null,
        confidence: 0.55,
      );
      final json = e.toJson();
      expect(json.containsKey('protein_g'), isFalse);
      expect(json.containsKey('fat_g'), isFalse);
      expect(json['kcal'], 120);
      expect(json['carbs_g'], 20);
      expect(json['confidence'], 0.55);
      expect(json.containsKey('note'), isFalse);
    });

    test('round-trips through JSON preserving nulls-as-absent', () {
      const original = NutritionEstimate(
        name: 'Curry',
        kcal: 600,
        proteinG: 25,
        carbsG: null,
        fatG: 30,
        confidence: 0.7,
        note: 'Estimated a medium portion.',
      );
      final restored = NutritionEstimate.fromJson(original.toJson());
      expect(restored.name, original.name);
      expect(restored.kcal, original.kcal);
      expect(restored.proteinG, original.proteinG);
      expect(restored.carbsG, isNull);
      expect(restored.fatG, original.fatG);
      expect(restored.confidence, original.confidence);
      expect(restored.note, original.note);
    });
  });
}
