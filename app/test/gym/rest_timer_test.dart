// Unit tests for restSecondsFor — the pure rest-duration function (P3-T4).
//
// Mirrors the legacy gym-decision.ts shape: base-by-equipment × effort
// modifier, rounded to the nearest 5s, floored at 20s.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/gym/exercise.dart';
import 'package:health_hub/gym/rest_timer.dart';
import 'package:health_hub/gym/workout_session.dart';

void main() {
  group('restSecondsFor', () {
    test('honest base per equipment (no effort rated)', () {
      expect(restSecondsFor(EquipmentType.freeWeight, null), 120);
      expect(restSecondsFor(EquipmentType.machine, null), 90);
      expect(restSecondsFor(EquipmentType.bodyweight, null), 60);
      expect(restSecondsFor(EquipmentType.cardio, null), 30);
    });

    test('angry (near failure) adds rest vs the base', () {
      // 120 × 1.15 = 138 → nearest 5 = 140.
      expect(restSecondsFor(EquipmentType.freeWeight, SetEffort.angry), 140);
      expect(
        restSecondsFor(EquipmentType.freeWeight, SetEffort.angry),
        greaterThan(restSecondsFor(EquipmentType.freeWeight, null)),
      );
    });

    test('easy reduces rest vs the base', () {
      // 120 × 0.85 = 102 → nearest 5 = 100.
      expect(restSecondsFor(EquipmentType.freeWeight, SetEffort.easy), 100);
      expect(
        restSecondsFor(EquipmentType.freeWeight, SetEffort.easy),
        lessThan(restSecondsFor(EquipmentType.freeWeight, null)),
      );
    });

    test('contempt (grind) is neutral — same as the base', () {
      expect(
        restSecondsFor(EquipmentType.machine, SetEffort.contempt),
        restSecondsFor(EquipmentType.machine, null),
      );
    });

    test('rounds to the nearest 5 seconds', () {
      // machine base 90 × 1.15 = 103.5 → nearest 5 = 105.
      expect(restSecondsFor(EquipmentType.machine, SetEffort.angry), 105);
      // machine 90 × 0.85 = 76.5 → nearest 5 = 75.
      expect(restSecondsFor(EquipmentType.machine, SetEffort.easy), 75);
      // Every result is a multiple of 5.
      for (final eq in EquipmentType.values) {
        for (final ef in [null, ...SetEffort.values]) {
          expect(restSecondsFor(eq, ef) % 5, 0);
        }
      }
    });

    test('floors at 20 seconds', () {
      // cardio base 30 × 0.85 = 25.5 → 25 (still ≥ 20, unchanged by the floor).
      expect(restSecondsFor(EquipmentType.cardio, SetEffort.easy), 25);
      // The floor never lets any result drop below 20.
      for (final eq in EquipmentType.values) {
        for (final ef in [null, ...SetEffort.values]) {
          expect(restSecondsFor(eq, ef), greaterThanOrEqualTo(20));
        }
      }
    });
  });
}
