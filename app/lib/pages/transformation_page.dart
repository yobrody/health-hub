// Transformation page (P1) — ties the gym to the user's REAL goal with an
// honest projection, physique milestones, and goal-aware strength targets.
//
// Reached from the Gym via a "Transformation" card. Constructor-injected repos
// (like WeightPage/TodayPage) so widget tests drive it with in-memory fakes and
// no ProviderScope.
//
// HONESTY (load-bearing — do NOT weaken):
//  • The ROADMAP projects an ETA from the user's real weigh-in trend ONLY when
//    that trend is reliable + toward-goal; otherwise it DISCLOSES a default
//    rate ("estimated from a healthy default pace"). No current/target weight →
//    an honest needs-data card, never a fabricated date.
//  • PHYSIQUE size milestones come from real current→goal weight; the abs
//    milestone is body-fat-anchored and stays needs-data (with the honest
//    bulk-raises-BF caveat) until a real body-fat reading exists — never a
//    guessed BF. A "Log body fat" affordance lets the user add a real reading.
//  • STRENGTH targets are shown ONLY where the engine grounds a number (a
//    compound benchmark, or an isolation with real history). Ungrounded → a
//    quiet "log a set to see a target" line, never a fabricated bar.
//  • Every unknown renders via [showOrDash]; every estimate discloses its basis.

import 'package:flutter/material.dart';

import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/motion.dart';
import '../design_system/shape.dart';
import '../design_system/spacing.dart';
import '../design_system/typography.dart';
import '../gym/exercise.dart';
import '../gym/exercise_catalog.dart';
import '../gym/workout_repo.dart';
import '../gym/workout_session.dart';
import '../metrics/weigh_in.dart';
import '../metrics/weigh_in_repo.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';
import '../transformation/strength_targets.dart';
import '../transformation/transformation.dart';

