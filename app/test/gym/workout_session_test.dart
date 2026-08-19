import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/gym/exercise.dart';
import 'package:health_hub/gym/workout_session.dart';

void main() {
  group('Exercise', () {
    test('json round-trip (with primaryMuscle)', () {
      const e = Exercise(
        id: 'ex1',
        name: 'Bench Press',
        primaryMuscle: 'chest',
        equipment: EquipmentType.freeWeight,
      );
      final back = Exercise.fromJson(e.toJson());
      expect(back.id, 'ex1');
      expect(back.name, 'Bench Press');
      expect(back.primaryMuscle, 'chest');
      expect(back.equipment, EquipmentType.freeWeight);
    });

    test('null primaryMuscle stays null and is omitted from json', () {
      const e = Exercise(
        id: 'ex2',
        name: 'Treadmill',
        equipment: EquipmentType.cardio,
      );
      final json = e.toJson();
      expect(json.containsKey('primaryMuscle'), isFalse);
      final back = Exercise.fromJson(json);
      expect(back.primaryMuscle, isNull);
      expect(back.equipment, EquipmentType.cardio);
    });

    test('unknown equipment string falls back to bodyweight (honest worst case)',
        () {
      final back = Exercise.fromJson({
        'id': 'ex3',
        'name': 'Mystery',
        'equipment': 'not-a-real-type',
      });
      // Should not throw. The fallback must be bodyweight — the honest worst
      // case (no external load, weight stored null) rather than 'machine',
      // which would fabricate a weight field + snap a phantom weight onto what
      // may be a bodyweight movement.
      expect(back.equipment, EquipmentType.bodyweight);
    });

    test('absent equipment key also falls back to bodyweight', () {
      final back = Exercise.fromJson({'id': 'ex4', 'name': 'NoEquip'});
      expect(back.equipment, EquipmentType.bodyweight);
    });
  });

  group('SetEntry', () {
    test('json round-trip with all fields (effort as string)', () {
      const s = SetEntry(
        weightKg: 60.0,
        reps: 8,
        effort: SetEffort.contempt,
        done: true,
      );
      final json = s.toJson();
      expect(json['effort'], 'contempt');
      final back = SetEntry.fromJson(json);
      expect(back.weightKg, 60.0);
      expect(back.reps, 8);
      expect(back.effort, SetEffort.contempt);
      expect(back.done, isTrue);
    });

    test('null weight/reps/effort stay null — no 0-fill — and are omitted', () {
      const s = SetEntry();
      final json = s.toJson();
      expect(json.containsKey('weightKg'), isFalse);
      expect(json.containsKey('reps'), isFalse);
      expect(json.containsKey('effort'), isFalse);
      // done defaults false and is always emitted (a real bool state).
      expect(json['done'], isFalse);

      final back = SetEntry.fromJson(json);
      expect(back.weightKg, isNull);
      expect(back.reps, isNull);
      expect(back.effort, isNull);
      expect(back.done, isFalse);
    });

    test('all three effort values round-trip', () {
      for (final effort in SetEffort.values) {
        final back = SetEntry.fromJson(SetEntry(effort: effort).toJson());
        expect(back.effort, effort);
      }
    });

    test('copyWith overrides fields', () {
      const s = SetEntry(weightKg: 40, reps: 10);
      final u = s.copyWith(done: true, reps: 12);
      expect(u.weightKg, 40);
      expect(u.reps, 12);
      expect(u.done, isTrue);
    });
  });

  group('ExerciseLog', () {
    test('json round-trip with sets', () {
      const log = ExerciseLog(
        exerciseId: 'ex1',
        sets: [
          SetEntry(weightKg: 60, reps: 8, done: true),
          SetEntry(weightKg: 60, reps: 6),
        ],
      );
      final back = ExerciseLog.fromJson(log.toJson());
      expect(back.exerciseId, 'ex1');
      expect(back.sets.length, 2);
      expect(back.sets[0].reps, 8);
      expect(back.sets[1].done, isFalse);
    });
  });

  group('WorkoutSession', () {
    test('json round-trip; at is ISO-8601 local; social seam defaults', () {
      final at = DateTime(2026, 8, 19, 18, 30);
      final session = WorkoutSession(
        id: 'w1',
        at: at,
        exercises: const [
          ExerciseLog(
            exerciseId: 'ex1',
            sets: [SetEntry(weightKg: 60, reps: 8, done: true)],
          ),
        ],
      );
      // Defaults for the social seam.
      expect(session.ownerId, isNull);
      expect(session.shared, isFalse);
      expect(session.finished, isFalse);

      final json = session.toJson();
      expect(json.containsKey('ownerId'), isFalse);
      expect(json['shared'], isFalse);
      expect(json['at'], at.toIso8601String());

      final back = WorkoutSession.fromJson(json);
      expect(back.id, 'w1');
      expect(back.at, at);
      expect(back.exercises.length, 1);
      expect(back.exercises.first.sets.first.reps, 8);
      expect(back.finished, isFalse);
    });

    test('ownerId + shared persist when set', () {
      final session = WorkoutSession(
        id: 'w2',
        at: DateTime(2026, 8, 19),
        exercises: const [],
        ownerId: 'user-42',
        shared: true,
        finished: true,
      );
      final back = WorkoutSession.fromJson(session.toJson());
      expect(back.ownerId, 'user-42');
      expect(back.shared, isTrue);
      expect(back.finished, isTrue);
    });

    test('copyWith flips finished without touching other fields', () {
      final session = WorkoutSession(
        id: 'w3',
        at: DateTime(2026, 8, 19),
        exercises: const [ExerciseLog(exerciseId: 'ex1', sets: [])],
      );
      final done = session.copyWith(finished: true);
      expect(done.finished, isTrue);
      expect(done.id, 'w3');
      expect(done.exercises.length, 1);
    });
  });
}
