// Exercise catalog — the seed list of known movements.
//
// A small, stable set of exercises spanning all equipment types. Each has a
// stable [Exercise.id] referenced by [ExerciseLog.exerciseId] stored in the
// repo — do NOT change existing ids once committed (they are in persisted data).
//
// Honesty rule: [primaryMuscle] is omitted when genuinely unknown (no guesses).

import 'exercise.dart';

// ── Seed catalog ──────────────────────────────────────────────────────────────

/// The built-in exercise list shown in the "add exercise" picker.
/// Covers all four [EquipmentType]s so the snapping logic is exercised for
/// every category.
const List<Exercise> kExerciseCatalog = [
  // ── Free-weight compounds ──────────────────────────────────────────────────
  Exercise(
    id: 'bench-press',
    name: 'Bench Press',
    primaryMuscle: 'chest',
    equipment: EquipmentType.freeWeight,
  ),
  Exercise(
    id: 'squat',
    name: 'Squat',
    primaryMuscle: 'quads',
    equipment: EquipmentType.freeWeight,
  ),
  Exercise(
    id: 'deadlift',
    name: 'Deadlift',
    primaryMuscle: 'hamstrings',
    equipment: EquipmentType.freeWeight,
  ),
  Exercise(
    id: 'overhead-press',
    name: 'Overhead Press',
    primaryMuscle: 'shoulders',
    equipment: EquipmentType.freeWeight,
  ),

  // ── Machine ────────────────────────────────────────────────────────────────
  Exercise(
    id: 'leg-press',
    name: 'Leg Press',
    primaryMuscle: 'quads',
    equipment: EquipmentType.machine,
  ),
  Exercise(
    id: 'cable-row',
    name: 'Cable Row',
    primaryMuscle: 'back',
    equipment: EquipmentType.machine,
  ),

  // ── Bodyweight ────────────────────────────────────────────────────────────
  Exercise(
    id: 'pull-up',
    name: 'Pull-up',
    primaryMuscle: 'back',
    equipment: EquipmentType.bodyweight,
  ),

  // ── Cardio ────────────────────────────────────────────────────────────────
  Exercise(
    id: 'treadmill',
    name: 'Treadmill',
    equipment: EquipmentType.cardio,
  ),
];
