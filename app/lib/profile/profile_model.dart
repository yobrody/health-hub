/// The user's profile — the layer where the app's honesty rule lives.
///
/// **Every field is nullable.** A field the user has not provided is `null`,
/// persists as `null`, and renders as `—` ([showOrDash]). There is NO
/// fabricated default anywhere: the old React app silently turned a missing
/// goal into `2200` kcal / `140` g protein, a missing weight into `80` kg, and
/// a missing goal weight into `72` kg — fake reference lines the user never
/// entered. Encoding those defaults out of existence is the entire point of
/// this class.
///
/// [fromJson]/[toJson] NEVER coalesce a missing field to a default: an absent
/// or explicit-null key produces Dart `null`, and an absent field is simply
/// omitted from the serialised map.
class Profile {
  const Profile({
    this.heightCm,
    this.ageYears,
    this.sex,
    this.weightKg,
    this.goalDirection, // 'gain' | 'cut' | 'maintain'
    this.targetWeightKg,
    this.bodyFatPercent,
    this.primaryGym,
    this.activityLevel,
  });

  /// Height in centimetres. `null` until the user provides it.
  final double? heightCm;

  /// Age in years. `null` until the user provides it.
  final int? ageYears;

  /// Biological sex, a free string ('male' / 'female' / other). `null` if unset.
  final String? sex;

  /// Current body weight in kg. `null` until the user provides it —
  /// **never** defaulted to 80.
  final double? weightKg;

  /// Goal direction: `'gain'`, `'cut'`, or `'maintain'`. `null` if unset.
  final String? goalDirection;

  /// Goal body weight in kg. `null` until the user provides it —
  /// **never** defaulted to 72.
  final double? targetWeightKg;

  /// Measured body-fat percentage (e.g. `16` for 16%). `null` until the user
  /// enters a real reading — **never** guessed. Body-fat drives the honest,
  /// weight-independent "visible abs" milestone on the Transformation page; with
  /// no reading that milestone stays honestly `needs-data` rather than
  /// fabricating a value.
  final double? bodyFatPercent;

  /// The user's primary gym (free text). `null` if unset.
  final String? primaryGym;

  /// Physical-activity level, stored as an [ActivityLevel.name] string
  /// (`sedentary`/`light`/`moderate`/`active`/`veryActive`). `null` until the
  /// user provides it — used to derive TDEE for goal suggestions. Never
  /// defaulted: a missing activity level honestly blocks a suggestion rather
  /// than fabricating a multiplier.
  final String? activityLevel;

  /// True only when every field is null (a brand-new, untouched profile).
  bool get isEmpty =>
      heightCm == null &&
      ageYears == null &&
      sex == null &&
      weightKg == null &&
      goalDirection == null &&
      targetWeightKg == null &&
      bodyFatPercent == null &&
      primaryGym == null &&
      activityLevel == null;

  /// Parse a [Profile] from stored/loaded JSON.
  ///
  /// Absent keys and explicit `null` values BOTH produce Dart `null`. Numeric
  /// values are read via `num?` (JSON has no int/double distinction and a store
  /// may round-trip `62.5` as a double) then narrowed — `?.toDouble()` /
  /// `?.toInt()` preserve `null` as `null` with no coalesce-to-a-number.
  factory Profile.fromJson(Map<String, dynamic> json) {
    return Profile(
      heightCm: (json['height_cm'] as num?)?.toDouble(),
      ageYears: (json['age_years'] as num?)?.toInt(),
      sex: json['sex'] as String?,
      weightKg: (json['weight_kg'] as num?)?.toDouble(),
      goalDirection: _readGoalDirection(json['goal_direction'] as String?),
      targetWeightKg: (json['target_weight_kg'] as num?)?.toDouble(),
      bodyFatPercent: (json['body_fat_percent'] as num?)?.toDouble(),
      primaryGym: json['primary_gym'] as String?,
      activityLevel: json['activity_level'] as String?,
    );
  }

  /// Map a goal direction FROM the backend/stored vocabulary to the model's.
  ///
  /// The model uses `gain|cut|maintain`; the backend uses `gain|lose|maintain`
  /// (see [ProfileRepo.paramsFor], which maps `cut`→`lose` on WRITE). This is
  /// the reverse map on READ, so a future `GET /tdee/profile` — or any JSON
  /// that carries the backend's `lose` — round-trips back to the model's `cut`.
  /// Locally-persisted profiles already store `cut` verbatim (`toJson` writes
  /// the model vocabulary), so this map is a harmless no-op for them.
  static String? _readGoalDirection(String? raw) {
    if (raw == 'lose') return 'cut';
    return raw;
  }

  /// Serialise to JSON, **omitting** every null field.
  ///
  /// A null field is left out entirely — it is never emitted as `0` or any
  /// stand-in number. This is what lets a round-trip preserve "not provided".
  Map<String, dynamic> toJson() => {
        if (heightCm != null) 'height_cm': heightCm,
        if (ageYears != null) 'age_years': ageYears,
        if (sex != null) 'sex': sex,
        if (weightKg != null) 'weight_kg': weightKg,
        if (goalDirection != null) 'goal_direction': goalDirection,
        if (targetWeightKg != null) 'target_weight_kg': targetWeightKg,
        if (bodyFatPercent != null) 'body_fat_percent': bodyFatPercent,
        if (primaryGym != null) 'primary_gym': primaryGym,
        if (activityLevel != null) 'activity_level': activityLevel,
      };

  /// Return a copy with the given fields overridden. Omitted args keep the
  /// existing value. (Cannot express "set back to null" — onboarding never
  /// needs that; it builds a profile up from an empty one.)
  Profile copyWith({
    double? heightCm,
    int? ageYears,
    String? sex,
    double? weightKg,
    String? goalDirection,
    double? targetWeightKg,
    double? bodyFatPercent,
    String? primaryGym,
    String? activityLevel,
  }) {
    return Profile(
      heightCm: heightCm ?? this.heightCm,
      ageYears: ageYears ?? this.ageYears,
      sex: sex ?? this.sex,
      weightKg: weightKg ?? this.weightKg,
      goalDirection: goalDirection ?? this.goalDirection,
      targetWeightKg: targetWeightKg ?? this.targetWeightKg,
      bodyFatPercent: bodyFatPercent ?? this.bodyFatPercent,
      primaryGym: primaryGym ?? this.primaryGym,
      activityLevel: activityLevel ?? this.activityLevel,
    );
  }
}

/// The single honest formatter the UI uses for any user-provided value.
///
/// Returns `'—'` (em-dash) when [v] is `null` or an empty/whitespace-only
/// string; otherwise the value's `toString()`. A genuine `0` is a REAL value
/// and renders as `'0'` — honesty cuts both ways: a zero the user entered must
/// not be hidden as "missing".
String showOrDash(Object? v) {
  if (v == null) return '—';
  if (v is String && v.trim().isEmpty) return '—';
  return v.toString();
}

/// Format a kilogram value for display, stripping a trailing `.0` so a whole
/// number reads as `60` not `60.0`. The single shared formatter used wherever a
/// weight is rendered (set rows, progression reasons, the next-weight
/// suggestion) — do not re-inline the `% 1 == 0` dance.
String formatKg(double kg) {
  // Round to 2 dp first so IEEE-754 subtraction noise (e.g. 62.3 - 61.0 =
  // 1.2999999999999972) never leaks into the UI, while genuine micro-plate
  // precision (1.25 kg) is preserved.
  final rounded = (kg * 100).round() / 100;
  return rounded == rounded.roundToDouble()
      ? rounded.round().toString()
      : rounded.toString();
}
