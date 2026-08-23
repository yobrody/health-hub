/// Transformation roadmap + physique milestones — a pure Dart port of the
/// legacy `src/lib/transformation.ts` (`projectRoadmap` + `physiqueMilestones`).
///
/// **HONESTY is the whole point** (do NOT weaken):
///  • A roadmap ETA is projected from the user's REAL weekly weight trend ONLY
///    when that trend is reliable (≥2 real weigh-ins spanning ≥14 days AND
///    moving toward the goal). Otherwise it falls back to a clearly-DISCLOSED
///    healthy default rate ([Roadmap.usedDefaultRate] == true) — never a
///    measured-looking number. With no current OR target weight there is no
///    honest projection at all → [projectRoadmap] returns `null`.
///  • The ETA is to MONTH precision (e.g. "December 2026"), never a fabricated
///    precise day — a projection is an estimate, and a to-the-day date would
///    over-claim.
///  • Physique SIZE milestones are anchored to real bodyweight (current→goal).
///    Visible-ABS is anchored to BODY FAT %, weight-independent — and honest
///    that a bulk RAISES body fat. Without a real body-fat reading the abs
///    milestone is [MilestoneStatus.needsData], never a guessed BF.
library;

// ── Roadmap ────────────────────────────────────────────────────────────────

/// Which way the plan is heading.
enum RoadmapDirection { gain, lose, maintain }

/// Where the roadmap's weekly rate came from.
///  • [observed] — the user's REAL weigh-in trend (reliable + toward goal).
///  • defaultRate — a disclosed healthy default (no reliable trend yet).
enum RateSource { observed, defaultRate }

/// The healthy lean-bulk default band midpoint (~0.17 kg/wk), matching the
/// legacy `BODYWEIGHT_TARGET.weeklyGainKg{Min,Max}` (0.11–0.23).
const double kDefaultGainRateKgPerWeek = (0.11 + 0.23) / 2;

/// A sustainable, muscle-sparing default cut rate (~0.5 kg/wk).
const double kDefaultLossRateKgPerWeek = 0.5;

/// Within this of the goal → effectively "there" (maintain).
const double kMaintainBandKg = 0.3;

/// The minimum real span (days) before a weigh-in trend is trusted to project.
const int kReliableTrendDays = 14;

/// A minimum real weekly change (kg) either side of zero, below which the trend
/// reads as "flat" — used so tiny noise doesn't look like real movement.
const double _trendEpsilonKgPerWeek = 0.02;

/// The projected roadmap from current weight → goal weight.
///
/// All fields are honest: [weeksToGoal]/[etaMonthIso] are `null` when the user
/// is already at goal (maintain). [usedDefaultRate] discloses whether the ETA
/// came from the real trend or a healthy default.
class Roadmap {
  const Roadmap({
    required this.direction,
    required this.remainingKg,
    required this.rateKgPerWeek,
    required this.rateSource,
    required this.onTrack,
    required this.weeksToGoal,
    required this.etaMonthIso,
    required this.note,
  });

  final RoadmapDirection direction;

  /// Absolute kg still to change to reach the goal.
  final double remainingKg;

  /// The weekly rate used for the projection (observed or default). `0` when
  /// already at goal.
  final double rateKgPerWeek;

  final RateSource rateSource;

  /// True only when the REAL observed trend is moving toward the goal.
  final bool onTrack;

  /// Whole weeks to the goal at [rateKgPerWeek]. `null` when at goal.
  final int? weeksToGoal;

  /// ETA to MONTH precision as `YYYY-MM` (e.g. `2026-12`). `null` when at goal.
  /// Never a fabricated to-the-day date.
  final String? etaMonthIso;

  /// A one-line honest note that always discloses the projection's basis.
  final String note;

  /// True when the ETA rests on a disclosed default rate rather than the user's
  /// real trend — the UI must say so.
  bool get usedDefaultRate => rateSource == RateSource.defaultRate;
}

/// A single dated weight reading the roadmap projects from. A minimal shape so
/// the pure module never depends on the repo/model layer; the page adapts
/// `WeighIn` (real, non-null weight) into these.
class RoadmapWeighIn {
  const RoadmapWeighIn({required this.at, required this.weightKg});
  final DateTime at;
  final double weightKg;
}

