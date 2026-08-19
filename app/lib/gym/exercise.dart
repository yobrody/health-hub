/// The Exercise catalogue model — the identity of a movement (bench press,
/// treadmill…) that a [WorkoutSession] logs sets against.
///
/// Honesty rule (mirrors [PantryItem]/[FoodLogEntry]): every non-identity,
/// non-required field is nullable, persists as `null`, and is OMITTED from the
/// serialised map — never fabricated. Here that field is [primaryMuscle]: an
/// exercise whose target muscle we don't know serialises without it, not as
/// `""` or a guessed group.
library;

/// How an exercise is loaded — drives the (later) weight-entry UI and
/// progression logic (a bodyweight/cardio movement has no external stack).
enum EquipmentType { machine, freeWeight, bodyweight, cardio }

/// Parse a stored equipment string back to the enum. Unknown/absent →
/// [EquipmentType.bodyweight] (the honest worst case rather than a crash — the
/// equipment is always required on write, so this only guards corrupted/foreign
/// JSON). Bodyweight is chosen over machine because it stores no external load:
/// the UI hides the weight field and no phantom weight is snapped onto what may
/// genuinely be a bodyweight movement — a missing hint, never a fabricated
/// weight. Mirrors [_zoneFromString] in [PantryItem].
EquipmentType _equipmentFromString(String? raw) {
  for (final e in EquipmentType.values) {
    if (e.name == raw) return e;
  }
  return EquipmentType.bodyweight;
}

class Exercise {
  const Exercise({
    required this.id,
    required this.name,
    this.primaryMuscle,
    required this.equipment,
  });

  /// Stable identifier (referenced by [ExerciseLog.exerciseId]).
  final String id;

  /// Human-readable name, e.g. "Bench Press".
  final String name;

  /// Primary muscle worked, e.g. "chest". `null` when unknown — never a
  /// fabricated stand-in.
  final String? primaryMuscle;

  /// How the exercise is loaded (machine/free-weight/bodyweight/cardio).
  final EquipmentType equipment;

  // ── Serialisation (omits null fields) ──────────────────────────────────────

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (primaryMuscle != null) 'primaryMuscle': primaryMuscle,
        'equipment': equipment.name,
      };

  factory Exercise.fromJson(Map<String, dynamic> json) => Exercise(
        id: json['id'] as String,
        name: json['name'] as String,
        primaryMuscle: json['primaryMuscle'] as String?,
        equipment: _equipmentFromString(json['equipment'] as String?),
      );

  Exercise copyWith({
    String? id,
    String? name,
    String? primaryMuscle,
    EquipmentType? equipment,
  }) =>
      Exercise(
        id: id ?? this.id,
        name: name ?? this.name,
        primaryMuscle: primaryMuscle ?? this.primaryMuscle,
        equipment: equipment ?? this.equipment,
      );
}
