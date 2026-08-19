// ignore_for_file: prefer_initializing_formals

import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';

/// Resets the user's goal fields in the stored [Profile].
///
/// The reset is HONEST: it nulls `goalDirection` and `targetWeightKg` (the
/// values the user had entered) and never substitutes any fabricated default.
/// Non-goal fields (weight, height, age, sex, gym) are preserved exactly as-is.
///
/// This is the hook the "prize re-reveal" affordance will call — when Brody
/// resets his goal, the goal UI returns to its "not set" honest-empty state.
class GoalResetController {
  const GoalResetController({required ProfileRepo repo}) : _repo = repo;

  final ProfileRepo _repo;

  /// Load the current profile, null out the two goal fields, and save.
  ///
  /// The resulting profile has `goalDirection == null` and
  /// `targetWeightKg == null` — no fabricated replacement is ever written.
  Future<void> reset() async {
    final current = await _repo.load();

    // Rebuild the profile preserving every non-goal field. `copyWith` cannot
    // express "set to null", so we construct directly.
    final cleared = Profile(
      heightCm: current.heightCm,
      ageYears: current.ageYears,
      sex: current.sex,
      weightKg: current.weightKg,
      goalDirection: null, // explicitly cleared — no default substituted
      targetWeightKg: null, // explicitly cleared — no default substituted
      primaryGym: current.primaryGym,
    );

    await _repo.save(cleared);
  }
}