/// Compute the observed weekly weight change (kg/week) and whether it's reliable
/// from the real weigh-in history.
///
/// Reliable == ≥2 real readings spanning ≥[kReliableTrendDays] days. The rate is
/// the net change (latest − earliest) divided by the elapsed weeks. Returns
/// `(null, false)` when there isn't enough real signal — NEVER a fabricated
/// trend. Exposed (not private) so the page and tests can reuse it.
({double? weeklyChangeKg, bool reliable}) observedWeeklyChange(
  List<RoadmapWeighIn> weighIns,
) {
  final real = [...weighIns]..sort((a, b) => a.at.compareTo(b.at));
  if (real.length < 2) return (weeklyChangeKg: null, reliable: false);

  final first = real.first;
  final last = real.last;
  final days = last.at.difference(first.at).inDays;
  if (days <= 0) return (weeklyChangeKg: null, reliable: false);

  final weeks = days / 7.0;
  final weeklyChange = (last.weightKg - first.weightKg) / weeks;
  final reliable = days >= kReliableTrendDays;
  return (weeklyChangeKg: weeklyChange, reliable: reliable);
}

/// Project the roadmap from [currentWeightKg] → [targetWeightKg].
///
/// [weighIns] are the REAL weigh-ins (non-null weight) the observed trend is
/// derived from; [now] anchors the ETA (passed in for deterministic tests).
///
/// Returns `null` when there's no honest projection — a missing current OR
/// target weight (needs-data). Otherwise an honest [Roadmap]: the ETA is from
/// the real trend when reliable+toward-goal, else a disclosed default rate.
Roadmap? projectRoadmap({
  required double? currentWeightKg,
  required double? targetWeightKg,
  required List<RoadmapWeighIn> weighIns,
  required DateTime now,
}) {
  // No current or target → nothing honest to project. needs-data.
  if (currentWeightKg == null || targetWeightKg == null) return null;

  final delta = targetWeightKg - currentWeightKg;
  final remainingKg = delta.abs();

  // Already at goal (within the maintain band) → hold, no timeline.
  if (remainingKg <= kMaintainBandKg) {
    return Roadmap(
      direction: RoadmapDirection.maintain,
      remainingKg: remainingKg,
      rateKgPerWeek: 0,
      rateSource: RateSource.defaultRate,
      onTrack: true,
      weeksToGoal: null,
      etaMonthIso: null,
      note: "You're at your goal weight — hold it steady.",
    );
  }

  final direction =
      delta > 0 ? RoadmapDirection.gain : RoadmapDirection.lose;
  final defaultRate = direction == RoadmapDirection.gain
      ? kDefaultGainRateKgPerWeek
      : kDefaultLossRateKgPerWeek;

  final observed = observedWeeklyChange(weighIns);
  final weeklyChangeKg = observed.weeklyChangeKg;
  final reliable = observed.reliable;

  // The observed trend is usable only when reliable AND moving toward the goal.
  final observedTowardGoal = weeklyChangeKg != null &&
      ((direction == RoadmapDirection.gain &&
              weeklyChangeKg > _trendEpsilonKgPerWeek) ||
          (direction == RoadmapDirection.lose &&
              weeklyChangeKg < -_trendEpsilonKgPerWeek));
  final useObserved = reliable && observedTowardGoal;

  final rateKgPerWeek =
      useObserved ? weeklyChangeKg.abs() : defaultRate;
  final rateSource =
      useObserved ? RateSource.observed : RateSource.defaultRate;
  final onTrack = observedTowardGoal;

  final weeksToGoal = (remainingKg / rateKgPerWeek).ceil();
  final etaMonthIso = _addWeeksToMonthIso(now, weeksToGoal);

  final String note;
  if (reliable && weeklyChangeKg != null && !observedTowardGoal) {
    // A reliable trend that moves AWAY from the goal — say so honestly, and
    // still give a projection using the disclosed healthy default rate.
    final trendWord = weeklyChangeKg > _trendEpsilonKgPerWeek
        ? 'gaining'
        : (weeklyChangeKg < -_trendEpsilonKgPerWeek ? 'losing' : 'holding steady');
    note = direction == RoadmapDirection.gain
        ? "You're currently $trendWord — at a healthy bulk rate you'd reach "
            '${_formatKg(targetWeightKg)}kg in about $weeksToGoal weeks.'
        : "You're currently $trendWord — at a steady cut you'd reach "
            '${_formatKg(targetWeightKg)}kg in about $weeksToGoal weeks.';
  } else if (useObserved) {
    note = 'At your real ${rateKgPerWeek.toStringAsFixed(2)} kg/wk you\'ll hit '
        '${_formatKg(targetWeightKg)}kg in about $weeksToGoal weeks.';
  } else {
    note = 'Log your weight for two weeks to project from your real pace — for '
        'now this assumes a healthy ${rateKgPerWeek.toStringAsFixed(2)} kg/wk.';
  }

  return Roadmap(
    direction: direction,
    remainingKg: remainingKg,
    rateKgPerWeek: rateKgPerWeek,
    rateSource: rateSource,
    onTrack: onTrack,
    weeksToGoal: weeksToGoal,
    etaMonthIso: etaMonthIso,
    note: note,
  );
}

