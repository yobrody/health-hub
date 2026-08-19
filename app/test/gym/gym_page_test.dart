// Widget tests for GymPage (P3-T3) — live workout logging.
//
// Tests the live workout surface: start a session, add an exercise, log a set
// (with honest snapping), mark done, finish. All assertions run against the
// in-memory fake store — no device, no network.
//
// Honesty invariants under test:
//  • An unset weight/reps renders as '—', never '0'.
//  • A machine weight entered by the user is snapped via snapToStack before
//    being saved — no impossible in-between notch is stored.
//  • A free-weight is similarly snapped.
//  • Finishing a session sets finished == true in the store.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/gym/exercise.dart';
import 'package:health_hub/gym/exercise_catalog.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/gym_page.dart';

// ── Fake stores (in-memory) ───────────────────────────────────────────────────

class _FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> _sessions = [];

  @override
  Future<List<WorkoutSession>> load() async =>
      List.unmodifiable(_sessions);

  @override
  Future<void> save(List<WorkoutSession> sessions) async {
    _sessions = List.of(sessions);
  }
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

// ── Helper: build the page in a ProviderScope with in-memory fakes ─────────

Widget _buildPage(WorkoutRepo repo) {
  return ProviderScope(
    overrides: [
      workoutRepoProvider.overrideWithValue(repo),
    ],
    child: const MaterialApp(home: GymPage()),
  );
}

