/// The honest strength-progression engine — the "go heavier / hold / deload"
/// brain of the gym. A pure Dart port of the app's legacy
/// `src/lib/workout-progression.ts` (`predictNextWeight` +
/// `evaluateProgressionFeedback`) and the stack snapping from
/// `src/lib/gym-equipment.ts`.
///
/// HONESTY INVARIANTS (do NOT weaken — these encode hard-won fixes):
///  • A **bump** (go heavier) is EARNED only when the working sets genuinely
///    justify it: the top of the rep range is hit on EVERY working set at the
///    REAL weight lifted. A rep shortfall is a MISS, not a pass.
///  • The next-weight suggestion is derived from the weight ACTUALLY lifted
///    (the last completed working set), never a stale seeded/target value.
///  • Machine weights snap to real stack increments; free-weights snap to a
///    plate step; bodyweight/cardio pass through.
///  • Missing inputs → an honest [ProgressionVerdict.recalibrating] with no
///    fabricated number.
///
/// PARITY NOTES / interpretations (where the Dart port had to adapt):
///  • The legacy [EquipmentType] catalogue is 7-way with per-machine stacks; the
///    Flutter [EquipmentType] is 4-way (machine/freeWeight/bodyweight/cardio)
///    and carries no per-exercise stack. So [snapToStack] uses generic families:
///    machine → the imperial 5kg selector family (`_machineStep`, matching the
///    legacy Gym-Group imperial stacks rounded to whole kg); free-weight → the
///    legacy `genericStep` (1.25kg < 40kg, 2.5kg ≥ 40kg, one plate per side).
///  • The legacy took a numeric RIR (reps-in-reserve). The Flutter model instead
///    records a [SetEffort] emoji per set. This port folds effort in as a
///    documented, tested layer consistent with the north-star (easy→heavier,
///    angry→hold/deload, contempt→hold): the last working set's effort maps to
///    an effective RIR (see [_rirFromEffort]) fed into the same legacy rules.
library;

import 'exercise.dart';
import 'workout_session.dart';

// ── Default rep range ────────────────────────────────────────────────────────

/// Default hypertrophy rep range used until the program layer sets per-exercise
/// targets (P-later). A documented product default, not fabricated user data:
/// the [Exercise] model carries no rep range yet, so the live UI passes these
/// into [evaluateProgression] rather than inventing/storing a per-exercise one.
const int kDefaultRepTargetLow = 8;
const int kDefaultRepTargetHigh = 12;

// ── Tunables (ported verbatim from PROGRESSION in src/program.ts) ────────────

/// Top of range but 2+ left in the tank → same weight, "push harder".
const int _holdAboveRir = 2;

/// At/above this RIR, "push harder" is not available: capped by the rep range
/// rather than by strength, so the weight itself is too light → still a bump.
const int _tooLightRir = 3;

/// Missed the bottom of the range → drop this fraction and rebuild (deload).
const double _stallDeloadPct = 0.15;

/// Smallest available jump exceeding this fraction of current load → don't jump;
/// keep adding reps until the notch is affordable.
const double _maxJumpPct = 0.10;

/// Reaching this multiple of the rep-range top earns an oversized notch anyway
/// (escape hatch so a big-step stack can't deadlock forever).
const double _repsOverrunMultiplier = 1.5;

/// Free-weight compound threshold: at/above this, the plate step is 2.5kg.
const double _compoundThresholdKg = 40;

// ── Result types ─────────────────────────────────────────────────────────────

/// The coarse verdict surfaced to the UI. Maps the legacy `PredictRationale`
/// families down to four honest states.
enum ProgressionVerdict {
  /// Genuine, earned weight increase (legacy `bump-*`). Fires confetti.
  bump,

  /// Same weight — inside the range, soft top set, or an unaffordable next
  /// notch (legacy `hold-*` / `baseline-*`).
  hold,

  /// Back off and rebuild — missed the bottom of the range, or a failed set
  /// (legacy `deload-*`).
  deload,

  /// Not enough honest data to decide (no weight logged, empty sets). Never a
  /// fabricated recommendation (legacy `no-history`).
  recalibrating,
}

/// The engine's verdict for one exercise's just-completed working sets.
class ProgressionResult {
  const ProgressionResult({
    required this.verdict,
    this.nextWeightKg,
    this.reason,
  });

