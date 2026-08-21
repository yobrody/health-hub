import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/components/progress_ring.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../design_system/typography.dart';
import '../gym/exercise_catalog.dart';
import '../gym/workout_repo.dart';
import '../gym/workout_session.dart';
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_repo.dart';
import '../onboarding/onboarding_flow.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';

/// The daily dashboard — the flagship luxury home screen.
///
/// It answers "how am I / what's next" in one calm glance: a warm greeting, a
/// weight card (current + goal), a nutrition-rings card (today's real intake),
/// and a training card (active/last session). Depth is one tap away.
///
/// **Honesty is the spine.** Every value comes from REAL data:
///  * weight/goal from the [Profile] ([profileRepoProvider]);
///  * today's calories + macros summed from the [NutritionRepo]'s logged
///    entries — planned lines and null macros never fabricate a number;
///  * the training state from the [WorkoutRepo]'s active/last session.
///
/// Anything the user hasn't provided renders as `—` ([showOrDash]) — never a
/// guessed default. There is **no macro-goal store in R1**, so the nutrition
/// rings show today's real totals with an honest "no goal set" empty state
/// rather than a fake `/2200`. There is likewise **no sleep/recovery data**, so
/// there is deliberately NO readiness card — omitted, not fabricated.
///
/// The repos default to the composition-root providers; the optional overrides
/// let widget tests inject in-memory fakes without a ProviderScope.
class TodayPage extends ConsumerStatefulWidget {
  const TodayPage({
    super.key,
    this.repo,
    this.nutritionRepo,
    this.workoutRepo,
  });

  final ProfileRepo? repo;
  final NutritionRepo? nutritionRepo;
  final WorkoutRepo? workoutRepo;

  @override
  ConsumerState<TodayPage> createState() => _TodayPageState();
}

class _TodayPageState extends ConsumerState<TodayPage> {
  late final ProfileRepo _repo = widget.repo ?? ref.read(profileRepoProvider);
  late final NutritionRepo _nutrition =
      widget.nutritionRepo ?? ref.read(nutritionRepoProvider);
  late final WorkoutRepo _workout =
      widget.workoutRepo ?? ref.read(workoutRepoProvider);

  Profile _profile = const Profile();
  _DayNutrition _today = const _DayNutrition.empty();
  WorkoutSession? _activeSession;
  WorkoutSession? _lastFinished;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final profile = await _repo.load();
    final foodLog = await _nutrition.all();
    final sessions = await _workout.all();
    if (!mounted) return;

