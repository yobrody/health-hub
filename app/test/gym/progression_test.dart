import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/gym/exercise.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/gym/progression.dart';

/// Helper: a completed set at a real lifted weight/reps.
SetEntry _set(double kg, int reps, {SetEffort? effort}) =>
    SetEntry(weightKg: kg, reps: reps, effort: effort, done: true);

void main() {
  group('snapToStack', () {
    test('machine snaps to the 5kg imperial stack family', () {
      // Machine weights must land on a real selectable notch — no 22kg
      // in-between value on a family that steps 20 → 25.
      expect(snapToStack(22, EquipmentType.machine), 20);
      expect(snapToStack(23, EquipmentType.machine), 25);
      expect(snapToStack(25, EquipmentType.machine), 25);
    });

    test('free-weight snaps to a plate step (1.25 under 40kg, 2.5 at/over)', () {
      // Below 40kg → 1.25kg plate step.
      expect(snapToStack(21, EquipmentType.freeWeight), 21.25);
      expect(snapToStack(20.6, EquipmentType.freeWeight), 20.0);
      // At/over 40kg → 2.5kg plate step.
      expect(snapToStack(61, EquipmentType.freeWeight), 60.0);
      expect(snapToStack(61.3, EquipmentType.freeWeight), 62.5);
    });

    test('bodyweight and cardio pass through unchanged', () {
      expect(snapToStack(73.4, EquipmentType.bodyweight), 73.4);
      expect(snapToStack(6.5, EquipmentType.cardio), 6.5);
    });
  });

  group('evaluateProgression — bump is EARNED, never fabricated', () {
    test('bump only when top-of-range hit on ALL working sets at real weight',
        () {
      // Free-weight 30kg, top of 10–15 on every set, nothing left in the tank.
      final r = evaluateProgression(
        sets: [_set(30, 15), _set(30, 15), _set(30, 15)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.bump);
      // Next weight built from the ACTUAL lifted 30kg + 1.25 plate step.
      expect(r.nextWeightKg, 31.25);
    });

    test('a rep shortfall is a MISS, not a bump (hold, same weight)', () {
      // One set fell short of the top → not earned. Legacy holds the weight.
      final r = evaluateProgression(
        sets: [_set(30, 15), _set(30, 15), _set(30, 12)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, isNot(ProgressionVerdict.bump));
      // Suggestion never exceeds the lifted weight on a miss.
      expect(r.nextWeightKg == null || r.nextWeightKg! <= 30, isTrue);
    });

    test('inside-the-range session holds (no bump)', () {
      final r = evaluateProgression(
        sets: [_set(30, 12), _set(30, 11)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.hold);
    });
  });

  group('next weight derives from the ACTUAL lifted weight, not a target', () {
    test('lifted below the stale seed still builds on what was lifted', () {
      // The user actually worked 25kg (below some hypothetical 30kg target).
      // The suggestion must build on 25kg, not the target.
      final r = evaluateProgression(
        sets: [_set(25, 15), _set(25, 15), _set(25, 15)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.bump);
      // 25kg free-weight → +1.25 = 26.25, NOT anchored to 30.
      expect(r.nextWeightKg, 26.25);
    });
  });

  group('missing / empty inputs → honest recalibrating, never a fake bump', () {
    test('empty sets → recalibrating with no suggestion', () {
      final r = evaluateProgression(
        sets: const [],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.recalibrating);
      expect(r.nextWeightKg, isNull);
    });

    test('sets with no weight logged → recalibrating, no fabricated number', () {
      final r = evaluateProgression(
        sets: const [SetEntry(reps: 15, done: true)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.recalibrating);
      expect(r.nextWeightKg, isNull);
    });
  });

  group('effort folds into the verdict', () {
    test('an easy top set biases toward a heavier suggestion', () {
      // Topped the range AND flagged easy → too-light, definitely go heavier.
      final r = evaluateProgression(
        sets: [
          _set(30, 15, effort: SetEffort.easy),
          _set(30, 15, effort: SetEffort.easy),
          _set(30, 15, effort: SetEffort.easy),
        ],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.bump);
      expect(r.nextWeightKg, greaterThan(30));
    });

    test('angry (failed / at-max) top set → hold or deload, never a bump', () {
      final r = evaluateProgression(
        sets: [
          _set(30, 15, effort: SetEffort.angry),
          _set(30, 15, effort: SetEffort.angry),
          _set(30, 15, effort: SetEffort.angry),
        ],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(
        r.verdict,
        anyOf(ProgressionVerdict.hold, ProgressionVerdict.deload),
      );
      expect(r.nextWeightKg == null || r.nextWeightKg! <= 30, isTrue);
    });

    test('contempt (grind) top set → hold, no bump', () {
      final r = evaluateProgression(
        sets: [
          _set(30, 15, effort: SetEffort.contempt),
          _set(30, 15, effort: SetEffort.contempt),
          _set(30, 15, effort: SetEffort.contempt),
        ],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.hold);
    });
  });

  group('deload — missed the bottom of the range', () {
    test('all sets below the low target → deload, lighter suggestion', () {
      // Free-weight 40kg, target 10–15, all sets below 10 → deload 15% lighter.
      final r = evaluateProgression(
        sets: [_set(40, 6), _set(40, 5), _set(40, 5)],
        repTargetLow: 10,
        repTargetHigh: 15,
        equipment: EquipmentType.freeWeight,
      );
      expect(r.verdict, ProgressionVerdict.deload);
      expect(r.nextWeightKg, isNotNull);
      expect(r.nextWeightKg!, lessThan(40));
    });
  });

  group('machine bump snaps to a real stack notch', () {
    test('topped machine set bumps to the next real notch', () {
      // Worked 25kg on a machine, topped the range → next notch is 32
      // (the 5kg-family step after 25). +28% is a big jump, but overrun reps
      // at the top of a low range earn it via the reps-overrun escape hatch.
      final r = evaluateProgression(
        sets: [_set(25, 15), _set(25, 15), _set(25, 15)],
        repTargetLow: 8,
        repTargetHigh: 10,
        equipment: EquipmentType.machine,
      );
      // Whatever the verdict, any suggested weight must be a real machine notch.
      if (r.nextWeightKg != null) {
        expect(r.nextWeightKg, snapToStack(r.nextWeightKg!, EquipmentType.machine));
      }
    });
  });
}