/// Month names for the honest month-precision ETA ("December 2026").
const List<String> _monthNames = [
  '', // 1-indexed
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/// The Transformation screen — push it from the Gym.
class TransformationPage extends StatefulWidget {
  const TransformationPage({
    super.key,
    required this.weighInRepo,
    required this.profileRepo,
    required this.workoutRepo,
    this.now,
  });

  final WeighInRepo weighInRepo;
  final ProfileRepo profileRepo;
  final WorkoutRepo workoutRepo;

  /// Injectable clock for deterministic ETA tests. Defaults to the real now.
  final DateTime? now;

  @override
  State<TransformationPage> createState() => _TransformationPageState();
}

class _TransformationPageState extends State<TransformationPage> {
  Profile _profile = const Profile();
  List<WeighIn> _weighIns = const [];
  List<WorkoutSession> _sessions = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final profile = await widget.profileRepo.load();
    final weighIns = await widget.weighInRepo.all();
    final sessions = await widget.workoutRepo.all();
    if (!mounted) return;
    setState(() {
      _profile = profile;
      _weighIns = weighIns;
      _sessions = sessions;
      _loading = false;
    });
  }

  DateTime get _now => widget.now ?? DateTime.now();

  // ── Derived honest inputs ──────────────────────────────────────────────────

  /// The current weight, preferring the latest REAL weigh-in over the profile's
  /// stored weight (the weigh-in is the freshest real reading). `null` when
  /// neither exists — never fabricated.
  double? get _currentWeightKg {
    final real = _weighIns.where((w) => w.weightKg != null).toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    if (real.isNotEmpty) return real.last.weightKg;
    return _profile.weightKg;
  }

  /// The journey-start weight — the EARLIEST real weigh-in, else the current
  /// weight (a single point is its own baseline). `null` when nothing real.
  double? get _startWeightKg {
    final real = _weighIns.where((w) => w.weightKg != null).toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    if (real.isNotEmpty) return real.first.weightKg;
    return _profile.weightKg;
  }

  /// Adapt the real weigh-ins into the roadmap's minimal shape (non-null only).
  List<RoadmapWeighIn> get _roadmapWeighIns => _weighIns
      .where((w) => w.weightKg != null)
      .map((w) => RoadmapWeighIn(at: w.at, weightKg: w.weightKg!))
      .toList();

  /// The best (heaviest completed) weight ever logged for [exerciseId], or
  /// `null` when nothing real is logged. Derived from real set weights only —
  /// never a fabricated 0.
  double? _bestLiftFor(String exerciseId) {
    double? best;
    for (final s in _sessions) {
      for (final log in s.exercises) {
        if (log.exerciseId != exerciseId) continue;
        for (final set in log.sets) {
          final w = set.weightKg;
          if (w != null && w > 0 && (best == null || w > best)) best = w;
        }
      }
    }
    return best;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('transformation-page'),
      appBar: AppBar(
        title: const Text('Transformation'),
        centerTitle: false,
      ),
      body: _loading
          ? const SizedBox.shrink()
          : SafeArea(
              child: ListView(
                padding: AppSpacing.pagePadding,
                children: [
                  const SectionHeader(title: 'ROADMAP'),
                  _buildRoadmapCard(),
                  AppSpacing.gapV8,
                  const SectionHeader(title: 'PHYSIQUE MILESTONES'),
                  _buildMilestones(),
                  AppSpacing.gapV8,
                  const SectionHeader(title: 'STRENGTH TARGETS'),
                  _buildStrengthTargets(),
                ],
              ),
            ),
    );
  }

  // ── Roadmap ─────────────────────────────────────────────────────────────────

  Widget _buildRoadmapCard() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final roadmap = projectRoadmap(
      currentWeightKg: _currentWeightKg,
      targetWeightKg: _profile.targetWeightKg,
      weighIns: _roadmapWeighIns,
      now: _now,
    );

    // needs-data: no current OR target weight → an honest prompt, no fake date.
    if (roadmap == null) {
      return StatCard(
        key: const Key('transformation-roadmap-needsdata'),
        warm: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.flag_outlined,
                    size: 20, color: colors.primaryStrong),
                AppSpacing.gapH2,
                Expanded(
                  child: Text('Set your goal to see a roadmap',
                      style: text.titleMedium),
                ),
              ],
            ),
            AppSpacing.gapV2,
            Text(
              _currentWeightKg == null
                  ? 'Log your weight and set a goal weight, and this projects an '
                      'honest ETA from your real trend.'
                  : 'Set a goal weight on the Weight screen, and this projects an '
                      'honest ETA from your real trend.',
              style: text.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
          ],
        ),
      );
    }

    final current = _currentWeightKg;
    final target = _profile.targetWeightKg;

    return StatCard(
      key: const Key('transformation-roadmap'),
      warm: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Current → goal header.
          Row(
            children: [
              _WeightPill(
                label: 'Now',
                value: current != null ? '${formatKg(current)} kg' : '—',
              ),
              AppSpacing.gapH3,
              Icon(Icons.arrow_forward, size: 18, color: colors.textSecondary),
              AppSpacing.gapH3,
              _WeightPill(
                label: 'Goal',
                value: target != null ? '${formatKg(target)} kg' : '—',
                emphasised: true,
              ),
            ],
          ),
          AppSpacing.gapV5,
          if (roadmap.direction == RoadmapDirection.maintain) ...[
            Text('At your goal', style: text.titleMedium),
            AppSpacing.gapV1,
            Text(roadmap.note,
                key: const Key('transformation-roadmap-note'),
                style: text.bodyMedium?.copyWith(color: colors.textSecondary)),
          ] else ...[
            // The headline ETA (month precision), and the remaining delta.
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  key: const Key('transformation-roadmap-eta'),
                  _formatEtaMonth(roadmap.etaMonthIso),
                  style: AppTypography.heroNumber(
                    color: colors.textPrimary,
                    fontSize: 28,
                  ),
                ),
                AppSpacing.gapH3,
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    '~${roadmap.weeksToGoal} weeks · '
                    '${formatKg(roadmap.remainingKg)} kg to go',
                    style:
                        text.bodySmall?.copyWith(color: colors.textSecondary),
                  ),
                ),
              ],
            ),
            AppSpacing.gapV3,
            // The load-bearing DISCLOSURE: real trend vs default rate.
            _BasisChip(
              usedDefaultRate: roadmap.usedDefaultRate,
              onTrack: roadmap.onTrack,
            ),
            AppSpacing.gapV3,
            Text(
              roadmap.note,
              key: const Key('transformation-roadmap-note'),
              style: text.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
          ],
        ],
      ),
    );
  }

  String _formatEtaMonth(String? iso) {
    if (iso == null) return '—';
    final parts = iso.split('-');
    if (parts.length != 2) return '—';
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    if (year == null || month == null || month < 1 || month > 12) return '—';
    return '${_monthNames[month]} $year';
  }

  // ── Physique milestones ──────────────────────────────────────────────────────

  Widget _buildMilestones() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final start = _startWeightKg;
    final current = _currentWeightKg;
    final goal = _profile.targetWeightKg;

    // Size milestones need real start + current + goal weight to anchor. Abs is
    // body-fat-anchored and independent — but without the weight anchor there's
    // nothing honest to show as a "physique" panel yet.
    if (start == null || current == null || goal == null) {
      return StatCard(
        key: const Key('transformation-milestones-needsdata'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Milestones need your weight & goal', style: text.titleMedium),
            AppSpacing.gapV2,
            Text(
              'Log your weight and set a goal weight — then physique milestones '
              'anchor to your real numbers (abs stay body-fat-based).',
              style: text.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
          ],
        ),
      );
    }

    final milestones = physiqueMilestones(
      startKg: start,
      currentKg: current,
      goalKg: goal,
      bodyFatPct: _profile.bodyFatPercent,
    );

    return StatCard(
      key: const Key('transformation-milestones'),
      child: Column(
        children: [
          for (var i = 0; i < milestones.length; i++) ...[
            _MilestoneRow(
              milestone: milestones[i],
              onLogBodyFat: milestones[i].anchor == MilestoneAnchor.bodyFat &&
                      milestones[i].status == MilestoneStatus.needsData
                  ? _logBodyFat
                  : null,
            ),
            if (i != milestones.length - 1)
              Divider(height: 1, thickness: 1, color: colors.hairline),
          ],
        ],
      ),
    );
  }

  /// Prompt for a REAL body-fat reading and persist it, so the abs milestone can
  /// become real. A blank/invalid entry is ignored (never fabricates a value).
  Future<void> _logBodyFat() async {
    final entered = await showDialog<double>(
      context: context,
      builder: (context) => const _LogBodyFatDialog(),
    );
    if (entered == null) return;
    final updated = _profile.copyWith(bodyFatPercent: entered);
    await widget.profileRepo.save(updated);
    await _reload();
  }

  // ── Strength targets ─────────────────────────────────────────────────────────

  Widget _buildStrengthTargets() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final goal = _profile.targetWeightKg;
    // Without a goal weight there's nothing to scale a target to → honest prompt.
    if (goal == null) {
      return StatCard(
        key: const Key('transformation-strength-needsdata'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Set a goal weight for strength targets',
                style: text.titleMedium),
            AppSpacing.gapV2,
            Text(
              'Targets scale to your goal — set a goal weight and they appear '
              'per exercise (only where there\'s something honest to aim at).',
              style: text.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
          ],
        ),
      );
    }

    final rows = <Widget>[];
    for (final ex in kExerciseCatalog) {
      // Bodyweight/cardio carry no external load — no strength-weight target.
      if (ex.equipment == EquipmentType.bodyweight ||
          ex.equipment == EquipmentType.cardio) {
        continue;
      }
      final best = _bestLiftFor(ex.id);
      final target = strengthTargetFor(
        ex.name,
        goal,
        currentWeightKg: _currentWeightKg,
        currentBestKg: best,
      );
      rows.add(_StrengthRow(exercise: ex, target: target, currentBestKg: best));
    }

    return StatCard(
      key: const Key('transformation-strength'),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            rows[i],
            if (i != rows.length - 1)
              Divider(height: 1, thickness: 1, color: colors.hairline),
          ],
        ],
      ),
    );
  }
}

