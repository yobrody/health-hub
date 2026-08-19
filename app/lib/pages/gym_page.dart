// Gym page — live workout tracking (P3-T3).
//
// Replaces the placeholder with a real session surface:
//   • No active session → shows a "Start Workout" button.
//   • Active session → shows an exercise picker (from kExerciseCatalog), a
//     set-entry form (weight/reps), a "Log Set" button, and a "Finish" button.
//
// Honesty rules (load-bearing — do NOT weaken):
//   • An unset weight/reps renders as '—' (em dash), NEVER '0'.
//   • A weight entered for a machine or free-weight exercise is snapped to the
//     nearest real stack increment via [snapToStack] BEFORE being saved.
//     Bodyweight/cardio pass through unchanged.
//   • Weight field is hidden for bodyweight/cardio exercises (no external
//     load → null in the stored set, not a fabricated 0).
//
// NOT built here (YAGNI — reserved for later tasks):
//   • Progression verdict / confetti (T4).
//   • Rest timer or effort emojis (T4).
//   • Any gym-location personalization or program layer.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../gym/exercise.dart';
import '../gym/exercise_catalog.dart';
import '../gym/progression.dart';
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
      _loading = false;
    });
  }

  Future<void> _finishSession() async {
    final sid = _session?.id;
    if (sid == null) return;
    setState(() => _loading = true);
    await _repo.finishSession(sid);
    if (!mounted) return;
    setState(() {
      _session = null;
      _selectedExercise = null;
      _weightCtrl.clear();
      _repsCtrl.clear();
      _loading = false;
    });
  }

  // ── Exercise selection ─────────────────────────────────────────────────────

  void _selectExercise(Exercise ex) {
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
    final rawWeight = double.tryParse(_weightCtrl.text.trim());
    final double? snappedWeight = _snapWeightForEquipment(rawWeight, ex.equipment);

    final entry = SetEntry(
      weightKg: snappedWeight,
      reps: reps,
      done: true,
    );

    // Determine which set index to use (append to existing sets for this exercise).
    final session = _session!;
    final exLog = session.exercises
        .where((e) => e.exerciseId == ex.id)
        .toList();
    final nextIndex = exLog.isEmpty ? 0 : exLog.first.sets.length;

    await _repo.saveSet(sid, ex.id, nextIndex, entry);

    // Reload to reflect the persisted state.
    if (!mounted) return;
    final updated = await _repo.activeSession();
    if (!mounted) return;
    setState(() {
      _session = updated;
      _weightCtrl.clear();
      _repsCtrl.clear();
    });
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
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _session == null
              ? _buildNoSession()
              : _buildActiveSession(),
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
                  keyboardType: const TextInputType.numberWithOptions(
                      decimal: true),
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

  // ── Logged sets for the selected exercise ──────────────────────────────────

  Widget _buildLoggedSets() {
    final ex = _selectedExercise;
    if (ex == null) return const SizedBox.shrink();

    final session = _session;
    if (session == null) return const SizedBox.shrink();

    final logEntry = session.exercises
        .where((e) => e.exerciseId == ex.id)
        .toList();
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
}