    final todayEntries = _nutrition.logsForDay(foodLog, DateTime.now());
    setState(() {
      _profile = profile;
      _today = _DayNutrition.from(todayEntries);
      _activeSession = _findActive(sessions);
      _lastFinished = _findLastFinished(sessions);
      _loading = false;
    });
  }

  /// Latest unfinished session (mirrors [WorkoutRepo.activeSession]).
  WorkoutSession? _findActive(List<WorkoutSession> sessions) {
    for (final s in sessions.reversed) {
      if (!s.finished) return s;
    }
    return null;
  }

  /// Most recent finished session, for the "last workout" summary.
  WorkoutSession? _findLastFinished(List<WorkoutSession> sessions) {
    for (final s in sessions.reversed) {
      if (s.finished) return s;
    }
    return null;
  }

  Future<void> _openOnboarding() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OnboardingFlow(
          repo: _repo,
          onDone: () => Navigator.of(context).pop(),
        ),
      ),
    );
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      // A non-animating placeholder (not a spinner): the loads resolve almost
      // immediately, and an animated indicator would keep widget-test
      // `pumpAndSettle` from ever settling.
      return const Scaffold(
        key: Key('today-page'),
        body: SizedBox.shrink(),
      );
    }

    return Scaffold(
      key: const Key('today-page'),
      body: SafeArea(
        child: ListView(
          padding: AppSpacing.pagePadding,
          children: [
            _GreetingHeader(profile: _profile),
            AppSpacing.gapV8,

            // If the profile is empty, lead with the gentle setup affordance —
            // the honest "we show nothing we don't know" invitation.
            if (_profile.isEmpty) ...[
              _SetupProfileCard(onTap: _openOnboarding),
              AppSpacing.gapV8,
            ],

            const SectionHeader(title: 'WEIGHT'),
            _WeightCard(profile: _profile),
            AppSpacing.gapV8,

            const SectionHeader(title: 'NUTRITION'),
            _NutritionCard(today: _today),
            AppSpacing.gapV8,

            const SectionHeader(title: 'TRAINING'),
            _WorkoutCard(
              active: _activeSession,
              last: _lastFinished,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Greeting header ──────────────────────────────────────────────────────────

/// A warm, editorial greeting + today's date. Uses the profile only for the
/// time-of-day greeting (no user name field exists — so we never fabricate one).
class _GreetingHeader extends StatelessWidget {
  const _GreetingHeader({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final now = DateTime.now();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _dateLabel(now),
          style: text.labelMedium?.copyWith(
            color: colors.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        AppSpacing.gapV1,
        Text(
          _greetingFor(now),
          style: text.headlineMedium,
        ),
      ],
    );
  }

  String _greetingFor(DateTime now) {
    final h = now.hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _dateLabel(DateTime now) {
    const weekdays = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    final wd = weekdays[now.weekday - 1];
    final mo = months[now.month - 1];
    return '$wd, $mo ${now.day}'.toUpperCase();
  }
}

// ── Setup-profile card (honest empty state) ──────────────────────────────────

/// The gentle "set up your profile" affordance, shown when the profile is
/// entirely empty. Ported forward from the old page — same honesty message,
/// same [Key] so nav/first-run tests keep working.
class _SetupProfileCard extends StatelessWidget {
  const _SetupProfileCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return StatCard(
      warm: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Set up your profile', style: text.titleMedium),
          AppSpacing.gapV2,
          Text(
            'We show “—” for anything you haven’t entered — never a guessed '
            'number. Add your details to see real targets.',
            style: text.bodyMedium,
          ),
          AppSpacing.gapV4,
          FilledButton(
            key: const Key('today-setup-profile'),
            onPressed: onTap,
            child: const Text('Set up profile'),
          ),
        ],
      ),
    );
  }
}

// ── Weight card ──────────────────────────────────────────────────────────────

/// Current weight as an editorial hero number, plus goal direction and goal
/// weight. R1 has no weigh-in history (the profile carries a single [weightKg]
/// scalar), so there is honestly no trend delta to show — we omit it rather
/// than invent one. If/when a history source lands, a ▲/▼ delta slots in here.
class _WeightCard extends StatelessWidget {
  const _WeightCard({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final hasWeight = profile.weightKg != null;
    final weightStr = hasWeight ? formatKg(profile.weightKg!) : '—';

    return StatCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      weightStr,
                      style: AppTypography.heroNumber(
                        color: hasWeight
                            ? colors.textPrimary
                            : colors.textSecondary,
                        fontSize: 52,
                      ),
                    ),
                    if (hasWeight) ...[
                      AppSpacing.gapH2,
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          'kg',
                          style: text.titleMedium
                              ?.copyWith(color: colors.textSecondary),
                        ),
                      ),
                    ],
                  ],
                ),
                AppSpacing.gapV1,
                Text(
                  _subtitle(),
                  style: text.bodyMedium?.copyWith(color: colors.textSecondary),
                ),
              ],
            ),
          ),
          _GoalBadge(
            goalDirection: profile.goalDirection,
            targetWeightKg: profile.targetWeightKg,
          ),
        ],
      ),
    );
  }

  /// A quiet supporting line under the hero number.
  String _subtitle() {
    if (profile.weightKg == null) return 'Log your weight to begin';
    final dir = profile.goalDirection;
    if (dir == null) return 'Current weight';
    switch (dir) {
      case 'gain':
        return 'Building — gaining weight';
      case 'cut':
        return 'Cutting — losing weight';
      case 'maintain':
        return 'Holding steady';
      default:
        return 'Current weight';
    }
  }
}

