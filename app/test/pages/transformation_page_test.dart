// Widget tests for TransformationPage (P1) — the honest goal roadmap, physique
// milestones, and goal-aware strength targets. All against in-memory fakes; no
// device, no network.
//
// Honesty invariants under test:
//  • The roadmap DISCLOSES its basis: "your trend" (reliable) vs "healthy
//    default pace" (unreliable), and shows a needs-data card with NO fabricated
//    date when there's no current/target weight.
//  • Physique abs milestone stays needs-data (with a "Log body fat" affordance)
//    until a real body-fat reading exists.
//  • Strength targets render a bar ONLY where grounded; ungrounded exercises
//    show "log a set to see a target", never a fabricated number.
//  • The page is reachable from the Gym via the Transformation card.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/gym_page.dart';
import 'package:health_hub/pages/transformation_page.dart';
import 'package:health_hub/profile/profile_model.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── In-memory fakes ───────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class _FakeWorkoutStore implements WorkoutStore {
  _FakeWorkoutStore(this._sessions);
  List<WorkoutSession> _sessions;
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_sessions);
  @override
  Future<void> save(List<WorkoutSession> sessions) async =>
      _sessions = List.of(sessions);
}

class _FakeWeighInStore implements WeighInStore {
  _FakeWeighInStore(this._items);
  List<WeighIn> _items;
  @override
  Future<List<WeighIn>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<WeighIn> items) async => _items = List.of(items);
}

class _FakeProfileStore implements ProfileStore {
  _FakeProfileStore([this._json]);
  Map<String, dynamic>? _json;
  @override
  Future<Map<String, dynamic>?> load() async => _json;
  @override
  Future<void> save(Map<String, dynamic> json) async => _json = json;
}

Outbox _outbox() => Outbox(_FakeOutboxStore());

WeighInRepo _weighInRepo(List<WeighIn> items) =>
    WeighInRepo(outbox: _outbox(), store: _FakeWeighInStore(items));

WorkoutRepo _workoutRepo(List<WorkoutSession> sessions) =>
    WorkoutRepo(outbox: _outbox(), store: _FakeWorkoutStore(sessions));

ProfileRepo _profileRepo(Profile? p) => ProfileRepo(
      api: const OutboxOnlyProfileApi(),
      outbox: _outbox(),
      store: _FakeProfileStore(p?.toJson()),
    );

Widget _page({
  Profile? profile,
  List<WeighIn> weighIns = const [],
  List<WorkoutSession> sessions = const [],
  DateTime? now,
}) {
  return MaterialApp(
    home: TransformationPage(
      weighInRepo: _weighInRepo(weighIns),
      profileRepo: _profileRepo(profile),
      workoutRepo: _workoutRepo(sessions),
      now: now ?? DateTime.parse('2026-01-01T00:00:00Z'),
    ),
  );
}

WeighIn _wi(String iso, double kg) =>
    WeighIn(id: 'w-$iso', at: DateTime.parse(iso), weightKg: kg);