  final ProgressionVerdict verdict;

  /// Suggested working weight next time, snapped to the equipment's real
  /// increment. `null` when there's nothing honest to suggest
  /// ([ProgressionVerdict.recalibrating]).
  final double? nextWeightKg;

  /// One-liner explaining the number so it's never mysterious.
  final String? reason;
}

// ── Stack snapping (port of snapToStack / genericStep in gym-equipment.ts) ────

/// Snap a raw weight to the nearest real increment for the given equipment.
///  • machine → nearest notch on the 5kg imperial selector family.
///  • freeWeight → nearest plate step (1.25kg < 40kg, else 2.5kg).
///  • bodyweight/cardio → unchanged (no external stack).
double snapToStack(double weightKg, EquipmentType equipment) {
  final step = _stepFor(weightKg, equipment);
  if (step == null) return weightKg; // bodyweight / cardio pass through
  if (weightKg <= 0) return weightKg;
  final snapped = (weightKg / step).round() * step;
  return _round2(snapped);
}

/// The increment above `weightKg` for this equipment (`null` = no stack).
double? _stepFor(double weightKg, EquipmentType equipment) {
  switch (equipment) {
    case EquipmentType.machine:
      return _machineStep;
    case EquipmentType.freeWeight:
      return weightKg >= _compoundThresholdKg ? 2.5 : 1.25;
    case EquipmentType.bodyweight:
    case EquipmentType.cardio:
      return null;
  }
}

/// The Gym-Group imperial selector families round to ~5kg whole-kg notches
/// (…20, 25, 32, 39, 45… for the 15lb family / …20, 23, 27, 32… for the 10lb
/// family). With no per-machine catalogue on the Flutter side we model a single
/// honest 5kg machine step — real, selectable, never an impossible in-between.
const double _machineStep = 5;

/// Next selectable weight strictly heavier than `kg` for this equipment.
double _nextUp(double kg, EquipmentType equipment) {
  final step = _stepFor(kg, equipment);
  if (step == null) return kg;
  final snapped = snapToStack(kg, equipment);
  final up = snapped > kg + 1e-6 ? snapped : _round2(snapped + step);
  return up;
}

// ── Effort → effective RIR (documented Flutter extension) ────────────────────

/// Translate the last working set's [SetEffort] into the numeric RIR the legacy
/// rules consume. Consistent with the north-star (easy→heavier, angry→
/// hold/deload, contempt→hold):
///  • easy → 3 (too-light: capped by the range, not strength → go heavier).
///  • contempt (a grind — you barely finished, no honest headroom to add load)
///    → [_holdAboveRir] so a topped set HOLDS ("consolidate at this weight")
///    rather than bumping. This is a deliberate Flutter extension: the legacy
///    engine, given a clean top set with ~0 RIR, would bump — but the emoji
///    scale's "grind" explicitly signals the lift was maximal for these reps,
///    which is a hold, not free progression.
///  • angry (failed / at max) → treated as a failure, forcing hold/deload.
///  • null (unrated) → null: per legacy, hitting the top of the range alone
///    earns the jump when effort wasn't reported.
int? _rirFromEffort(SetEffort? effort) {
  switch (effort) {
    case SetEffort.easy:
      return _tooLightRir; // 3 → too light, go heavier
    case SetEffort.contempt:
      return _holdAboveRir; // grind → hold, push harder before adding load
    case SetEffort.angry:
      return null; // handled specially below (failure), not via RIR
    case null:
      return null;
  }
}

// ── Core engine (port of predictNextWeight + evaluateProgressionFeedback) ─────