/// Add [weeks] whole weeks to [from] and return the resulting month as
/// `YYYY-MM` (month precision — never a fabricated day). Uses UTC-stable date
/// math so the month can't drift by a timezone hour.
String _addWeeksToMonthIso(DateTime from, int weeks) {
  final base = DateTime.utc(from.year, from.month, from.day);
  final eta = base.add(Duration(days: weeks * 7));
  final mm = eta.month.toString().padLeft(2, '0');
  return '${eta.year}-$mm';
}

// ── Physique milestones ──────────────────────────────────────────────────────

/// What measurable signal a milestone is anchored to.
enum MilestoneAnchor { weight, bodyFat }

/// A milestone's honest state.
enum MilestoneStatus { reached, approaching, needsData }

/// One physique milestone — a look tied to a MEASURABLE signal, surfaced as an
/// estimate, never a promise.
class PhysiqueMilestone {
  const PhysiqueMilestone({
    required this.id,
    required this.title,
    required this.signal,
    required this.anchor,
    required this.beyondGoal,
    required this.progressPct,
    required this.status,
    required this.note,
    this.targetWeightKg,
    this.targetBodyFatPct,
  });

  final String id;
  final String title;

  /// The measurable signal that marks this look.
  final String signal;
  final MilestoneAnchor anchor;

  /// Present only for weight-anchored milestones.
  final double? targetWeightKg;

  /// Present only for the body-fat-anchored abs milestone.
  final double? targetBodyFatPct;

  /// True when a weight milestone's target sits BEYOND the current goal — it
  /// can't be reached within the plan, so the UI says so rather than showing a
  /// forever-"approaching" bar. Always false for the body-fat milestone.
  final bool beyondGoal;

  /// Progress toward the signal, 0..1. `null` when it can't be measured
  /// honestly yet (no body-fat reading).
  final double? progressPct;

  final MilestoneStatus status;
  final String note;
}

/// Weight-anchored size milestones: kg of gain (from the journey start) that
/// typically brings each look on a lean bulk. Rough + individual — surfaced as
/// estimates, never promises.
const List<({String id, String title, String signal, double deltaKg, String note})>
    _weightMilestones = [
  (
    id: 'shoulders',
    title: 'Shoulders fill out · t-shirts fit better',
    signal: 'delts + upper back grow with ~3kg of gain',
    deltaKg: 3,
    note: 'The first change most people notice — sleeves and shoulders before '
        'anything else.',
  ),
  (
    id: 'arms',
    title: 'Arms visibly bigger',
    signal: 'measurable arm growth around ~5kg of gain',
    deltaKg: 5,
    note: 'Track it: log your arm measurement monthly, aim for +2–3cm.',
  ),
  (
    id: 'chest-back',
    title: 'Defined chest & back',
    signal: 'chest + back thickness around ~7kg of gain',
    deltaKg: 7,
    note: 'Pressing + rowing volume is what fills these out — keep progressing '
        'the loads.',
  ),
];

