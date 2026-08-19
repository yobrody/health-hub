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
  /// per exercise per session. Reset on start/finish.
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

    // Enter the rest phase for the just-logged set. Effort not yet rated → the
    // timer starts from the no-effort base and the suggestion reflects a null
    // effort until the user taps an emoji.
    _enterRestPhase(ex, nextIndex);
    _weightCtrl.clear();
    _repsCtrl.clear();
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
  /// the verdict is a genuine bump).
  void _enterRestPhase(Exercise ex, int setIndex) {
    _restTimer?.cancel();
    final start = restSecondsFor(ex.equipment, null);
    setState(() {
      _resting = true;
      _restExercise = ex;
      _restSetIndex = setIndex;
      _restRemaining = start;
    });
    _evaluateForExercise(ex);
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
      // Re-tailor the countdown to the newly-rated effort.
      _restRemaining = restSecondsFor(ex.equipment, effort);
    });
    _startRestTicker();
    _evaluateForExercise(ex);
  }

  /// Evaluate progression over the working sets of [ex] in the current session
  /// and update the suggestion. Fires confetti IFF the verdict is a genuine
  /// [ProgressionVerdict.bump] AND [ex] hasn't been celebrated this session.
  /// Returns the result (exposed for testability of the gating).
  ProgressionResult _evaluateForExercise(Exercise ex) {
    final log = _session?.exercises
        .where((e) => e.exerciseId == ex.id)
        .toList();
    final sets = (log == null || log.isEmpty) ? <SetEntry>[] : log.first.sets;

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
    return Scaffold(
      key: const Key('gym-page'),
      appBar: AppBar(
        title: const Text('Gym'),
        actions: [
          if (_session != null)
            TextButton(
              key: const Key('gym-finish-btn'),
              onPressed: _finishSession,
              child: const Text('Finish'),
            ),
        ],
      ),
      body: Stack(
        children: [
          _loading
              ? const Center(child: CircularProgressIndicator())
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
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'No workout in progress.',
            style: TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('gym-start-btn'),
            onPressed: _startSession,
            child: const Text('Start Workout'),
          ),
        ],
      ),
    );
  }

  // ── Active session view ────────────────────────────────────────────────────

  Widget _buildActiveSession() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildExercisePicker(),
        const SizedBox(height: 16),
        if (_selectedExercise != null) ...[
          // During the rest phase we swap the entry form for the rest panel so
          // the user rates the set they just did; otherwise show the form.
          if (_resting)
            _buildRestPanel()
          else
            _buildSetEntryForm(),
          const SizedBox(height: 16),
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
        Text(
          'Add Exercise',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: kExerciseCatalog.map(_buildExerciseChip).toList(),
        ),
      ],
    );
  }

  Widget _buildExerciseChip(Exercise ex) {
    final isSelected = _selectedExercise?.id == ex.id;
    return FilterChip(
      key: Key('gym-exercise-${ex.id}'),
      label: Text(ex.name),
      selected: isSelected,
      onSelected: (_) => _selectExercise(ex),
    );
  }

  // ── Set entry form ─────────────────────────────────────────────────────────

  Widget _buildSetEntryForm() {
    final ex = _selectedExercise!;
    final needsWeight = ex.equipment == EquipmentType.machine ||
        ex.equipment == EquipmentType.freeWeight;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          ex.name,
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            if (needsWeight) ...[
              Expanded(
                child: TextField(
                  key: const Key('gym-weight-field'),
                  controller: _weightCtrl,
                  decoration: InputDecoration(
                    labelText: 'Weight (kg)',
                    hintText: '—',
                    border: const OutlineInputBorder(),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    helperText: ex.equipment == EquipmentType.machine
                        ? 'Snaps to 5 kg'
                        : 'Snaps to plate',
                  ),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
              const SizedBox(width: 8),
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
              child: TextField(
                key: const Key('gym-reps-field'),
                controller: _repsCtrl,
                decoration: const InputDecoration(
                  labelText: 'Reps',
                  hintText: '—',
                  border: OutlineInputBorder(),
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
                keyboardType: TextInputType.number,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        FilledButton(
          key: const Key('gym-log-set-btn'),
          onPressed: _logSet,
          child: const Text('Log Set'),
        ),
      ],
    );
  }

  // ── Rest panel (T4) ─────────────────────────────────────────────────────────

  Widget _buildRestPanel() {
    final ex = _restExercise;
    final theme = Theme.of(context);
    return Container(
      key: const Key('gym-rest-panel'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            ex == null ? 'Rest' : 'Rest — ${ex.name}',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          // Countdown.
          Row(
            children: [
              const Icon(Icons.timer_outlined, size: 20),
              const SizedBox(width: 8),
              Text(
                key: const Key('gym-rest-timer'),
                _formatRest(_restRemaining),
                style: theme.textTheme.headlineSmall
                    ?.copyWith(fontFeatures: const []),
              ),
              const Spacer(),
              TextButton(
                key: const Key('gym-rest-skip-btn'),
                onPressed: _endRestPhase,
                child: const Text('Skip'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Effort emojis.
          Text(
            'How did that set feel?',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _EffortButton(
                key: const Key('gym-effort-easy'),
                emoji: '🙂',
                label: 'Easy',
                selected: _currentEffort() == SetEffort.easy,
                onTap: () => _rateEffort(SetEffort.easy),
              ),
              const SizedBox(width: 12),
              _EffortButton(
                key: const Key('gym-effort-contempt'),
                emoji: '😑',
                label: 'Grind',
                selected: _currentEffort() == SetEffort.contempt,
                onTap: () => _rateEffort(SetEffort.contempt),
              ),
              const SizedBox(width: 12),
              _EffortButton(
                key: const Key('gym-effort-angry'),
                emoji: '😠',
                label: 'Failed',
                selected: _currentEffort() == SetEffort.angry,
                onTap: () => _rateEffort(SetEffort.angry),
              ),
            ],
          ),
          const SizedBox(height: 12),
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

    // Honesty: only append a number when the engine actually returned one.
    // recalibrating / null → the reason alone, never a fabricated weight.
    final reason = s.reason ?? '';
    final next = s.nextWeightKg;
    final text = (next != null)
        ? '$reason · next: ${_num(next)} kg'
        : reason;

    return Row(
      children: [
        Icon(
          _iconForVerdict(s.verdict),
          size: 18,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            key: const Key('gym-next-suggestion'),
            text,
            style: Theme.of(context).textTheme.bodyMedium,
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

  // ── Confetti overlay (T4) ────────────────────────────────────────────────────

  /// A lightweight custom celebration overlay (no external package). Present in
  /// the tree ONLY when a genuine bump was just earned — the [Key] is the
  /// gating contract the tests assert against.
  Widget _buildConfetti() {
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
              padding:
                  const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Text(
                '🎉  New weight earned!',
                style: TextStyle(
                    fontSize: 18, fontWeight: FontWeight.bold),
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

  /// Format a weight without a trailing `.0`.
  String _num(double n) =>
      n == n.roundToDouble() ? n.round().toString() : '$n';

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
        Text(
          'Sets',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        ...sets.asMap().entries.map((entry) {
          final i = entry.key;
          final s = entry.value;
          return _SetRow(index: i, set: s);
        }),
      ],
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
    final theme = Theme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedScale(
        scale: selected ? 1.25 : 1.0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: selected ? 1.0 : 0.7,
          duration: const Duration(milliseconds: 200),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(emoji, style: const TextStyle(fontSize: 28)),
              const SizedBox(height: 2),
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ],
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
  const _SetRow({required this.index, required this.set});

  final int index;
  final SetEntry set;

  @override
  Widget build(BuildContext context) {
    // showOrDash handles null → '—'; a real 0 would show '0' (honest).
    final weight = showOrDash(set.weightKg != null
        ? '${set.weightKg! % 1 == 0 ? set.weightKg!.toInt() : set.weightKg} kg'
        : null);
    final reps = showOrDash(set.reps);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Text(
            'Set ${index + 1}',
            style: const TextStyle(fontWeight: FontWeight.w500),
          ),
          const SizedBox(width: 12),
          Text('$weight  ×  $reps reps'),
          if (set.effort != null)
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Text(_effortEmoji(set.effort!)),
            ),
          if (set.done)
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Icon(
                Icons.check_circle_outline,
                size: 16,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
        ],
      ),
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
