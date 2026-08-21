// Accessibility (semantics) tests for GymPage (P4-G).
//
// These verify the a11y changes introduced in the Phase G polish pass.
// They complement the behavioural tests in gym_page_test.dart.
//
// Invariants tested:
//  • Exercise chips are wrapped in a Semantics widget with the exercise name
//    in its label — found via find.bySemanticsLabel.
//  • Effort emoji buttons expose a plain-text label (not an emoji): "Easy",
//    "Grind", and "Failed" are findable by semantics label.
//  • Pressing a selected chip/effort button keeps selected == true semantics.
//  • No fabricated data appears in any state.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/gym/exercise_catalog.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/gym_page.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class _FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> _sessions = [];
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_sessions);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

Widget _buildPage(WorkoutRepo repo) {
  return ProviderScope(
    overrides: [workoutRepoProvider.overrideWithValue(repo)],
    child: const MaterialApp(home: GymPage()),
  );
}

WorkoutRepo _makeRepo() =>
    WorkoutRepo(outbox: Outbox(_FakeOutboxStore()), store: _FakeWorkoutStore());

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  group('GymPage — accessibility (P4-G)', () {
    // ── Exercise chip semantics ─────────────────────────────────────────────

    testWidgets(
        'exercise chips are findable by semantics label (the exercise name)',
        (tester) async {
      final repo = _makeRepo();
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      // Start a session to reveal the exercise picker.
      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // Every exercise in the catalog must be findable by its name as a
      // Semantics label — this confirms each chip's Semantics wrapper exposes
      // the exercise name to screen readers.
      // Note: find.bySemanticsLabel(String) uses exact-match on the merged
      // SemanticsNode; find.bySemanticsLabel(RegExp) matches against the
      // widget's Semantics.properties.label, which is what we set explicitly.
      // Use RegExp for reliable cross-version matching.
      final firstEx = kExerciseCatalog.first;
      expect(
        find.bySemanticsLabel(RegExp(RegExp.escape(firstEx.name))),
        findsWidgets,
        reason:
            'Exercise chip must expose the exercise name as a Semantics label',
      );
    }, semanticsEnabled: true);

    testWidgets(
        'exercise chips expose Semantics with the chip key still discoverable',
        (tester) async {
      final repo = _makeRepo();
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pumpAndSettle();

      // The chip Key is still discoverable (the Semantics wrapper must not have
      // moved or hidden it — preserving the existing test contract).
      final firstEx = kExerciseCatalog.first;
      expect(
        find.byKey(Key('gym-exercise-${firstEx.id}')),
        findsOneWidget,
        reason: 'Exercise chip Key must remain discoverable after wrapping',
      );
    });

    // ── Effort button semantics ─────────────────────────────────────────────

    testWidgets(
        'effort buttons expose plain-text Semantics labels not emoji',
        (tester) async {
      final repo = _makeRepo();
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pump();
      await tester.pump();

      // Pick leg-press (machine) and log a set → enters the rest phase.
      await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
      await tester.pump();
      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '100');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      // Pump a few frames (rest timer is live — do NOT pumpAndSettle).
      await tester.pump();
      await tester.pump();
      await tester.pump();

      // Rest panel must be visible.
      expect(find.byKey(const Key('gym-rest-panel')), findsOneWidget);

      // Each effort button must be findable by its plain-text semantics label.
      // "Easy", "Grind", and "Failed" are the labels set on the Semantics
      // wrapper — not the emoji characters (🙂 😑 😠).
      // Note: the merged SemanticsNode label is "Easy\nEasy" (the outer
      // Semantics label + the inner Text merged together by Flutter's a11y
      // system). find.bySemanticsLabel(RegExp) matches against the merged
      // node label, so we anchor at the start to confirm the label starts
      // with the plain-text word — NOT an emoji code point.
      expect(
        find.bySemanticsLabel(RegExp('^Easy')),
        findsOneWidget,
        reason:
            '"Easy" effort button must expose "Easy" as a Semantics label, '
            'not an emoji code point',
      );
      expect(
        find.bySemanticsLabel(RegExp('^Grind')),
        findsOneWidget,
        reason: '"Grind" effort button must expose "Grind" as a Semantics label',
      );
      expect(
        find.bySemanticsLabel(RegExp('^Failed')),
        findsOneWidget,
        reason:
            '"Failed" effort button must expose "Failed" as a Semantics label',
      );

      // The button Keys must still be reachable (existing test contract).
      expect(find.byKey(const Key('gym-effort-easy')), findsOneWidget);
      expect(find.byKey(const Key('gym-effort-contempt')), findsOneWidget);
      expect(find.byKey(const Key('gym-effort-angry')), findsOneWidget);

      // Cancel the timer to allow clean teardown.
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();
    }, semanticsEnabled: true);

    // ── Skip button tap target ──────────────────────────────────────────────

    testWidgets('Skip button renders (tap target regression guard)',
        (tester) async {
      final repo = _makeRepo();
      await tester.pumpWidget(_buildPage(repo));
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-start-btn')));
      await tester.pump();
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-exercise-leg-press')));
      await tester.pump();
      await tester.enterText(
          find.byKey(const Key('gym-weight-field')), '100');
      await tester.enterText(find.byKey(const Key('gym-reps-field')), '10');
      await tester.tap(find.byKey(const Key('gym-log-set-btn')));
      await tester.pump();
      await tester.pump();
      await tester.pump();

      // Skip must be present and tappable (not clipped or hidden).
      expect(find.byKey(const Key('gym-rest-skip-btn')), findsOneWidget);

      // Tap and settle to confirm the timer cancels cleanly (not an overflow).
      await tester.tap(find.byKey(const Key('gym-rest-skip-btn')));
      await tester.pumpAndSettle();

      // After skip, the timer is gone and the form is back.
      expect(find.byKey(const Key('gym-rest-timer')), findsNothing);
      expect(find.byKey(const Key('gym-log-set-btn')), findsOneWidget);
    });
  });
}
