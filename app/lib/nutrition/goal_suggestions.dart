/// TDEE-derived daily calorie + protein SUGGESTIONS, computed from the user's
/// REAL profile (height / age / sex / weight) via the Mifflin–St Jeor equation.
///
/// This is the "set my baseline from my body" pass — the honest alternative to
/// the old React app's fabricated `2200` kcal / `140` g defaults. Every number
/// here traces to a real profile input:
///
///   BMR  = Mifflin–St Jeor(height, age, sex, weight)
///   TDEE = BMR × activity multiplier
///   calories = TDEE ± a surplus/deficit chosen for the goal direction
///   protein  = bodyweight × g/kg (higher for gain/cut, lower for maintain)
///
/// HONESTY (load-bearing — do NOT weaken):
///  • A suggestion is ONLY ever produced from COMPLETE real profile data. If
///    height, age, sex, weight, an activity level, OR a goal direction is
///    missing, [suggestGoals] returns `null` — an honest "can't suggest yet",
///    never a fabricated default TDEE or goal.
///  • The suggestion is a PREFILL the user confirms/edits before saving — this
///    file computes numbers, it never saves them.
///  • No `?? <constant>` fallbacks: a missing input propagates as `null`.
///
/// Mifflin–St Jeor (the modern, most-accurate BMR estimate):
///   men:   BMR = 10·kg + 6.25·cm − 5·age + 5
///   women: BMR = 10·kg + 6.25·cm − 5·age − 161
/// The only difference between the sexes is the trailing constant (+5 vs −161).
library;

/// A physical-activity level, mapped to the standard Mifflin–St Jeor TDEE
/// multipliers. These are DISCLOSED product constants (a well-established
/// activity-factor table), not user data — the user picks which one describes
/// them, and the resulting TDEE is shown as an estimate they can adjust.
enum ActivityLevel {
  /// Little or no exercise (desk job). ×1.2
  sedentary(1.2, 'Sedentary', 'Little or no exercise'),

  /// Light exercise 1–3 days/week. ×1.375
  light(1.375, 'Lightly active', 'Light exercise 1–3 days/week'),

  /// Moderate exercise 3–5 days/week. ×1.55
  moderate(1.55, 'Moderately active', 'Exercise 3–5 days/week'),

  /// Hard exercise 6–7 days/week. ×1.725
  active(1.725, 'Very active', 'Hard exercise 6–7 days/week'),

  /// Very hard exercise + a physical job. ×1.9
  veryActive(1.9, 'Extra active', 'Very hard exercise / physical job');

  const ActivityLevel(this.multiplier, this.label, this.description);

  /// The TDEE multiplier applied to BMR (1.2 / 1.375 / 1.55 / 1.725 / 1.9).
  final double multiplier;

  /// A short human label for the picker.
  final String label;

  /// A one-line description of who this level fits.
  final String description;

  /// Parse a stored/persisted name back to a level, or `null` when absent or
  /// unrecognised (never a fabricated default — an unknown activity means "not
  /// provided", which honestly blocks a suggestion).
  static ActivityLevel? fromName(String? name) {
    if (name == null) return null;
    for (final level in ActivityLevel.values) {
      if (level.name == name) return level;
    }
    return null;
  }
}

/// The g/kg-of-bodyweight protein multiplier per goal direction. Gain/cut sit in
/// the evidence-backed band for muscle retention; maintenance a touch lower.
/// Matches the legacy `goal-suggestions.ts` point values.
///
/// Keyed on the PROFILE's goal-direction vocabulary (`gain` / `cut` /
/// `maintain`). The legacy code used `lose`; here `cut` is the same intent.
const Map<String, double> _proteinGPerKg = {
  'gain': 2.0,
  'maintain': 1.6,
  'cut': 2.2,
};

/// Lean-bulk surplus over TDEE, in kcal/day. Matches the legacy
/// `GAIN_SURPLUS_KCAL` (≈ mid-band 0.17 kg/wk → ≈ 187 → rounded to 200).
const double kGainSurplusKcal = 200;

/// Standard sustainable cut — ~0.5 kg/wk. Matches the legacy `LOSE_DEFICIT_KCAL`.
const double kCutDeficitKcal = 500;

bool _validPositive(num? n) => n != null && n.isFinite && n > 0;

/// The Basal Metabolic Rate via Mifflin–St Jeor, or `null` if ANY required
/// input is missing/invalid — never a guessed default.
///
/// Sex handling (documented + honest):
///  • `'male'` / `'m'` → the men's constant (+5).
///  • `'female'` / `'f'` → the women's constant (−161).
///  • Any other / unknown sex → the AVERAGE of the two constants ((+5 + −161)/2
///    = −78), and this is DISCLOSED in the UI as an estimate. We deliberately do
///    NOT return null for a non-binary/other sex — the equation is still a
///    reasonable estimate from real height/age/weight, and refusing to suggest
///    anything would be worse UX than an honestly-labelled averaged estimate.
///    A `null`/empty sex, by contrast, IS treated as missing → null (we can't
///    estimate without knowing which constant band the user is in, and an empty
///    sex means the user simply hasn't told us).
double? mifflinBmr({
  double? heightCm,
  int? ageYears,
  String? sex,
  double? weightKg,
}) {
  if (!_validPositive(heightCm) ||
      !_validPositive(ageYears) ||
      !_validPositive(weightKg)) {
    return null;
  }
  final sexConstant = _sexConstant(sex);
  if (sexConstant == null) return null; // missing/empty sex → can't estimate.

  return 10 * weightKg! + 6.25 * heightCm! - 5 * ageYears! + sexConstant;
}

