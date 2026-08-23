/// Goal-aware target working weight per exercise — a pure Dart port of the
/// legacy `src/lib/strength-targets.ts`.
///
/// **HONESTY** (do NOT weaken): these gym machines aren't barbells, so an
/// absolute "you should press 40kg" from a strength-standards table would be a
/// lie when every machine's leverage differs. Targets come from ONE of two
/// honest bases only:
///
///  • [TargetBasis.bwRatio] — for the big COMPOUND movement PATTERNS, a
///    bodyweight-ratio benchmark scaled to the user's GOAL weight. A direction
///    to aim at ("machines vary"), never a verdict.
///  • [TargetBasis.personalScale] — for isolations (and anything with no
///    external standard), the current best scaled by bodyweight growth: keep
///    pace with your body as you reach the goal. Needs a REAL current weight AND
///    a REAL current best — otherwise [strengthTargetFor] returns `null` rather
///    than inventing a number.
library;

/// Target working weight as a fraction of bodyweight per movement PATTERN, at a
/// solid intermediate level — conservative + realistic for a lean bulker on
/// machines, aspirational but reachable, never elite-barbell figures.
class MovementRatios {
  const MovementRatios._();
  static const double shoulderPress = 0.5;
  static const double chestPress = 0.7;
  static const double pulldown = 0.85;
  static const double row = 0.8;
  static const double legPress = 2.0;
  static const double hipThrust = 1.25;
}

/// Where a strength target's number came from.
enum TargetBasis { bwRatio, personalScale }

/// A goal-aware strength target for one exercise. Only produced when there's an
/// honest basis; otherwise [strengthTargetFor] returns `null`.
class StrengthTarget {
  const StrengthTarget({
    required this.targetKg,
    required this.basis,
    required this.label,
    this.ratio,
    this.progressPct,
  });

  /// Suggested working weight, snapped to a clean 0.5kg increment.
  final double targetKg;
  final TargetBasis basis;

  /// The bodyweight ratio used ([TargetBasis.bwRatio] only).
  final double? ratio;

  /// Honest one-liner so the number is never mysterious.
  final String label;

  /// currentBest / target, clamped 0..1. Present only when a current best is
  /// known — otherwise `null` (an ungrounded bar is never drawn).
  final double? progressPct;
}

/// A compound-pattern rule: a name test + the bodyweight ratio + a key.
class _PatternRule {
  const _PatternRule({required this.test, required this.ratio, required this.key});
  final bool Function(String) test;
  final double ratio;
  final String key;
}

/// Ordered, exclusion-aware pattern matching. Isolations that merely share a
/// word with a compound ("Leg Extension", "Overhead Cable Triceps Extension",
/// "Calf Press on Leg Press") must fall through to personal-scale, never match a
/// ratio.
final List<_PatternRule> _compoundPatterns = [
  _PatternRule(
    key: 'pulldown',
    ratio: MovementRatios.pulldown,
    test: (n) => RegExp(r'\b(lat\s*pulldown|pulldown|pull-?up)\b').hasMatch(n),
  ),
  _PatternRule(
    key: 'row',
    ratio: MovementRatios.row,
    test: (n) => RegExp(r'\brow\b').hasMatch(n) && !RegExp('upright').hasMatch(n),
  ),
  _PatternRule(
    key: 'legPress',
    ratio: MovementRatios.legPress,
    test: (n) =>
        RegExp(r'\bleg\s*press\b').hasMatch(n) && !RegExp('calf').hasMatch(n),
  ),
  _PatternRule(
    key: 'hipThrust',
    ratio: MovementRatios.hipThrust,
    test: (n) => RegExp(r'\b(hip\s*thrust|glute\s*drive)\b').hasMatch(n),
  ),
  _PatternRule(
    key: 'chestPress',
    ratio: MovementRatios.chestPress,
    // A pressing movement for the chest. Exclude leg press (own rule) and any
    // triceps/extension work that happens to say "press".
    test: (n) => RegExp(
      r'\b(chest\s*press|incline\s*(chest\s*)?press|bench\s*press|smith\s*(incline\s*)?press)\b',
    ).hasMatch(n),
  ),
  _PatternRule(
    key: 'shoulderPress',
    ratio: MovementRatios.shoulderPress,
    // Overhead/shoulder PRESS only — never a triceps extension that says
    // "overhead".
    test: (n) =>
        RegExp(r'\b(shoulder\s*press|overhead\s*press|ohp)\b').hasMatch(n) &&
        !RegExp('extension|triceps').hasMatch(n),
  ),
];

/// Snap to a clean 0.5kg increment.
double _snapHalfKg(double n) => (n * 2).round() / 2;

_PatternRule? _movementRule(String name) {
  final n = name.toLowerCase();
  for (final rule in _compoundPatterns) {
    if (rule.test(n)) return rule;
  }
  return null;
}

/// Compute a goal-aware [StrengthTarget] for [exerciseName], or `null` when
/// there's nothing honest to ground a number on.
///
///  • A recognised COMPOUND pattern → a bodyweight-ratio benchmark scaled to
///    [goalWeightKg].
///  • Otherwise (isolation / unknown) → the current best scaled by bodyweight
///    growth, but ONLY when BOTH a real [currentWeightKg] (>0) and a real
///    [currentBestKg] (>0) are known. Missing either → `null` (never a guess).
StrengthTarget? strengthTargetFor(
  String exerciseName,
  double goalWeightKg, {
  double? currentWeightKg,
  double? currentBestKg,
}) {
  StrengthTarget withProgress(StrengthTarget t) =>
      currentBestKg != null && t.targetKg > 0
          ? StrengthTarget(
              targetKg: t.targetKg,
              basis: t.basis,
              ratio: t.ratio,
              label: t.label,
              progressPct: (currentBestKg / t.targetKg).clamp(0.0, 1.0),
            )
          : t;

  final rule = _movementRule(exerciseName);
  if (rule != null) {
    final targetKg = _snapHalfKg(goalWeightKg * rule.ratio);
    return withProgress(StrengthTarget(
      targetKg: targetKg,
      basis: TargetBasis.bwRatio,
      ratio: rule.ratio,
      label: 'Intermediate benchmark at ${goalWeightKg.round()}kg — machines '
          'vary, so aim, don\'t obsess',
    ));
  }

  // Personal-scale: needs BOTH a real current weight and a real current best,
  // or there's nothing honest to ground a number on.
  if (currentWeightKg != null &&
      currentWeightKg > 0 &&
      currentBestKg != null &&
      currentBestKg > 0) {
    final targetKg = _snapHalfKg(currentBestKg * (goalWeightKg / currentWeightKg));
    return withProgress(StrengthTarget(
      targetKg: targetKg,
      basis: TargetBasis.personalScale,
      label: 'Keep pace with your bodyweight on the way to '
          '${goalWeightKg.round()}kg',
    ));
  }

  return null;
}