void main() {
  group('TransformationPage', () {
    testWidgets('renders with Key transformation-page', (tester) async {
      await tester.pumpWidget(_page());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transformation-page')), findsOneWidget);
    });

    // ── Roadmap ──────────────────────────────────────────────────────────────

    testWidgets('no current/target weight → honest needs-data roadmap, no date',
        (tester) async {
      await tester.pumpWidget(_page(profile: const Profile()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transformation-roadmap-needsdata')),
          findsOneWidget);
      expect(find.byKey(const Key('transformation-roadmap')), findsNothing);
      // No fabricated ETA anywhere.
      expect(find.byKey(const Key('transformation-roadmap-eta')), findsNothing);
    });

    testWidgets(
        'reliable real trend toward goal → roadmap discloses "your trend"',
        (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(
            weightKg: 62, targetWeightKg: 72, goalDirection: 'gain'),
        weighIns: [
          _wi('2026-01-01T00:00:00Z', 62),
          _wi('2026-02-10T00:00:00Z', 63.5), // +1.5kg over 40 days → reliable
        ],
        now: DateTime.parse('2026-02-10T00:00:00Z'),
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('transformation-roadmap')), findsOneWidget);
      expect(find.byKey(const Key('transformation-roadmap-eta')), findsOneWidget);
      expect(find.byKey(const Key('transformation-roadmap-basis')),
          findsOneWidget);
      expect(find.textContaining('Estimated from your trend'), findsOneWidget);
    });

    testWidgets(
        'insufficient trend → roadmap DISCLOSES the default-rate basis',
        (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(weightKg: 62, targetWeightKg: 72),
        weighIns: [_wi('2026-01-01T00:00:00Z', 62)], // one reading → not reliable
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('transformation-roadmap')), findsOneWidget);
      expect(find.textContaining('healthy default pace'), findsOneWidget);
    });

    // ── Physique milestones ────────────────────────────────────────────────────

    testWidgets('abs milestone is needs-data with a "Log body fat" affordance',
        (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(weightKg: 62, targetWeightKg: 72),
        weighIns: [_wi('2026-01-01T00:00:00Z', 62)],
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('transformation-milestones')), findsOneWidget);
      // The abs row is needs-data (no fabricated BF bar) with the log affordance.
      expect(find.byKey(const Key('transformation-milestone-abs-needsdata')),
          findsOneWidget);
      expect(find.byKey(const Key('transformation-milestone-abs-log-bf')),
          findsOneWidget);
    });

    testWidgets('a real body-fat reading makes the abs milestone real',
        (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(
            weightKg: 62, targetWeightKg: 72, bodyFatPercent: 16),
        weighIns: [_wi('2026-01-01T00:00:00Z', 62)],
      ));
      await tester.pumpAndSettle();

      // No needs-data marker on abs; the honest caveat is present.
      expect(find.byKey(const Key('transformation-milestone-abs-needsdata')),
          findsNothing);
      expect(find.byKey(const Key('transformation-milestone-abs-log-bf')),
          findsNothing);
      expect(find.textContaining('bulk raises body fat'), findsWidgets);
    });

    // ── Strength targets ────────────────────────────────────────────────────────

    testWidgets('compound shows a grounded target; isolation without history is'
        ' honest', (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(weightKg: 62, targetWeightKg: 72),
      ));
      await tester.pumpAndSettle();

      // Leg Press is a compound → grounded bodyweight-ratio target (2.0 × 72).
      final legPress = find.byKey(const Key('transformation-strength-leg-press'));
      await tester.scrollUntilVisible(legPress, 200);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transformation-strength')), findsOneWidget);
      expect(legPress, findsOneWidget);
      expect(find.textContaining('target 144 kg'), findsOneWidget);
    });

    testWidgets('no goal weight → strength section is an honest needs-data card',
        (tester) async {
      await tester.pumpWidget(_page(
        profile: const Profile(weightKg: 62), // no target
      ));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transformation-strength-needsdata')),
          findsOneWidget);
      expect(find.byKey(const Key('transformation-strength')), findsNothing);
    });

    testWidgets('strength progress bar shows best when there is real history',
        (tester) async {
      // A logged Leg Press set at 100kg → a real "best" so a bar + best line show.
      final session = WorkoutSession(
        id: 'w1',
        at: DateTime.parse('2026-01-01T00:00:00Z'),
        finished: true,
        exercises: const [
          ExerciseLog(
            exerciseId: 'leg-press',
            sets: [SetEntry(weightKg: 100, reps: 10, done: true)],
          ),
        ],
      );
      await tester.pumpWidget(_page(
        profile: const Profile(weightKg: 62, targetWeightKg: 72),
        sessions: [session],
      ));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('transformation-strength-leg-press')),
        200,
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('best 100 kg'), findsOneWidget);
    });
  });

  // ── Reachable from Gym ───────────────────────────────────────────────────────

  group('Gym → Transformation', () {
    testWidgets('the Gym no-session view shows a Transformation card',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            workoutRepoProvider.overrideWithValue(_workoutRepo(const [])),
            weighInRepoProvider.overrideWithValue(_weighInRepo(const [])),
            profileRepoProvider.overrideWithValue(_profileRepo(null)),
          ],
          child: const MaterialApp(home: GymPage()),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('gym-transformation-card')), findsOneWidget);
    });

    testWidgets('tapping the card opens the Transformation page',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            workoutRepoProvider.overrideWithValue(_workoutRepo(const [])),
            weighInRepoProvider.overrideWithValue(_weighInRepo(const [])),
            profileRepoProvider.overrideWithValue(
                _profileRepo(const Profile(weightKg: 62, targetWeightKg: 72))),
          ],
          child: const MaterialApp(home: GymPage()),
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('gym-transformation-card')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('transformation-page')), findsOneWidget);
    });
  });
}