/// The goal target chip on the weight card. Shows the goal weight, or a quiet
/// "no goal" state when unset — never a fabricated 72 kg.
class _GoalBadge extends StatelessWidget {
  const _GoalBadge({
    required this.goalDirection,
    required this.targetWeightKg,
  });

  final String? goalDirection;
  final double? targetWeightKg;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final hasGoal = targetWeightKg != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          'GOAL',
          style: text.labelSmall?.copyWith(color: colors.textSecondary),
        ),
        AppSpacing.gapV1,
        Text(
          hasGoal ? '${formatKg(targetWeightKg!)} kg' : '—',
          style: text.titleLarge?.copyWith(
            color: hasGoal ? colors.primaryStrong : colors.textSecondary,
          ),
        ),
      ],
    );
  }
}

// ── Nutrition card ───────────────────────────────────────────────────────────

/// Today's real intake as calories + protein/carbs/fat rings.
///
/// **No macro-goal store exists in R1.** So every ring here runs in its honest
/// empty state: the value is today's REAL logged total, but there is no goal to
/// fill against — the ring shows the value on a bare track, and the card says so
/// plainly. When a macro-goal source lands, pass real goals into the rings and
/// they fill automatically. A day with nothing logged shows `—`, not `0`.
class _NutritionCard extends StatelessWidget {
  const _NutritionCard({required this.today});

  final _DayNutrition today;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Calories headline — the day's real total, or a dash when nothing
          // (with real macros) has been logged.
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                today.kcal != null ? _round(today.kcal!) : '—',
                style: AppTypography.heroNumber(
                  color: today.kcal != null
                      ? colors.textPrimary
                      : colors.textSecondary,
                  fontSize: 44,
                ),
              ),
              AppSpacing.gapH2,
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  'kcal today',
                  style:
                      text.titleSmall?.copyWith(color: colors.textSecondary),
                ),
              ),
            ],
          ),
          AppSpacing.gapV5,
          // The three macro rings — no goals in R1, so honest empty-state rings.
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              ProgressRing(
                value: today.proteinG,
                goal: null, // no macro-goal store in R1 — honest empty ring
                label: 'Protein',
                unit: 'g',
                color: colors.primary,
              ),
              ProgressRing(
                value: today.carbsG,
                goal: null,
                label: 'Carbs',
                unit: 'g',
                color: colors.primaryStrong,
              ),
              ProgressRing(
                value: today.fatG,
                goal: null,
                label: 'Fat',
                unit: 'g',
                color: colors.accent,
              ),
            ],
          ),
          AppSpacing.gapV4,
          Text(
            today.isEmpty
                ? 'Nothing logged yet today.'
                : 'Tracked above — set a daily goal to see targets.',
            style: text.bodySmall,
          ),
        ],
      ),
    );
  }

  String _round(double v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(0);
}

// ── Workout card ─────────────────────────────────────────────────────────────

/// The training tile: "Workout in progress" when a session is active, else a
/// summary of the last finished session, else a calm "start a workout" prompt.
/// All from the [WorkoutRepo] — no fabricated stats.
class _WorkoutCard extends StatelessWidget {
  const _WorkoutCard({required this.active, required this.last});

  final WorkoutSession? active;
  final WorkoutSession? last;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    if (active != null) {
      final setCount = _totalSets(active!);
      return StatCard(
        warm: true,
        child: Row(
          children: [
            Icon(Icons.bolt_outlined, color: colors.primaryStrong),
            AppSpacing.gapH3,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Workout in progress', style: text.titleMedium),
                  AppSpacing.gapV1,
                  Text(
                    setCount == 0
                        ? 'Just started — pick up where you left off.'
                        : '$setCount ${setCount == 1 ? 'set' : 'sets'} logged so far.',
                    style: text.bodySmall,
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: colors.textSecondary),
          ],
        ),
      );
    }

