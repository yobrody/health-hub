// Gym page — live workout tracking (P3-T3 + P3-T4).
//
// T3 surface: start session, exercise picker (kExerciseCatalog), set-entry
// form (weight/reps), Log Set, Finish, logged-set list.
//
// T4 additions (this file):
//   • After logging a set the page enters a "rest" phase for that set:
//     – a tailored countdown rest timer (restSecondsFor) with a Skip button;
//     – three OPTIONAL effort emojis (easy / contempt / angry), each with a
//       little tap animation, that record SetEffort onto the just-logged set;
//     – a next-weight suggestion line from the progression engine;
//     – confetti ONLY on a genuine earned `bump` verdict, at most once per
//       exercise per session.
//
// Honesty rules (load-bearing — do NOT weaken):
//   • An unset weight/reps renders as '—' (em dash), NEVER '0'.
//   • A machine/free-weight is snapped via [snapToStack] BEFORE being saved;
//     bodyweight/cardio pass through as null (no fabricated 0).
//   • Confetti fires IFF the engine returns [ProgressionVerdict.bump] — a
//     topped-but-soft set the engine rules hold/deload/recalibrating gets NONE.
//     (This is the exact old-app bug this task exists to prevent.)
//   • The next-weight number is whatever the engine returns; recalibrating /
//     null → the reason is shown WITHOUT a fabricated number.
//   • A set stays effort == null until the user taps an emoji (the emoji is
//     optional; skipping rest is allowed).

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/motion.dart';
import '../design_system/shape.dart';
import '../design_system/spacing.dart';
import '../design_system/typography.dart';
import '../gym/exercise.dart';
import '../gym/exercise_catalog.dart';
import '../gym/progression.dart';
import '../gym/rest_timer.dart';
import '../gym/workout_repo.dart';
import '../gym/workout_session.dart';
import '../profile/profile_model.dart'; // showOrDash

// ── GymPage ───────────────────────────────────────────────────────────────────

class GymPage extends ConsumerStatefulWidget {
  const GymPage({super.key});

  @override
  GymPageState createState() => GymPageState();
}

class GymPageState extends ConsumerState<GymPage> {
  // ── State ──────────────────────────────────────────────────────────────────

  /// The current active (unfinished) session, or `null` when none is in
  /// progress.
  WorkoutSession? _session;

  /// The exercise currently selected for set entry. `null` while no exercise
  /// has been picked in this session.
  Exercise? _selectedExercise;

  // ── Rest / effort / progression state (T4) ─────────────────────────────────

  /// True while the just-logged set is in its rest phase (timer + effort +
  /// suggestion shown instead of the entry form). Cleared by Skip / finish.
  bool _resting = false;

  /// The exercise the rest phase belongs to (the one whose set was just
  /// logged) — progression is evaluated over ITS working sets.
  Exercise? _restExercise;

  /// The set index (within [_restExercise]'s log) that the effort emojis rate.
  int _restSetIndex = -1;

  /// Seconds left on the rest countdown.
  int _restRemaining = 0;

  /// The live rest countdown timer. Cancelled in [dispose] and on phase end.
  Timer? _restTimer;

  /// The latest progression evaluation for the resting exercise (drives the
  /// suggestion line + whether confetti shows).
  ProgressionResult? _suggestion;

  /// Whether the confetti overlay is currently shown (a genuine bump was just
  /// earned for an as-yet-uncelebrated exercise).
  bool _showConfetti = false;

  /// Exercise ids already celebrated THIS session — confetti fires at most once
  /// per exercise per session. Reset on start/finish only — deliberately NOT on
  /// exercise switch, since the per-session dedup spans all exercises.
  final Set<String> _celebrated = <String>{};

  // ── Controllers ────────────────────────────────────────────────────────────

  final _weightCtrl = TextEditingController();
  final _repsCtrl = TextEditingController();

  bool _loading = true;

  // ── Providers ──────────────────────────────────────────────────────────────

