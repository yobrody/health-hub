/// The live workout-tracking model: a [WorkoutSession] holds per-exercise
/// [ExerciseLog]s, each a list of [SetEntry]s.
///
/// Honesty rules (mirror [PantryItem]/[FoodLogEntry]):
///  • A set the user hasn't filled in has `null` weight/reps/effort — NEVER a
///    fabricated `0`. `null` persists as absent from the JSON map.
///  • A genuine value (even a real `0` rep count, if ever recorded) is preserved.
///  • The social seam ([WorkoutSession.ownerId]/[shared]) defaults to
///    personal/unshared, so P3 stays local while a later phase can share.
library;

// ── SetEffort ────────────────────────────────────────────────────────────────

/// How a set felt — the effort-emoji scale used by the live UI (T4). Ordered
/// easy → hard. `null` means "not yet rated", never a fabricated middle value.
enum SetEffort { easy, contempt, angry }

/// Parse a stored effort string back to the enum. Unknown/absent → `null`
/// (an unrated set stays honestly unrated).
SetEffort? _effortFromString(String? raw) {
  if (raw == null) return null;
  for (final e in SetEffort.values) {
    if (e.name == raw) return e;
  }
  return null;
}

// ── SetEntry ─────────────────────────────────────────────────────────────────

/// A single set within an [ExerciseLog]. Weight/reps/effort are all nullable —
/// an empty (planned-but-unlogged) set carries `null`s, not zeros.
class SetEntry {
  const SetEntry({
    this.weightKg,
    this.reps,
    this.effort,
    this.done = false,
  });

  /// Weight lifted in kg. `null` when unentered — never a fabricated `0`.
  final double? weightKg;

  /// Reps performed. `null` when unentered — never a fabricated `0`.
  final int? reps;

  /// How the set felt. `null` until the user rates it.
  final SetEffort? effort;

  /// Whether the set is marked complete. A real boolean state, defaults `false`,
  /// always emitted.
  final bool done;

  Map<String, dynamic> toJson() => {
        if (weightKg != null) 'weightKg': weightKg,
        if (reps != null) 'reps': reps,
        if (effort != null) 'effort': effort!.name,
        'done': done,
      };

  factory SetEntry.fromJson(Map<String, dynamic> json) => SetEntry(
        weightKg: (json['weightKg'] as num?)?.toDouble(),
        reps: (json['reps'] as num?)?.toInt(),
        effort: _effortFromString(json['effort'] as String?),
        done: json['done'] as bool? ?? false,
      );

  /// Return a copy with the given fields overridden. Like the other models'
  /// copyWith, omitted args keep the existing value — it cannot set a field
  /// back to null.
  SetEntry copyWith({
    double? weightKg,
    int? reps,
    SetEffort? effort,
    bool? done,
  }) =>
      SetEntry(
        weightKg: weightKg ?? this.weightKg,
        reps: reps ?? this.reps,
        effort: effort ?? this.effort,
        done: done ?? this.done,
      );
}

// ── ExerciseLog ──────────────────────────────────────────────────────────────

/// All sets logged for one exercise within a session.
class ExerciseLog {
  const ExerciseLog({
    required this.exerciseId,
    required this.sets,
  });

  /// References [Exercise.id].
  final String exerciseId;

  /// Sets in order performed.
  final List<SetEntry> sets;

  Map<String, dynamic> toJson() => {
        'exerciseId': exerciseId,
        'sets': sets.map((s) => s.toJson()).toList(),
      };

  factory ExerciseLog.fromJson(Map<String, dynamic> json) => ExerciseLog(
        exerciseId: json['exerciseId'] as String,
        sets: ((json['sets'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(SetEntry.fromJson)
            .toList(),
      );

  ExerciseLog copyWith({
    String? exerciseId,
    List<SetEntry>? sets,
  }) =>
      ExerciseLog(
        exerciseId: exerciseId ?? this.exerciseId,
        sets: sets ?? this.sets,
      );
}

// ── WorkoutSession ───────────────────────────────────────────────────────────

/// A single workout — the unit that must survive an app restart (an interrupted
/// session is never lost; see [WorkoutRepo]).
class WorkoutSession {
  const WorkoutSession({
    required this.id,
    required this.at,
    required this.exercises,
    this.finished = false,
    this.ownerId,
    this.shared = false,
  });

  /// Stable identifier (used in the API path + Outbox dedupe key).
  final String id;

  /// When the session started (persisted ISO-8601, local).
  final DateTime at;

  /// Per-exercise logs.
  final List<ExerciseLog> exercises;

  /// Whether the session has been finished. A real boolean state, defaults
  /// `false`, always emitted.
  final bool finished;

  /// The social seam — owner of this session. `null` = personal/unscoped.
  final String? ownerId;

  /// The social seam — whether this session is shared. Defaults `false`.
  final bool shared;

  Map<String, dynamic> toJson() => {
        'id': id,
        'at': at.toIso8601String(),
        'exercises': exercises.map((e) => e.toJson()).toList(),
        'finished': finished,
        if (ownerId != null) 'ownerId': ownerId,
        'shared': shared,
      };

  factory WorkoutSession.fromJson(Map<String, dynamic> json) => WorkoutSession(
        id: json['id'] as String,
        at: DateTime.parse(json['at'] as String),
        exercises: ((json['exercises'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ExerciseLog.fromJson)
            .toList(),
        finished: json['finished'] as bool? ?? false,
        ownerId: json['ownerId'] as String?,
        shared: json['shared'] as bool? ?? false,
      );

  WorkoutSession copyWith({
    String? id,
    DateTime? at,
    List<ExerciseLog>? exercises,
    bool? finished,
    String? ownerId,
    bool? shared,
  }) =>
      WorkoutSession(
        id: id ?? this.id,
        at: at ?? this.at,
        exercises: exercises ?? this.exercises,
        finished: finished ?? this.finished,
        ownerId: ownerId ?? this.ownerId,
        shared: shared ?? this.shared,
      );
}