WorkoutRepo _makeRepo(_FakeWorkoutStore store) {
  final outbox = Outbox(_FakeOutboxStore());
  return WorkoutRepo(outbox: outbox, store: store);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  group('GymPage', () {
    // ── Smoke ──────────────────────────────────────────────────────────────

    testWidgets('renders with Key gym-page', (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();
      expect(find.byKey(const Key('gym-page')), findsOneWidget);
    });

    // ── Start session ──────────────────────────────────────────────────────

    testWidgets('start button creates a session and shows exercise picker',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      // No active session → shows start button.
      expect(find.byKey(const Key('gym-start-btn')), findsOneWidget);

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // A session now exists in the store.
      final all = await repo.all();
      expect(all, hasLength(1));
      expect(all.first.finished, isFalse);
    });

    // ── Log a set → persists with correct (snapped) weight ────────────────

    testWidgets('start → add exercise → log set → set persists in store',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      // Start session.
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Pick the first exercise from the catalog list.
      final firstExercise = kExerciseCatalog.first;
      await tester.tap(find.byKey(Key('gym-exercise-${firstExercise.id}')));
      await tester.pumpAndSettle();

      // Fill weight and reps.
      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '60');
      await tester.enterText(
          find.byKey(const Key('gym-reps-field')), '8');

      // Tap "Log Set".
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pumpAndSettle();

      // Assert store holds the set.
      final all = await repo.all();
      expect(all, hasLength(1));
      final session = all.first;
      expect(session.exercises, hasLength(1));
      final log = session.exercises.first;
      expect(log.exerciseId, firstExercise.id);
      expect(log.sets, hasLength(1));
      expect(log.sets.first.reps, 8);
      // bench-press is freeWeight; 60 kg snaps to 60.0 (valid plate step) — not null.
      expect(log.sets.first.weightKg, 60.0);
    });

    // ── Machine weight snaps to real stack increment ───────────────────────

    testWidgets('machine weight 22 kg snaps to 20 kg before being saved',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Pick the machine exercise (leg-press).
      const machineId = 'leg-press';
      await tester.tap(find.byKey(const Key('gym-exercise-$machineId')));
      await tester.pumpAndSettle();

      // Enter 22 kg — an impossible machine notch (stack steps by 5).
      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '22');
      await tester.enterText(
          find.byKey(const Key('gym-reps-field')), '10');

      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pumpAndSettle();

      // Stored weight must be the snapped 20 kg, not the raw 22.
      final all = await repo.all();
      final sets = all.first.exercises.first.sets;
      expect(sets, hasLength(1));
      expect(sets.first.weightKg, 20.0);
    });

    // ── Free-weight snaps ──────────────────────────────────────────────────

    testWidgets('free-weight 61 kg snaps to 60 kg before being saved',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Pick a free-weight exercise (bench-press).
      const freeId = 'bench-press';
      await tester.tap(find.byKey(const Key('gym-exercise-$freeId')));
      await tester.pumpAndSettle();

      // 61 kg rounds to 60 kg (2.5 kg step at/above 40 kg).
      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '61');
      await tester.enterText(
          find.byKey(const Key('gym-reps-field')), '5');

      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pumpAndSettle();

      final all = await repo.all();
      final sets = all.first.exercises.first.sets;
      expect(sets.first.weightKg, 60.0);
    });

    // ── 0 kg (or negative) on a machine/free-weight is NOT a real notch ────

    testWidgets('machine weight of 0 persists as null, never a fabricated 0.0',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Machine (leg-press): no stack has a 0 kg notch. A ≤0 entry means "no
      // weight entered", not "0 kg on a machine" — must store null.
      const machineId = 'leg-press';
      await tester.tap(find.byKey(const Key('gym-exercise-$machineId')));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '0');
      await tester.enterText(
          find.byKey(const Key('gym-reps-field')), '10');

      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pumpAndSettle();

      final all = await repo.all();
      final sets = all.first.exercises.first.sets;
      expect(sets, hasLength(1));
      expect(sets.first.reps, 10);
      // The load-bearing assertion: 0.0 is NOT persisted; null is.
      expect(sets.first.weightKg, isNull);
    });

    // ── Bodyweight passes through unsnapped ────────────────────────────────

    testWidgets('bodyweight exercise logs without snapping weight field',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Pull-up is bodyweight — weight field should be hidden or optional.
      const bwId = 'pull-up';
      await tester.tap(find.byKey(const Key('gym-exercise-$bwId')));
      await tester.pumpAndSettle();

      // Only reps needed for bodyweight.
      await tester.enterText(
          find.byKey(const Key('gym-reps-field')), '8');

      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pumpAndSettle();

      final all = await repo.all();
      final sets = all.first.exercises.first.sets;
      expect(sets, hasLength(1));
      expect(sets.first.reps, 8);
      // Weight remains null — not fabricated as 0.
      expect(sets.first.weightKg, isNull);
    });

    // ── Unset weight renders as '—' ────────────────────────────────────────

    testWidgets('an unlogged set renders weight/reps as em-dash not zero',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Add an exercise but do NOT log any sets yet — check that the
      // empty-set slot (if shown) uses '—' not '0'.
      final firstEx = kExerciseCatalog.first;
      await tester.tap(find.byKey(Key('gym-exercise-${firstEx.id}')));
      await tester.pumpAndSettle();

      // The weight and reps fields should start empty (not '0').
      final weightField = tester.widget<TextField>(
          find.byKey(const Key('gym-weight-field')));
      final repsField = tester.widget<TextField>(
          find.byKey(const Key('gym-reps-field')));
      expect(weightField.controller?.text ?? '', isNot('0'));
      expect(repsField.controller?.text ?? '', isNot('0'));
    });

    // ── Finish session ─────────────────────────────────────────────────────

    testWidgets('finish button marks the session finished', (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      // Start a session.
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Tap finish.
      await tester.tap(find.byKey(const Key('gym-finish-btn')));
      await tester.pumpAndSettle();

      // Session in the store must be finished.
      final all = await repo.all();
      expect(all, hasLength(1));
      expect(all.first.finished, isTrue);
    });

    // ── T4: rest timer + effort emojis + bump-only confetti ────────────────

    // Helper: start a session, pick [exId], enter [weight]/[reps], log the set.
    // Leaves the page in the rest phase (does NOT pumpAndSettle — the rest
    // timer is running). Callers MUST end with Skip (or dispose) to cancel it.
    Future<void> logOneSet(
      WidgetTester tester,
      WorkoutRepo repo,
      String exId,
      String weight,
      String reps,
    ) async {
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump(); // initial reload

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pump();
      await tester.pump();

      await tester.tap(find.byKey(Key('gym-exercise-$exId')));
      await tester.pump();

      await tester.enterText(find.byKey(const Key('gym-weight-field')), weight);
      await tester.enterText(find.byKey(const Key('gym-reps-field')), reps);

      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      // Pump a few frames for the async saveSet/reload + rest-phase entry.
      // Do NOT pumpAndSettle — the rest timer never settles.
      await tester.pump();
      await tester.pump();
      await tester.pump();
    }

    testWidgets(
        'logging a set shows the rest timer + Skip cancels it cleanly',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);

      // machine leg-press, top of the default 8-12 range at a real weight.
      await logOneSet(tester, repo, 'leg-press', '100', '12');

      expect(find.byKey(const Key('gym-rest-timer')), findsOneWidget);
      expect(find.byKey(const Key('gym-rest-skip-btn')), findsOneWidget);

      // Skip must cancel the timer and return to the entry form.
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle(); // settles because the timer is cancelled
      expect(find.byKey(const Key('gym-rest-timer')), findsNothing);
      expect(find.byKey(const Key('gym-log-set-btn')), findsOneWidget);
    });

    testWidgets(
        'topped range + easy effort → heavier suggestion AND confetti',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);

      // leg-press (machine), 100 kg × 12 reps = top of the 8-12 range.
      // With an unrated (null) effort a clean top set already earns the bump,
      // so confetti fires on log; an "easy" rating keeps it a bump.
      await logOneSet(tester, repo, 'leg-press', '100', '12');

      // Confetti already present from the genuine bump on logging.
      expect(find.byKey(const Key('gym-confetti')), findsOneWidget);

      // Tap "easy" → still too-light → bump → heavier next weight.
      await tester.tap(find.byKey(const Key('gym-effort-easy')));
      await tester.pump();
      await tester.pump();

      // Suggestion present with a heavier next weight (100 → 105 machine step).
      final suggestion = tester.widget<Text>(
          find.byKey(const Key('gym-next-suggestion')));
      expect(suggestion.data, contains('105'));

      // Effort persisted onto the set in the store.
      final all = await repo.all();
      final set = all.first.exercises.first.sets.first;
      expect(set.effort, SetEffort.easy);

      // Cancel the timer cleanly.
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();
    });


    testWidgets(
        'topped range + angry effort → hold, NO confetti (the load-bearing rule)',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);

      await logOneSet(tester, repo, 'leg-press', '100', '12');

      // Tap "angry" (failure) → engine rules a topped-but-max set as a HOLD.
      await tester.tap(find.byKey(const Key('gym-effort-angry')));
      await tester.pump();
      await tester.pump();

      // Suggestion is present (a hold reason)...
      expect(find.byKey(const Key('gym-next-suggestion')), findsOneWidget);
      // ...but confetti is ABSENT — a topped-but-soft set NEVER celebrates.
      expect(find.byKey(const Key('gym-confetti')), findsNothing);

      // Effort persisted.
      final all = await repo.all();
      expect(all.first.exercises.first.sets.first.effort, SetEffort.angry);

      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();
    });

    testWidgets('tapping an emoji records effort onto the correct set',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);

      // Two sets, then rate the SECOND (the one just logged / resting).
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pump();
      await tester.pump();
      await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
      await tester.pump();

      // First set.
      await tester.enterText(find.byKey(const Key('gym-weight-field')), '100');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();
      // Skip the first rest to get back to the form.
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();

      // Second set.
      await tester.enterText(find.byKey(const Key('gym-weight-field')), '100');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-effort-contempt')));
      await tester.pump();
      await tester.pump();

      final all = await repo.all();
      final sets = all.first.exercises.first.sets;
      expect(sets, hasLength(2));
      // Only the second (just-logged) set carries the effort.
      expect(sets[0].effort, isNull);
      expect(sets[1].effort, SetEffort.contempt);

      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();
    });

    testWidgets('confetti fires at most once per exercise per session',
        (tester) async {
      final store = _FakeWorkoutStore();
      final repo = _makeRepo(store);

      // First bump set for leg-press → confetti on log.
      await logOneSet(tester, repo, 'leg-press', '100', '12');
      expect(find.byKey(const Key('gym-confetti')), findsOneWidget);

      // Skip back to the form and log a SECOND bump set for the same exercise.
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('gym-weight-field')), '100');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '12');
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();

      // Already celebrated this exercise this session → NO second confetti,
      // even though this is again a genuine bump verdict.
      expect(find.byKey(const Key('gym-confetti')), findsNothing);

      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();
    });

    // ── Exercise catalog coverage ──────────────────────────────────────────

    test('exercise catalog contains all required equipment types', () {
      final types = kExerciseCatalog.map((e) => e.equipment).toSet();
      expect(types, contains(EquipmentType.machine));
      expect(types, contains(EquipmentType.freeWeight));
      expect(types, contains(EquipmentType.bodyweight));
      expect(types, contains(EquipmentType.cardio));
    });

    test('exercise catalog ids are unique', () {
      final ids = kExerciseCatalog.map((e) => e.id).toList();
      expect(ids.toSet().length, ids.length);
    });
  });
}