// ── _WeightPill ───────────────────────────────────────────────────────────────

class _WeightPill extends StatelessWidget {
  const _WeightPill({
    required this.label,
    required this.value,
    this.emphasised = false,
  });

  final String label;
  final String value;
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: text.labelSmall?.copyWith(color: colors.textSecondary)),
        AppSpacing.gapV1,
        Text(
          value,
          style: text.titleLarge?.copyWith(
            color: emphasised ? colors.primaryStrong : colors.textPrimary,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

// ── _BasisChip — the honesty disclosure ──────────────────────────────────────

/// A small chip that discloses the roadmap's projection basis:
///  • real trend (on track) → "Estimated from your trend".
///  • default rate → "Estimated from a healthy default pace".
class _BasisChip extends StatelessWidget {
  const _BasisChip({required this.usedDefaultRate, required this.onTrack});

  final bool usedDefaultRate;
  final bool onTrack;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final label = usedDefaultRate
        ? 'Estimated from a healthy default pace'
        : 'Estimated from your trend';
    final icon =
        usedDefaultRate ? Icons.info_outline : Icons.insights_outlined;
    final tone = usedDefaultRate ? colors.textSecondary : colors.accent;

    return Container(
      key: const Key('transformation-roadmap-basis'),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.space3,
        vertical: AppSpacing.space2,
      ),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: AppShape.chip,
        border: Border.all(color: colors.hairline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: tone),
          AppSpacing.gapH2,
          Flexible(
            child: Text(
              label,
              style: text.labelSmall?.copyWith(color: tone),
            ),
          ),
        ],
      ),
    );
  }
}