/// Evaluate the just-completed working sets and decide whether to go heavier,
/// hold, or deload — and what the next working weight should be.
///
/// [sets] are the working sets in order (ramp-ups excluded by the caller).
/// [repTargetLow]/[repTargetHigh] are the prescribed rep range.
ProgressionResult evaluateProgression({
  required List<SetEntry> sets,
  required int repTargetLow,
  required int repTargetHigh,
  required EquipmentType equipment,
}) {
  final done = _completed(sets);

  // Working weight actually SETTLED on: the last completed set with a real
  // positive weight. This — not a target/seed — anchors every suggestion.
  double? settled;
  for (var i = done.length - 1; i >= 0; i--) {
    final w = done[i].weightKg;
    if (w != null && w > 0) {
      settled = w;
      break;
    }
  }

  // Missing inputs → honest recalibrating, never a fabricated number.
  if (done.isEmpty || settled == null || repTargetHigh < repTargetLow) {
    return const ProgressionResult(
      verdict: ProgressionVerdict.recalibrating,
      reason: 'Not enough data yet — log a working set to get a suggestion.',
    );
  }

  final baseline = settled;

  // Effort of the last working set drives the effort layer.
  final lastEffort = done.last.effort;

  // ANGRY = failed / at-max. A failure at or below the range top can never
  // earn a jump; hold. Below the bottom, deload (handled generically below).
  final failed = lastEffort == SetEffort.angry;

  final belowMin = _allBelowMin(done, repTargetLow);
  final atTop = _allAtTop(done, repTargetHigh);

  // 1. Missed the bottom of the range on every set → deload and rebuild.
  if (belowMin) {
    return ProgressionResult(
      verdict: ProgressionVerdict.deload,
      nextWeightKg: snapToStack(baseline * (1 - _stallDeloadPct), equipment),
      reason: 'Below the range — dropping ~15% to rebuild.',
    );
  }

  // 2. Topped the range on every set → maybe a bump (the earned path).
  if (atTop) {
    // A failed (angry) top set is honest exhaustion, not headroom → hold.
    if (failed) {
      return ProgressionResult(
        verdict: ProgressionVerdict.hold,
        nextWeightKg: baseline,
        reason: 'Topped the range but that was a max effort — hold and repeat.',
      );
    }

    final rir = _rirFromEffort(lastEffort);
    final tooLight = rir != null && rir >= _tooLightRir;

    // Soft top (2+ in reserve, but not "too light") → hold, push harder.
    if (rir != null && rir >= _holdAboveRir && !tooLight) {
      return ProgressionResult(
        verdict: ProgressionVerdict.hold,
        nextWeightKg: baseline,
        reason: 'Hit the top with reps to spare — same weight, push harder.',
      );
    }

    // Earned. The next notch is derived from the ACTUAL lifted weight.
    final target = _nextUp(baseline, equipment);
    final jumpPct = baseline > 0 ? (target - baseline) / baseline : 0.0;

    if (jumpPct > _maxJumpPct) {
      // Oversized next notch. Enough overrun reps at this weight earn it anyway.
      final achieved = done
          .map((s) => s.reps ?? 0)
          .fold<int>(0, (a, b) => a > b ? a : b);
      final jumpAt = (repTargetHigh * _repsOverrunMultiplier).ceil();
      if (achieved >= jumpAt) {
        return ProgressionResult(
          verdict: ProgressionVerdict.bump,
          nextWeightKg: target,
          reason: '$achieved reps at ${_num(baseline)}kg earns the jump.',
        );
      }
      // Otherwise the notch is unaffordable — hold and build reps first.
      return ProgressionResult(
        verdict: ProgressionVerdict.hold,
        nextWeightKg: baseline,
        reason:
            'Next notch is +${(jumpPct * 100).round()}% — build to $jumpAt reps here first.',
      );
    }

    return ProgressionResult(
      verdict: ProgressionVerdict.bump,
      nextWeightKg: target,
      reason: tooLight
          ? 'Capped by the rep range, not by strength — going up.'
          : 'Earned it — smallest jump up.',
    );
  }

  // 3. Inside the range (not below the bottom, not at the top) → hold and add a
  //    rep. A failed set inside the range is still just a hold at this weight.
  return ProgressionResult(
    verdict: ProgressionVerdict.hold,
    nextWeightKg: baseline,
    reason: 'Inside the range — same weight, add a rep.',
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Sets that were actually performed (a real positive rep count).
List<SetEntry> _completed(List<SetEntry> sets) =>
    sets.where((s) => (s.reps ?? 0) > 0).toList();

bool _allBelowMin(List<SetEntry> sets, int low) =>
    sets.isNotEmpty && sets.every((s) => (s.reps ?? 0) < low);

bool _allAtTop(List<SetEntry> sets, int high) =>
    sets.isNotEmpty && sets.every((s) => (s.reps ?? 0) >= high);

double _round2(double n) => (n * 100).round() / 100;

/// Format a weight for a reason string without a trailing `.0`.
String _num(double n) => n == n.roundToDouble() ? n.round().toString() : '$n';
