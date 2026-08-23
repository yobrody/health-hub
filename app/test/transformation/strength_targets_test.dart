// Pure-logic tests for goal-aware strength targets — parity with the legacy
// `src/lib/strength-targets.test.ts`.
//
// Honesty invariants under test:
//  • Compounds get a bodyweight-ratio benchmark scaled to the GOAL weight.
//  • Isolations scale from the user's OWN best, and ONLY when both a real
//    current weight and a real current best exist — else null (never a guess).
//  • Words shared with a compound ("Leg Extension", "Overhead ... Extension",
//    "Calf Press on Leg Press") do NOT misclassify an isolation.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/transformation/strength_targets.dart';

void main() {
  group('strengthTargetFor', () {
    test('gives a bodyweight-ratio target for a compound, scaled to the GOAL',
        () {
      // Lat pulldown ratio 0.85 → at a 72kg goal, target 72*0.85=61.2 → 61.0.
      final t = strengthTargetFor('Lat Pulldown', 72);
      expect(t, isNotNull);
      expect(t!.basis, TargetBasis.bwRatio);
      expect(t.targetKg, 61);
      expect(t.ratio, MovementRatios.pulldown);
    });

    test('snaps the target to a clean 0.5kg increment', () {
      final t = strengthTargetFor('Leg Press', 71);
      expect(t, isNotNull);
      expect(t!.targetKg * 2, (t.targetKg * 2).roundToDouble());
    });

    test('reports progress toward the target when a current best is known', () {
      final t = strengthTargetFor('Lat Pulldown', 72, currentBestKg: 38);
      expect(t!.progressPct,
          closeTo(38 / (72 * MovementRatios.pulldown), 0.01));
    });

    test('clamps progress at 1 when already past the target', () {
      final t = strengthTargetFor('Seated Shoulder Press (machine)', 72,
          currentBestKg: 999);
      expect(t!.progressPct, 1);
    });

    test('scales an isolation target by bodyweight from the current best', () {
      // Cable Curl has no external standard → keep pace with bodyweight: at
      // 62kg lifting 15kg, the 72kg target is 15 * 72/62 ≈ 17.4kg.
      final t = strengthTargetFor('Cable Curl', 72,
          currentWeightKg: 62, currentBestKg: 15);
      expect(t, isNotNull);
      expect(t!.basis, TargetBasis.personalScale);
      expect(t.targetKg, closeTo(15 * (72 / 62), 0.5));
    });

    test('returns null for an isolation with no history to scale from', () {
      expect(strengthTargetFor('Cable Curl', 72), isNull);
      // No current weight → still null.
      expect(strengthTargetFor('Cable Curl', 72, currentBestKg: 15), isNull);
    });

    test('does not misclassify isolations that share words with compounds', () {
      final ext = strengthTargetFor('Overhead Cable Triceps Extension', 72,
          currentWeightKg: 62, currentBestKg: 3.4);
      expect(ext!.basis, TargetBasis.personalScale);

      final legExt = strengthTargetFor('Leg Extension', 72,
          currentWeightKg: 62, currentBestKg: 52);
      expect(legExt!.basis, TargetBasis.personalScale);

      final calf = strengthTargetFor('Calf Press on Leg Press', 72,
          currentWeightKg: 62, currentBestKg: 66);
      expect(calf!.basis, TargetBasis.personalScale);
    });
  });
}