// ── _MilestoneRow ─────────────────────────────────────────────────────────────

class _MilestoneRow extends StatelessWidget {
  const _MilestoneRow({required this.milestone, this.onLogBodyFat});

  final PhysiqueMilestone milestone;

  /// Present only for a needs-data abs milestone — lets the user add a real BF.
  final VoidCallback? onLogBodyFat;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final m = milestone;

    final isNeedsData = m.status == MilestoneStatus.needsData;
    final isReached = m.status == MilestoneStatus.reached;

    return Padding(
      key: Key('transformation-milestone-${m.id}'),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isReached
                    ? Icons.check_circle
                    : (isNeedsData
                        ? Icons.help_outline
                        : Icons.radio_button_unchecked),
                size: 18,
                color: isReached ? colors.accent : colors.textSecondary,
              ),
              AppSpacing.gapH3,
              Expanded(child: Text(m.title, style: text.titleSmall)),
              // The target signal (weight or body-fat), honestly shown.
              Text(
                _targetLabel(m),
                style: text.labelSmall?.copyWith(color: colors.textSecondary),
              ),
            ],
          ),
          AppSpacing.gapV2,
          // Progress bar — drawn ONLY when there's a real fraction (never a
          // fabricated bar for needs-data).
          if (m.progressPct != null)
            _ProgressBar(fraction: m.progressPct!)
          else
            Text(
              'Needs a body-fat reading',
              key: Key('transformation-milestone-${m.id}-needsdata'),
              style: text.labelSmall?.copyWith(color: colors.textSecondary),
            ),
          AppSpacing.gapV2,
          Text(
            m.note,
            style: text.bodySmall?.copyWith(color: colors.textSecondary),
          ),
          if (onLogBodyFat != null) ...[
            AppSpacing.gapV1,
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: Key('transformation-milestone-${m.id}-log-bf'),
                onPressed: onLogBodyFat,
                style: TextButton.styleFrom(
                  foregroundColor: colors.primaryStrong,
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(48, 40),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Log body fat'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _targetLabel(PhysiqueMilestone m) {
    if (m.anchor == MilestoneAnchor.weight && m.targetWeightKg != null) {
      final base = '${formatKg(m.targetWeightKg!)} kg';
      return m.beyondGoal ? '$base · beyond goal' : base;
    }
    if (m.anchor == MilestoneAnchor.bodyFat && m.targetBodyFatPct != null) {
      return '≤${formatKg(m.targetBodyFatPct!)}% BF';
    }
    return '—';
  }
}