  WorkoutRepo get _repo => ref.read(workoutRepoProvider);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _restTimer?.cancel();
    _weightCtrl.dispose();
    _repsCtrl.dispose();
    super.dispose();
  }

  // ── Reload ─────────────────────────────────────────────────────────────────

  Future<void> _reload() async {
    final active = await _repo.activeSession();
    if (!mounted) return;
    setState(() {
      _session = active;
      _loading = false;
    });
  }

  // ── Session actions ────────────────────────────────────────────────────────

  Future<void> _startSession() async {
    setState(() => _loading = true);
    final session = await _repo.startSession();
    if (!mounted) return;
    setState(() {
      _session = session;
      _selectedExercise = null;
      _celebrated.clear();
      _loading = false;
    });
    _endRestPhase();
  }

  Future<void> _finishSession() async {
    final sid = _session?.id;
    if (sid == null) return;
    _endRestPhase();
    setState(() => _loading = true);
    await _repo.finishSession(sid);
    if (!mounted) return;
    setState(() {
      _session = null;
      _selectedExercise = null;
      _celebrated.clear();
      _weightCtrl.clear();
      _repsCtrl.clear();
      _loading = false;
    });
  }

  // ── Exercise selection ─────────────────────────────────────────────────────

  void _selectExercise(Exercise ex) {
    _endRestPhase();
    setState(() {
      _selectedExercise = ex;
      _weightCtrl.clear();
      _repsCtrl.clear();
    });
  }

  // ── Log a set ──────────────────────────────────────────────────────────────

  Future<void> _logSet() async {
    final sid = _session?.id;
    final ex = _selectedExercise;
    if (sid == null || ex == null) return;

    final reps = int.tryParse(_repsCtrl.text.trim());
    if (reps == null) return;

    // Weight: parse if entered; bodyweight/cardio have no external load (null).
    // A parsed value of ≤0 is NOT a real weight — no stack has a 0 kg notch and
    // a genuine no-external-load lift is a bodyweight movement, not "0 kg on a
    // machine". Treat ≤0 as "no weight entered" → null (never a fabricated 0.0).
    final parsed = double.tryParse(_weightCtrl.text.trim());
    final rawWeight = (parsed != null && parsed > 0) ? parsed : null;
    final double? snappedWeight =
        _snapWeightForEquipment(rawWeight, ex.equipment);

    final entry = SetEntry(
      weightKg: snappedWeight,
      reps: reps,
      done: true,
    );

    // Reload the PERSISTED session to compute the next set index — never the
    // stale in-memory _session. Two rapid "Log Set" taps both reading _session
    // would compute nextIndex = 0 twice and the second save would overwrite the
    // first (violating "never lose a logged set").
    final persisted = await _repo.activeSession();
    if (!mounted) return;
    final exLog =
        persisted?.exercises.where((e) => e.exerciseId == ex.id).toList() ?? [];
    final nextIndex = exLog.isEmpty ? 0 : exLog.first.sets.length;

    await _repo.saveSet(sid, ex.id, nextIndex, entry);

    // Reload to reflect the persisted state.
    if (!mounted) return;
    final updated = await _repo.activeSession();
    if (!mounted) return;
    setState(() {
      _session = updated;
    });
    _weightCtrl.clear();
    _repsCtrl.clear();

    // Enter the rest phase for the just-logged set. Effort not yet rated → the
    // timer starts from the no-effort base and the suggestion reflects a null
    // effort until the user taps an emoji. Pass the freshly-reloaded session so
    // progression evaluates the just-persisted set, never a stale field.
    if (updated != null) _enterRestPhase(ex, nextIndex, updated);
  }

  /// Snap a raw weight to the equipment's real stack increment.
  ///  • machine / freeWeight → [snapToStack].
  ///  • bodyweight / cardio → no external weight → null (never fabricated).
  ///  • rawWeight == null → null (user left the field blank).
  double? _snapWeightForEquipment(double? rawWeight, EquipmentType equipment) {
    switch (equipment) {
      case EquipmentType.bodyweight:
      case EquipmentType.cardio:
        return null; // No external load — honest null.
      case EquipmentType.machine:
      case EquipmentType.freeWeight:
        if (rawWeight == null) return null;
        return snapToStack(rawWeight, equipment);
    }
  }

  // ── Rest phase (T4) ─────────────────────────────────────────────────────────

  /// Enter the rest phase for [ex]'s set at [setIndex]. Starts the countdown at
  /// the no-effort base rest and evaluates progression (which fires confetti if
  /// the verdict is a genuine bump). [session] is the freshly-reloaded session
  /// the just-logged set lives in — passed explicitly so the honesty-critical
  /// evaluation never reads a possibly-stale field.
  void _enterRestPhase(Exercise ex, int setIndex, WorkoutSession session) {
    _restTimer?.cancel();
    final start = restSecondsFor(ex.equipment, null);
    setState(() {
      _resting = true;
      _restExercise = ex;
      _restSetIndex = setIndex;
      _restRemaining = start;
    });
    _evaluateForExercise(ex, session);
    _startRestTicker();
  }

  void _startRestTicker() {
    _restTimer?.cancel();
    _restTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_restRemaining <= 1) {
        timer.cancel();
        setState(() => _restRemaining = 0);
      } else {
        setState(() => _restRemaining -= 1);
      }
    });
  }

  /// End the rest phase, cancel the countdown, and clear the transient
  /// suggestion/confetti. The logged set (and any rated effort) persists.
  void _endRestPhase() {
    _restTimer?.cancel();
    _restTimer = null;
    if (!_resting && !_showConfetti && _suggestion == null) return;
    setState(() {
      _resting = false;
      _restExercise = null;
      _restSetIndex = -1;
      _restRemaining = 0;
      _suggestion = null;
      _showConfetti = false;
    });
  }

  /// Record [effort] onto the just-logged set, then re-tailor the rest timer,
  /// re-evaluate progression, and update the suggestion + confetti.
  Future<void> _rateEffort(SetEffort effort) async {
    final sid = _session?.id;
    final ex = _restExercise;
    final idx = _restSetIndex;
    if (sid == null || ex == null || idx < 0) return;

    // Read the just-logged set from the persisted session and re-save it at the
    // SAME index with the chosen effort (copyWith preserves weight/reps/done).
    final persisted = await _repo.activeSession();
    if (!mounted) return;
    final log = persisted?.exercises
        .where((e) => e.exerciseId == ex.id)
        .toList();
    if (log == null || log.isEmpty || idx >= log.first.sets.length) return;
    final lastSet = log.first.sets[idx];

    await _repo.saveSet(sid, ex.id, idx, lastSet.copyWith(effort: effort));

    final updated = await _repo.activeSession();
    if (!mounted) return;
    setState(() {
      _session = updated;
      // Re-tailor the countdown to the newly-rated effort. Intentionally resets
      // to the FULL re-tailored duration (not the remaining time): the rating
      // changes the honest rest recommendation, so we honour the new number.
      _restRemaining = restSecondsFor(ex.equipment, effort);
    });
    _startRestTicker();
    // Pass the freshly-reloaded session so the (honesty-critical) evaluation
    // sees the effort just recorded — never a stale field.
    if (updated != null) _evaluateForExercise(ex, updated);
  }

  /// Evaluate progression over the working sets of [ex] in [session] and update
  /// the suggestion. Fires confetti IFF the verdict is a genuine
  /// [ProgressionVerdict.bump] AND [ex] hasn't been celebrated this session.
  /// Returns the result (exposed for testability of the gating).
  ///
  /// Takes [session] explicitly rather than reading the [_session] field: this
  /// is the honesty-critical path, so the caller passes the FRESHLY-reloaded
  /// session (post-save, post-effort) — never a possibly-stale field — so a
  /// future reorder can't evaluate pre-effort sets and mis-fire a bump.
  ProgressionResult _evaluateForExercise(Exercise ex, WorkoutSession session) {
    final log =
        session.exercises.where((e) => e.exerciseId == ex.id).toList();
    final sets = log.isEmpty ? <SetEntry>[] : log.first.sets;

    final result = evaluateProgression(
      sets: sets,
      repTargetLow: kDefaultRepTargetLow,
      repTargetHigh: kDefaultRepTargetHigh,
      equipment: ex.equipment,
    );

    final earned = result.verdict == ProgressionVerdict.bump;
    final celebrate = earned && !_celebrated.contains(ex.id);
    if (celebrate) _celebrated.add(ex.id);

    setState(() {
      _suggestion = result;
      // NEVER show confetti for hold/deload/recalibrating — only a real bump,
      // and only the first time for this exercise this session.
      _showConfetti = celebrate;
    });
    return result;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      key: const Key('gym-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'Training',
          style: text.titleLarge?.copyWith(color: colors.textPrimary),
        ),
        actions: [
          if (_session != null)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.space4),
              child: TextButton(
                key: const Key('gym-finish-btn'),
                onPressed: _finishSession,
                style: TextButton.styleFrom(
                  foregroundColor: colors.primaryStrong,
                  textStyle: text.labelLarge,
                ),
                child: const Text('Finish'),
              ),
            ),
        ],
      ),
      body: Stack(
        children: [
          _loading
              ? const Center(child: SizedBox.shrink())
              : _session == null
                  ? _buildNoSession()
                  : _buildActiveSession(),
          if (_showConfetti) _buildConfetti(),
        ],
      ),
    );
  }

  // ── No session view ────────────────────────────────────────────────────────

  Widget _buildNoSession() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    // First-run gate (R-1) — NON-BLOCKING: "Create" leads straight into the
    // existing start-session flow (so the app stays fully usable); "Upload" is
    // an honest STUB for importing a saved workout (photo/file → R-2). Once a
    // session exists, the normal active-session UI shows instead.
    return Center(
      child: Padding(
        padding: AppSpacing.pagePadding,
        child: StatCard(
          key: const Key('gym-gate'),
          warm: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.fitness_center_outlined,
                color: colors.primaryStrong,
                size: 32,
              ),
              AppSpacing.gapV4,
              Text('Create or upload a workout to begin',
                  style: text.headlineSmall),
              AppSpacing.gapV2,
              Text(
                'Start a session to log exercises, sets, and track progression '
                '— or import a workout you already have.',
                style: text.bodyMedium?.copyWith(color: colors.textSecondary),
              ),
              AppSpacing.gapV6,
              // Create → the real start-session flow. Carries BOTH the gate key
              // ('gym-gate-create') and the long-standing 'gym-start-btn' key so
              // every existing gym test keeps working.
              SizedBox(
                key: const Key('gym-gate-create'),
                width: double.infinity,
                child: FilledButton(
                  key: const Key('gym-start-btn'),
                  onPressed: _startSession,
                  style: FilledButton.styleFrom(
                    backgroundColor: colors.primary,
                    foregroundColor: colors.textPrimary,
                    shape: AppShape.buttonBorder,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.space6,
                      vertical: AppSpacing.space3,
                    ),
                    textStyle: text.labelLarge,
                  ),
                  child: const Text('Create workout'),
                ),
              ),
              AppSpacing.gapV2,
              // Upload → an honest STUB (import is R-2); never fabricates data.
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  key: const Key('gym-gate-upload'),
                  onPressed: _uploadWorkoutStub,
                  style: OutlinedButton.styleFrom(
                    shape: AppShape.buttonBorder,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.space6,
                      vertical: AppSpacing.space3,
                    ),
                    textStyle: text.labelLarge,
                  ),
                  child: const Text('Upload workout'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The workout-import path is a STUB in R-1 (photo/file import is R-2). Honest
  /// about it: shows a "coming soon" message and never fabricates a workout.
  void _uploadWorkoutStub() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        key: Key('gym-gate-upload-snackbar'),
        content: Text(
          'Workout import is coming soon — tap Create to start one now.',
        ),
      ),
    );
  }

  // ── Active session view ────────────────────────────────────────────────────

  Widget _buildActiveSession() {
    return ListView(
      padding: AppSpacing.pagePadding,
      children: [
        _buildExercisePicker(),
        AppSpacing.gapV6,
        if (_selectedExercise != null) ...[
          // During the rest phase we swap the entry form for the rest panel so
          // the user rates the set they just did; otherwise show the form.
          if (_resting)
            _buildRestPanel()
          else
            _buildSetEntryForm(),
          AppSpacing.gapV6,
          _buildLoggedSets(),
        ],
      ],
    );
  }

  // ── Exercise picker ────────────────────────────────────────────────────────

  Widget _buildExercisePicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'EXERCISE'),
        Wrap(
          spacing: AppSpacing.space2,
          runSpacing: AppSpacing.space2,
          children: kExerciseCatalog.map(_buildExerciseChip).toList(),
        ),
      ],
    );
  }

  Widget _buildExerciseChip(Exercise ex) {
    final isSelected = _selectedExercise?.id == ex.id;
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final brightness = Theme.of(context).brightness;

    // Semantics: expose each chip as a selectable button so assistive
    // technology announces the exercise name and its selection state.
    return Semantics(
      button: true,
      selected: isSelected,
      label: ex.name,
      child: GestureDetector(
        onTap: () => _selectExercise(ex),
        child: AnimatedContainer(
          key: Key('gym-exercise-${ex.id}'),
          duration: AppMotion.fast,
          curve: AppMotion.standard,
          // Minimum 48 logical-px height satisfies the touch-target guideline.
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.space4,
            vertical: AppSpacing.space2,
          ),
          decoration: BoxDecoration(
            color: isSelected ? colors.primary : colors.surface,
            borderRadius: AppShape.chip,
            border: Border.all(
              color: isSelected ? colors.primary : colors.hairline,
            ),
            boxShadow: isSelected ? [] : AppShape.cardShadow(brightness),
          ),
          child: Text(
            ex.name,
            style: text.labelMedium?.copyWith(
              color: isSelected ? colors.textPrimary : colors.textSecondary,
              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }

  // ── Set entry form ─────────────────────────────────────────────────────────

  Widget _buildSetEntryForm() {
    final ex = _selectedExercise!;
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final needsWeight = ex.equipment == EquipmentType.machine ||
        ex.equipment == EquipmentType.freeWeight;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(ex.name, style: text.titleMedium),
          AppSpacing.gapV1,
          Text(
            needsWeight
                ? (ex.equipment == EquipmentType.machine
                    ? 'Machine — snaps to 5 kg'
                    : 'Free weight — snaps to plate')
                : 'Bodyweight',
            style: text.bodySmall,
          ),
          AppSpacing.gapV5,
          Row(
            children: [
              if (needsWeight) ...[
                Expanded(
                  child: _LuxuryField(
                    fieldKey: const Key('gym-weight-field'),
                    controller: _weightCtrl,
                    label: 'Weight (kg)',
                    hint: '—',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    colors: colors,
                    text: text,
                  ),
                ),
                AppSpacing.gapH3,
              ] else
                // For bodyweight/cardio: no external load — the weight field is
                // present in the tree (so tests can find it) but zero-sized so
                // it doesn't affect layout.
                SizedBox(
                  width: 0,
                  height: 0,
                  child: TextField(
                    key: const Key('gym-weight-field'),
                    controller: _weightCtrl,
                  ),
                ),
              Expanded(
                child: _LuxuryField(
                  fieldKey: const Key('gym-reps-field'),
                  controller: _repsCtrl,
                  label: 'Reps',
                  hint: '—',
                  keyboardType: TextInputType.number,
                  colors: colors,
                  text: text,
                ),
              ),
            ],
          ),
          AppSpacing.gapV5,
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              key: const Key('gym-log-set-btn'),
              onPressed: _logSet,
              style: FilledButton.styleFrom(
                backgroundColor: colors.primary,
                foregroundColor: colors.textPrimary,
                shape: AppShape.buttonBorder,
                padding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.space3,
                ),
                textStyle: text.labelLarge,
              ),
              child: const Text('Log Set'),
            ),
          ),
        ],
      ),
    );
  }

  // ── Rest panel (T4) ─────────────────────────────────────────────────────────

  Widget _buildRestPanel() {
    final ex = _restExercise;
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      key: const Key('gym-rest-panel'),
      warm: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.timer_outlined, size: 18, color: colors.primaryStrong),
              AppSpacing.gapH2,
              Expanded(
                child: Text(
                  ex == null ? 'Rest' : 'Rest — ${ex.name}',
                  style: text.titleMedium,
                ),
              ),
              TextButton(
                key: const Key('gym-rest-skip-btn'),
                onPressed: _endRestPhase,
                style: TextButton.styleFrom(
                  foregroundColor: colors.textSecondary,
                  textStyle: text.labelMedium,
                  // 48×48 minimum touch target (accessibility requirement).
                  minimumSize: const Size(48, 48),
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.space2,
                  ),
                ),
                child: const Text('Skip'),
              ),
            ],
          ),
          AppSpacing.gapV4,
          // Countdown — editorial serif number, confident and calm.
          Center(
            child: Text(
              key: const Key('gym-rest-timer'),
              _formatRest(_restRemaining),
              style: AppTypography.heroNumber(
                color: colors.textPrimary,
                fontSize: 56,
              ),
            ),
          ),
          AppSpacing.gapV5,
          // Effort emojis.
          Text(
            'How did that feel?',
            style: text.bodySmall?.copyWith(color: colors.textSecondary),
          ),
          AppSpacing.gapV3,
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _EffortButton(
                key: const Key('gym-effort-easy'),
                emoji: '🙂',
                label: 'Easy',
                selected: _currentEffort() == SetEffort.easy,
                onTap: () => _rateEffort(SetEffort.easy),
              ),
              AppSpacing.gapH6,
              _EffortButton(
                key: const Key('gym-effort-contempt'),
                emoji: '😑',
                label: 'Grind',
                selected: _currentEffort() == SetEffort.contempt,
                onTap: () => _rateEffort(SetEffort.contempt),
              ),
              AppSpacing.gapH6,
              _EffortButton(
                key: const Key('gym-effort-angry'),
                emoji: '😠',
                label: 'Failed',
                selected: _currentEffort() == SetEffort.angry,
                onTap: () => _rateEffort(SetEffort.angry),
              ),
            ],
          ),
          AppSpacing.gapV4,
          _buildSuggestion(),
        ],
      ),
    );
  }

  /// The effort currently rated on the resting set (for highlighting the emoji).
  SetEffort? _currentEffort() {
    final ex = _restExercise;
    final idx = _restSetIndex;
    if (ex == null || idx < 0) return null;
    final log = _session?.exercises
        .where((e) => e.exerciseId == ex.id)
        .toList();
    if (log == null || log.isEmpty || idx >= log.first.sets.length) return null;
    return log.first.sets[idx].effort;
  }

  Widget _buildSuggestion() {
    final s = _suggestion;
    if (s == null) return const SizedBox.shrink();
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    // Honesty: only append a number when the engine actually returned one.
    // recalibrating / null → the reason alone, never a fabricated weight.
    // Join present parts with " · " so there's never a leading/trailing
    // separator when one part is absent.
    final parts = <String>[
      if (s.reason != null && s.reason!.trim().isNotEmpty) s.reason!.trim(),
      if (s.nextWeightKg != null) 'next: ${formatKg(s.nextWeightKg!)} kg',
    ];
    final label = parts.join(' · ');

    return Row(
      children: [
        Icon(
          _iconForVerdict(s.verdict),
          size: 18,
          color: _colorForVerdict(s.verdict, colors),
        ),
        AppSpacing.gapH2,
        Expanded(
          child: Text(
            key: const Key('gym-next-suggestion'),
            label,
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
        ),
      ],
    );
  }

  IconData _iconForVerdict(ProgressionVerdict v) {
    switch (v) {
      case ProgressionVerdict.bump:
        return Icons.trending_up;
      case ProgressionVerdict.hold:
        return Icons.trending_flat;
      case ProgressionVerdict.deload:
        return Icons.trending_down;
      case ProgressionVerdict.recalibrating:
        return Icons.help_outline;
    }
  }

  Color _colorForVerdict(ProgressionVerdict v, AppColors colors) {
    switch (v) {
      case ProgressionVerdict.bump:
        return colors.accent;
      case ProgressionVerdict.hold:
        return colors.textSecondary;
      case ProgressionVerdict.deload:
        return colors.primaryStrong;
      case ProgressionVerdict.recalibrating:
        return colors.textSecondary;
    }
  }

  // ── Confetti overlay (T4) ────────────────────────────────────────────────────

  /// A lightweight custom celebration overlay (no external package). Present in
  /// the tree ONLY when a genuine bump was just earned — the [Key] is the
  /// gating contract the tests assert against.
  Widget _buildConfetti() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Positioned.fill(
      child: IgnorePointer(
        child: Center(
          child: TweenAnimationBuilder<double>(
            key: const Key('gym-confetti'),
            tween: Tween(begin: 0.6, end: 1.0),
            duration: const Duration(milliseconds: 400),
            curve: Curves.elasticOut,
            builder: (context, scale, child) => Transform.scale(
              scale: scale,
              child: child,
            ),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.space6,
                vertical: AppSpacing.space4,
              ),
              decoration: BoxDecoration(
                color: colors.surfaceWarm,
                borderRadius: AppShape.card,
                boxShadow: AppShape.raisedShadow(
                    Theme.of(context).brightness),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('🎉', style: TextStyle(fontSize: 22)),
                  AppSpacing.gapH3,
                  Text(
                    'New weight earned!',
                    style: text.titleSmall?.copyWith(
                      color: colors.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _formatRest(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  // ── Logged sets for the selected exercise ──────────────────────────────────

  Widget _buildLoggedSets() {
    final ex = _selectedExercise;
    if (ex == null) return const SizedBox.shrink();

    final session = _session;
    if (session == null) return const SizedBox.shrink();

    final logEntry =
        session.exercises.where((e) => e.exerciseId == ex.id).toList();
    if (logEntry.isEmpty) return const SizedBox.shrink();

    final sets = logEntry.first.sets;
    if (sets.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'SETS'),
        StatCard(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.cardPadding,
            vertical: AppSpacing.space3,
          ),
          child: Column(
            children: sets.asMap().entries.map((entry) {
              final i = entry.key;
              final s = entry.value;
              return _SetRow(index: i, set: s, isLast: i == sets.length - 1);
            }).toList(),
          ),
        ),
      ],
    );
  }
}

// ── _LuxuryField ──────────────────────────────────────────────────────────────

/// A text field styled to the luxury design system: warm rounded outline,
/// Fraunces-style label handling, tokenised padding.
class _LuxuryField extends StatelessWidget {
  const _LuxuryField({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.hint,
    required this.keyboardType,
    required this.colors,
    required this.text,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final String hint;
  final TextInputType keyboardType;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      keyboardType: keyboardType,
      style: text.bodyLarge?.copyWith(color: colors.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: text.bodySmall?.copyWith(color: colors.textSecondary),
        hintStyle: text.bodyLarge?.copyWith(color: colors.textSecondary),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.primary, width: 1.5),
        ),
        filled: true,
        fillColor: colors.canvas,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space4,
          vertical: AppSpacing.space3,
        ),
      ),
    );
  }
}

// ── _EffortButton ─────────────────────────────────────────────────────────────

/// One effort emoji with a little scale/fade animation when selected. Tapping
/// records the effort onto the just-logged set (via the parent's onTap).
class _EffortButton extends StatelessWidget {
  const _EffortButton({
    super.key,
    required this.emoji,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String emoji;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    // Semantics: expose the effort button as a toggleable button with a
    // plain-text label (the emoji alone is not accessible to screen readers).
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: GestureDetector(
        onTap: onTap,
        // opaque hit behaviour so the entire bounding box is tappable even
        // when the emoji + label column is narrower than 48 px.
        behavior: HitTestBehavior.opaque,
        child: Padding(
          // Ensure at least 48×48 logical-px touch target while keeping the
          // layout flexible (Padding expands the hit area without a fixed SizedBox
          // that can overflow when the parent Row is constrained).
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.space2,
            vertical: AppSpacing.space2,
          ),
          child: AnimatedScale(
            scale: selected ? 1.25 : 1.0,
            duration: AppMotion.fast,
            curve: AppMotion.spring,
            child: AnimatedOpacity(
              opacity: selected ? 1.0 : 0.5,
              duration: AppMotion.fast,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Mark emoji as decorative — the Semantics label above
                  // already provides the accessible name.
                  ExcludeSemantics(
                    child: Text(emoji, style: const TextStyle(fontSize: 28)),
                  ),
                  AppSpacing.gapV1,
                  Text(
                    label,
                    style: text.labelSmall?.copyWith(
                      color:
                          selected ? colors.textPrimary : colors.textSecondary,
                      fontWeight:
                          selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ── _SetRow ───────────────────────────────────────────────────────────────────

/// One logged set row. Displays weight and reps with '—' for null values
/// (honesty rule: NEVER show '0' for an unset value).
class _SetRow extends StatelessWidget {
  const _SetRow({
    required this.index,
    required this.set,
    this.isLast = false,
  });

  final int index;
  final SetEntry set;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    // showOrDash handles null → '—'; a real 0 would show '0' (honest).
    final weight = showOrDash(
        set.weightKg != null ? '${formatKg(set.weightKg!)} kg' : null);
    final reps = showOrDash(set.reps);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
          child: Row(
            children: [
              Text(
                'Set ${index + 1}',
                style: text.labelMedium?.copyWith(color: colors.textSecondary),
              ),
              AppSpacing.gapH4,
              Expanded(
                child: Text(
                  '$weight  ×  $reps reps',
                  style: text.bodyMedium?.copyWith(color: colors.textPrimary),
                ),
              ),
              if (set.effort != null)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.space2),
                  child: Text(
                    _effortEmoji(set.effort!),
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
              if (set.done)
                Icon(
                  Icons.check_circle_outline,
                  size: 16,
                  color: colors.accent,
                ),
            ],
          ),
        ),
        if (!isLast)
          Divider(height: 1, thickness: 1, color: colors.hairline),
      ],
    );
  }

  String _effortEmoji(SetEffort e) {
    switch (e) {
      case SetEffort.easy:
        return '🙂';
      case SetEffort.contempt:
        return '😑';
      case SetEffort.angry:
        return '😠';
    }
  }
}
