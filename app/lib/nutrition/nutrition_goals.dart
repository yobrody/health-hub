/// The user's daily nutrition targets — a singleton (one per user).
///
/// **Every target is nullable.** A target the user has not set is `null`,
/// persists as `null`, and is OMITTED from the serialised map — never a
/// fabricated `2200` kcal / `140` g protein (the old React app's fake reference
/// lines). An unset target must leave its dashboard ring in the honest empty
/// state (a bare track, no denominator), so `null` is load-bearing here.
///
/// A genuine `0` (e.g. an explicit 0 g fat target) is a REAL value and is
/// preserved. Mirrors [Profile]/[FoodLogEntry]'s honesty rule.
///
/// The `toJson` keys are camelCase (`caloriesKcal`, `proteinG`, `carbsG`,
/// `fatG`) so the [SupabaseSyncSender]'s `nutrition_goals` flat-column lift
/// (which reads exactly these keys) populates `calories_kcal`/`protein_g`/
/// `carbs_g`/`fat_g`.
library;

class NutritionGoals {
  const NutritionGoals({
    this.caloriesKcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
  });

  /// Daily energy target in kcal. `null` = unset (honest empty ring).
  final double? caloriesKcal;

  /// Daily protein target in grams. `null` = unset.
  final double? proteinG;

  /// Daily carbohydrate target in grams. `null` = unset.
  final double? carbsG;

  /// Daily fat target in grams. `null` = unset.
  final double? fatG;

  /// True when NO target has been set (a brand-new, untouched goal).
  bool get isEmpty =>
      caloriesKcal == null &&
      proteinG == null &&
      carbsG == null &&
      fatG == null;

  /// Parse from stored/loaded JSON. Absent keys and explicit `null` BOTH produce
  /// Dart `null`; numbers are read via `num?` then narrowed, preserving `null`
  /// with no coalesce-to-a-number.
  factory NutritionGoals.fromJson(Map<String, dynamic> json) => NutritionGoals(
        caloriesKcal: (json['caloriesKcal'] as num?)?.toDouble(),
        proteinG: (json['proteinG'] as num?)?.toDouble(),
        carbsG: (json['carbsG'] as num?)?.toDouble(),
        fatG: (json['fatG'] as num?)?.toDouble(),
      );

  /// Serialise to JSON, **omitting** every null target — never emitted as `0`
  /// or a stand-in number. This is what lets a round-trip preserve "not set".
  Map<String, dynamic> toJson() => {
        if (caloriesKcal != null) 'caloriesKcal': caloriesKcal,
        if (proteinG != null) 'proteinG': proteinG,
        if (carbsG != null) 'carbsG': carbsG,
        if (fatG != null) 'fatG': fatG,
      };

  /// Return a copy with the given targets overridden. Like [Profile.copyWith],
  /// omitted args keep the existing value — it cannot set a target back to null.
  NutritionGoals copyWith({
    double? caloriesKcal,
    double? proteinG,
    double? carbsG,
    double? fatG,
  }) =>
      NutritionGoals(
        caloriesKcal: caloriesKcal ?? this.caloriesKcal,
        proteinG: proteinG ?? this.proteinG,
        carbsG: carbsG ?? this.carbsG,
        fatG: fatG ?? this.fatG,
      );
}