    if (last != null) {
      final setCount = _totalSets(last!);
      final exCount = last!.exercises.length;
      return StatCard(
        child: Row(
          children: [
            Icon(Icons.fitness_center_outlined, color: colors.textSecondary),
            AppSpacing.gapH3,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Last workout', style: text.titleMedium),
                  AppSpacing.gapV1,
                  Text(
                    _lastSummary(last!, exCount, setCount),
                    style: text.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // Nothing logged — a calm invitation, never a fabricated stat.
    return StatCard(
      child: Row(
        children: [
          Icon(Icons.fitness_center_outlined, color: colors.textSecondary),
          AppSpacing.gapH3,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Start a workout', style: text.titleMedium),
                AppSpacing.gapV1,
                Text(
                  'No sessions yet — head to the gym tab to begin.',
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: colors.textSecondary),
        ],
      ),
    );
  }

  int _totalSets(WorkoutSession s) =>
      s.exercises.fold(0, (n, e) => n + e.sets.length);

  /// A one-line summary of the last session: which lifts + how much work, and a
  /// relative "when". Exercise names come from the catalog; an unknown id falls
  /// back to the raw id rather than a fabricated name.
  String _lastSummary(WorkoutSession s, int exCount, int setCount) {
    final names = s.exercises.map((e) => _exerciseName(e.exerciseId)).toList();
    final lifts = names.isEmpty
        ? 'no exercises'
        : (names.length <= 2 ? names.join(', ') : '${names.take(2).join(', ')} +${names.length - 2}');
    final when = _relativeDay(s.at);
    return '$lifts · $setCount ${setCount == 1 ? 'set' : 'sets'} · $when';
  }

  String _exerciseName(String id) {
    for (final ex in kExerciseCatalog) {
      if (ex.id == id) return ex.name;
    }
    return id; // unknown id — honest fallback, no fabricated label
  }

  String _relativeDay(DateTime at) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(at.year, at.month, at.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return 'today';
    if (diff == 1) return 'yesterday';
    return '$diff days ago';
  }
}

// ── Day-nutrition aggregate ──────────────────────────────────────────────────

/// Today's summed intake. Each total is `null` when NO logged entry contributed
/// a real value for that macro (so the UI shows `—`, never a fabricated `0`).
/// Planned meal-plan lines are excluded — an intended meal is not eaten intake.
class _DayNutrition {
  const _DayNutrition({
    this.kcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
  });

  const _DayNutrition.empty()
      : kcal = null,
        proteinG = null,
        carbsG = null,
        fatG = null;

  final double? kcal;
  final double? proteinG;
  final double? carbsG;
  final double? fatG;

  /// True when nothing with real macros has been logged today.
  bool get isEmpty =>
      kcal == null && proteinG == null && carbsG == null && fatG == null;

  /// Sum a day's [entries]. A macro total is the sum of the entries that have a
  /// real (non-null) value for it; if NONE do, the total stays `null` (honest
  /// "not tracked"), never a fabricated `0`.
  factory _DayNutrition.from(List<FoodLogEntry> entries) {
    double? kcal, protein, carbs, fat;

    void add(double? total, double? v, void Function(double) set) {
      if (v == null) return;
      set((total ?? 0) + v);
    }

    for (final e in entries) {
      add(kcal, e.kcal, (x) => kcal = x);
      add(protein, e.proteinG, (x) => protein = x);
      add(carbs, e.carbsG, (x) => carbs = x);
      add(fat, e.fatG, (x) => fat = x);
    }

    return _DayNutrition(
      kcal: kcal,
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
    );
  }
}