/// The trailing Mifflin constant for a sex string, or `null` when sex is
/// missing/empty. Unknown-but-present sex → the averaged constant (−78),
/// disclosed by the caller as an estimate.
double? _sexConstant(String? sex) {
  final s = sex?.trim().toLowerCase();
  if (s == null || s.isEmpty) return null;
  if (s == 'male' || s == 'm') return 5;
  if (s == 'female' || s == 'f') return -161;
  // Non-binary / other / unrecognised but PRESENT → average of the two.
  return (5 + -161) / 2; // = -78
}

/// Total Daily Energy Expenditure — BMR × the activity multiplier. `null` when
/// [bmr] is null (missing profile data) — the null propagates honestly.
double? tdee(double? bmr, ActivityLevel activity) {
  if (bmr == null || !bmr.isFinite || bmr <= 0) return null;
  return bmr * activity.multiplier;
}

/// A computed goal suggestion — a PREFILL for the editor, never auto-saved.
class GoalSuggestion {
  const GoalSuggestion({
    required this.calories,
    required this.calorieDelta,
    required this.protein,
    required this.proteinPerKg,
    required this.tdee,
    required this.usedAveragedSexConstant,
  });

  /// Suggested daily calorie target (rounded to the nearest 50).
  final double calories;

  /// Signed surplus/deficit vs TDEE baked into [calories] (0 for maintain).
  final double calorieDelta;

  /// Suggested daily protein target in grams (bodyweight × [proteinPerKg]).
  final double protein;

  /// The g/kg multiplier behind [protein] — surfaced so the UI can show the math.
  final double proteinPerKg;

  /// The underlying TDEE the calorie target was derived from (rounded to 50 for
  /// display). Shown in the disclosure so the estimate is transparent.
  final double tdee;

  /// True when the BMR used the AVERAGED sex constant (an "other"/unknown sex),
  /// so the UI can disclose that the estimate is a touch rougher.
  final bool usedAveragedSexConstant;
}

/// Round half-UP to the nearest 50 — parity with the legacy backend's
/// `_round_half_up` (Dart's `round()` already rounds half away from zero, so for
/// positive values this matches: `n/50` rounded, ×50).
double _round50(double kcal) => (kcal / 50).round() * 50.0;

/// Suggest daily calorie + protein targets from the user's REAL body data.
///
/// Inputs (all must be present for a suggestion):
///  • [heightCm], [ageYears], [sex], [weightKg] — the real profile fields.
///  • [activity] — the chosen activity level (picked in the sheet if unset).
///  • [direction] — the goal direction (`'gain'` / `'cut'` / `'maintain'`).
///
/// Returns `null` when height/age/sex/weight are incomplete OR [direction] isn't
/// one of the three known values — an honest "complete your profile" signal, not
/// a fabricated number. When present:
///  • calories = round50(TDEE ± the direction's surplus/deficit)
///  • protein  = round(bodyweight × the direction's g/kg)
GoalSuggestion? suggestGoals({
  required double? heightCm,
  required int? ageYears,
  required String? sex,
  required double? weightKg,
  required ActivityLevel activity,
  required String? direction,
}) {
  final perKg = direction == null ? null : _proteinGPerKg[direction];
  if (perKg == null) return null; // unknown/missing direction → no suggestion.

  final bmr = mifflinBmr(
    heightCm: heightCm,
    ageYears: ageYears,
    sex: sex,
    weightKg: weightKg,
  );
  final baseTdee = tdee(bmr, activity);
  if (baseTdee == null) return null; // incomplete profile → honest null.
  // weightKg is guaranteed valid here (mifflinBmr returned non-null).

  final delta = direction == 'gain'
      ? kGainSurplusKcal
      : direction == 'cut'
          ? -kCutDeficitKcal
          : 0.0;

  return GoalSuggestion(
    calories: _round50(baseTdee + delta),
    calorieDelta: delta,
    protein: (weightKg! * perKg).roundToDouble(),
    proteinPerKg: perKg,
    tdee: _round50(baseTdee),
    usedAveragedSexConstant: _isOtherSex(sex),
  );
}

/// True when [sex] is present but neither male nor female (→ averaged constant).
bool _isOtherSex(String? sex) {
  final s = sex?.trim().toLowerCase();
  if (s == null || s.isEmpty) return false;
  return s != 'male' && s != 'm' && s != 'female' && s != 'f';
}