// ── _StrengthRow ──────────────────────────────────────────────────────────────

class _StrengthRow extends StatelessWidget {
  const _StrengthRow({
    required this.exercise,
    required this.target,
    required this.currentBestKg,
  });

  final Exercise exercise;

  /// `null` when there's nothing honest to ground a target on.
  final StrengthTarget? target;

  /// The user's best logged lift for this exercise, or `null`.
  final double? currentBestKg;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final t = target;

    return Padding(
      key: Key('transformation-strength-${exercise.id}'),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(exercise.name, style: text.titleSmall)),
              if (t != null)
                Text(
                  'target ${formatKg(t.targetKg)} kg',
                  style: text.labelMedium
                      ?.copyWith(color: colors.primaryStrong),
                )
              else
                Text(
                  'log a set to see a target',
                  key: Key('transformation-strength-${exercise.id}-ungrounded'),
                  style:
                      text.labelSmall?.copyWith(color: colors.textSecondary),
                ),
            ],
          ),
          // A bar is drawn ONLY when the engine grounded a target AND a real
          // current best exists (a real fraction) — never a fabricated bar.
          if (t != null && t.progressPct != null) ...[
            AppSpacing.gapV2,
            _ProgressBar(fraction: t.progressPct!),
            AppSpacing.gapV1,
            Text(
              'best ${currentBestKg != null ? formatKg(currentBestKg!) : '—'} kg'
              ' · ${t.label}',
              style: text.bodySmall?.copyWith(color: colors.textSecondary),
            ),
          ] else if (t != null) ...[
            AppSpacing.gapV1,
            Text(
              t.label,
              style: text.bodySmall?.copyWith(color: colors.textSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

// ── _ProgressBar — a calm, finite-animation fill bar ─────────────────────────

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.fraction});

  /// 0..1, clamped.
  final double fraction;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final f = fraction.clamp(0.0, 1.0);

    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: Stack(
        children: [
          Container(height: 6, color: colors.hairline),
          // A single finite grow — no repeating animation (test-friendly).
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: f),
            duration: AppMotion.slow,
            curve: AppMotion.standard,
            builder: (context, t, _) => FractionallySizedBox(
              widthFactor: t,
              child: Container(height: 6, color: colors.primary),
            ),
          ),
        ],
      ),
    );
  }
}

// ── _LogBodyFatDialog ─────────────────────────────────────────────────────────

/// A tiny dialog to enter a REAL body-fat percentage. Returns the parsed value,
/// or `null` when cancelled / left blank (never fabricates a reading).
class _LogBodyFatDialog extends StatefulWidget {
  const _LogBodyFatDialog();

  @override
  State<_LogBodyFatDialog> createState() => _LogBodyFatDialogState();
}

class _LogBodyFatDialogState extends State<_LogBodyFatDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    final parsed = double.tryParse(_controller.text.trim());
    // Only a plausible, real reading is accepted — never a fabricated 0.
    if (parsed == null || parsed <= 0 || parsed >= 70) {
      Navigator.of(context).pop();
      return;
    }
    Navigator.of(context).pop(parsed);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      key: const Key('transformation-bodyfat-dialog'),
      title: const Text('Log body fat'),
      content: TextField(
        key: const Key('transformation-bodyfat-field'),
        controller: _controller,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          labelText: 'Body fat %',
          hintText: 'e.g. 16',
        ),
        onSubmitted: (_) => _save(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('transformation-bodyfat-save'),
          onPressed: _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
