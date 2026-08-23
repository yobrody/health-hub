/// AI nutrition estimate models (P1 capture — photo/text → macros).
///
/// A [NutritionEstimate] is an **estimate**, never a measured fact. Honesty is
/// load-bearing and mirrors [FoodLogEntry]/[RecognizedItem]:
///  • Every macro is nullable. A value the model can't see/estimate is `null`
///    (→ blank in the form), NEVER a fabricated `0` or a precise guess.
///  • [confidence] is 0..1 and is shown honestly, never hidden.
///  • Nothing here is logged. The capture screen prefills the form as an
///    ESTIMATE (AccuracyTier.estimate, `~`) and the user confirms/edits before
///    the normal Log path writes it.
library;

/// A single AI-produced nutrition estimate for one meal/food.
///
/// All macros nullable — unsure → `null`, never `0`. [confidence] clamped to
/// [0.0, 1.0] on construction so a malformed value can't render >100%/negative.
class NutritionEstimate {
  const NutritionEstimate({
    this.name,
    this.kcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
    required this.confidence,
    this.note,
  });

  /// Best-guess human name (e.g. "Chicken salad"). `null` when the model
  /// couldn't name it — the user fills it in before logging.
  final String? name;

  /// Estimated energy in kcal, or `null` when it couldn't be estimated. NEVER a
  /// fabricated 0 — a real 0 would be a measured value, which an estimate isn't.
  final double? kcal;

  /// Estimated protein (g), or `null` when unsure.
  final double? proteinG;

  /// Estimated carbohydrate (g), or `null` when unsure.
  final double? carbsG;

  /// Estimated fat (g), or `null` when unsure.
  final double? fatG;

  /// Model confidence in [0.0, 1.0]. Shown honestly in the UI.
  final double confidence;

  /// A short, optional model note (e.g. "assumed a standard bowl"). `null`
  /// when none. Never a substitute for a real number.
  final String? note;

  /// True when at least one macro was estimated — lets the UI distinguish an
  /// "I saw a meal but couldn't put numbers on it" result from a real estimate.
  bool get hasAnyMacro =>
      kcal != null || proteinG != null || carbsG != null || fatG != null;

  Map<String, dynamic> toJson() => {
        if (name != null) 'name': name,
        if (kcal != null) 'kcal': kcal,
        if (proteinG != null) 'protein_g': proteinG,
        if (carbsG != null) 'carbs_g': carbsG,
        if (fatG != null) 'fat_g': fatG,
        'confidence': confidence,
        if (note != null) 'note': note,
      };

  /// Parse the edge function's JSON. Absent/null macros stay `null` (never 0);
  /// confidence is clamped into range; a blank name becomes `null`.
  factory NutritionEstimate.fromJson(Map<String, dynamic> json) {
    final rawName = (json['name'] as String?)?.trim();
    final rawNote = (json['note'] as String?)?.trim();
    final rawConf = (json['confidence'] as num?)?.toDouble() ?? 0.0;
    final conf = rawConf.isNaN ? 0.0 : rawConf.clamp(0.0, 1.0).toDouble();
    return NutritionEstimate(
      name: (rawName == null || rawName.isEmpty) ? null : rawName,
      kcal: _macro(json['kcal']),
      proteinG: _macro(json['protein_g']),
      carbsG: _macro(json['carbs_g']),
      fatG: _macro(json['fat_g']),
      confidence: conf,
      note: (rawNote == null || rawNote.isEmpty) ? null : rawNote,
    );
  }

  /// Parse a macro value. A non-finite/negative/absent value → `null` (honest
  /// "unknown"), never a fabricated number. A real `0` is preserved.
  static double? _macro(Object? raw) {
    if (raw is! num) return null;
    final v = raw.toDouble();
    if (!v.isFinite || v < 0) return null;
    return v;
  }
}