/// The body-fat % where abs typically show for men.
const double kAbsBodyFatThresholdPct = 12;

/// A "soft" body-fat ceiling used to scale abs progress (25% → threshold).
const double _absSoftCeilingPct = 25;

/// Compute the physique milestones.
///
/// Weight-anchored size milestones are measured from [startKg] (the journey's
/// earliest real weight) → current, flagged [beyondGoal] when their target
/// exceeds [goalKg]. The abs milestone is body-fat-anchored: real progress ONLY
/// when [bodyFatPct] is a real reading, else [MilestoneStatus.needsData] with
/// the honest bulk-raises-BF caveat. No fabricated BF, ever.
List<PhysiqueMilestone> physiqueMilestones({
  required double startKg,
  required double currentKg,
  required double goalKg,
  double? bodyFatPct,
}) {
  final gained = currentKg - startKg;

  final weightOnes = _weightMilestones.map((m) {
    final targetWeightKg = (((startKg + m.deltaKg) * 2).round()) / 2;
    final reached = gained >= m.deltaKg;
    final beyondGoal = targetWeightKg > goalKg;
    final progressPct =
        (m.deltaKg > 0 ? gained / m.deltaKg : 1.0).clamp(0.0, 1.0);
    return PhysiqueMilestone(
      id: m.id,
      title: m.title,
      signal: m.signal,
      anchor: MilestoneAnchor.weight,
      targetWeightKg: targetWeightKg,
      beyondGoal: beyondGoal,
      progressPct: progressPct,
      status: reached ? MilestoneStatus.reached : MilestoneStatus.approaching,
      note: beyondGoal
          ? '${m.note} (This is beyond your current ${_formatKg(goalKg)}kg '
              'goal — raise your goal to aim for it.)'
          : m.note,
    );
  }).toList();

  final abs = _absMilestone(bodyFatPct);
  return [...weightOnes, abs];
}

PhysiqueMilestone _absMilestone(double? bodyFatPct) {
  const id = 'abs';
  const title = 'Visible abs';
  final signal = 'body fat below ~${kAbsBodyFatThresholdPct.round()}%';

  if (bodyFatPct == null) {
    return PhysiqueMilestone(
      id: id,
      title: title,
      signal: signal,
      anchor: MilestoneAnchor.bodyFat,
      targetBodyFatPct: kAbsBodyFatThresholdPct,
      beyondGoal: false,
      progressPct: null,
      status: MilestoneStatus.needsData,
      note: 'Abs are about body-fat %, not scale weight. Log a body-fat reading '
          'to track this — and note a bulk raises body fat, so expect this '
          'later, in a cut.',
    );
  }

  final reached = bodyFatPct <= kAbsBodyFatThresholdPct;
  final progressPct = ((_absSoftCeilingPct - bodyFatPct) /
          (_absSoftCeilingPct - kAbsBodyFatThresholdPct))
      .clamp(0.0, 1.0);
  return PhysiqueMilestone(
    id: id,
    title: title,
    signal: signal,
    anchor: MilestoneAnchor.bodyFat,
    targetBodyFatPct: kAbsBodyFatThresholdPct,
    beyondGoal: false,
    progressPct: progressPct,
    status: reached ? MilestoneStatus.reached : MilestoneStatus.approaching,
    note: reached
        ? 'At ${_formatBf(bodyFatPct)}% body fat your abs should be visible.'
        : 'At ${_formatBf(bodyFatPct)}% body fat, abs aren\'t sharp yet — and a '
            'bulk raises body fat, so plan a cut once you\'ve built the size.',
  );
}

// ── Formatting helpers (local, no feature-code dependency) ───────────────────

/// Strip a trailing `.0` so a whole kg reads as `62` not `62.0`.
String _formatKg(double kg) =>
    kg == kg.roundToDouble() ? kg.round().toString() : kg.toString();

/// Format a body-fat percentage without a spurious `.0`.
String _formatBf(double pct) =>
    pct == pct.roundToDouble() ? pct.round().toString() : pct.toString();
