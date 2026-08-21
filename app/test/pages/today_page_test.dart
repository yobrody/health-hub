// Widget tests for the luxury daily dashboard (P4-C).
//
// The dashboard reads REAL data from three repos (profile / nutrition /
// workout) and renders three calm cards on the design system. These tests use
// in-memory fake stores (the same fake/ProviderScope pattern as the nutrition
// + gym page tests) and assert on honest behaviour:
//   • the page renders with Key('today-page');
//   • real values display (weight, today's macros);
//   • a not-yet-provided value renders `—`, never a fabricated number;
//   • a macro ring with no goal shows the honest empty state (value on a bare
//     track, no fabricated fill/percentage);
//   • the workout card reflects active vs last vs none.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/design_system/components/progress_ring.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class FakeProfileStore implements ProfileStore {
  FakeProfileStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class FakeProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class FakeNutritionStore implements NutritionStore {
  FakeNutritionStore([List<FoodLogEntry>? seed]) : _items = seed ?? [];
  List<FoodLogEntry> _items;
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<FoodLogEntry> items) async => _items = List.of(items);
}

class FakeWorkoutStore implements WorkoutStore {
  FakeWorkoutStore([List<WorkoutSession>? seed]) : _items = seed ?? [];
  List<WorkoutSession> _items;
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<WorkoutSession> items) async => _items = List.of(items);
}

// ── Builders ─────────────────────────────────────────────────────────────────

ProfileRepo _profileRepo([Map<String, dynamic>? stored]) => ProfileRepo(
      api: FakeProfileApi(),
      outbox: Outbox(FakeOutboxStore()),
      store: FakeProfileStore(stored),
    );

NutritionRepo _nutritionRepo([List<FoodLogEntry>? seed]) => NutritionRepo(
      outbox: Outbox(FakeOutboxStore()),
      store: FakeNutritionStore(seed),
    );

WorkoutRepo _workoutRepo([List<WorkoutSession>? seed]) => WorkoutRepo(
      outbox: Outbox(FakeOutboxStore()),
      store: FakeWorkoutStore(seed),
    );

Widget _dashboard({
  Map<String, dynamic>? profile,
  List<FoodLogEntry>? food,
  List<WorkoutSession>? workouts,
}) {
  return ProviderScope(
    child: MaterialApp(
      theme: lightTheme,
      home: TodayPage(
        repo: _profileRepo(profile),
        nutritionRepo: _nutritionRepo(food),
        workoutRepo: _workoutRepo(workouts),
      ),
    ),
  );
}

FoodLogEntry _entry({
  String? id,
  double? kcal,
  double? protein,
  double? carbs,
  double? fat,
  DateTime? at,
}) =>
    FoodLogEntry(
      id: id ?? 'e-${DateTime.now().microsecondsSinceEpoch}',
      name: 'Test food',
      at: at ?? DateTime.now(),
      kcal: kcal,
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
      tier: AccuracyTier.exact,
      source: 'manual',
    );

/// Scroll the dashboard ListView up so the (last) training section is built and
/// laid out — a ListView lazily builds only the children in view, and the
/// training card sits below the fold in the default test viewport.
Future<void> _scrollToTraining(WidgetTester tester) async {
  await tester.dragUntilVisible(
    find.text('TRAINING'),
    find.byType(Scrollable),
    const Offset(0, -300),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the dashboard with today-page key', (tester) async {
    await tester.pumpWidget(_dashboard());
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('today-page')), findsOneWidget);
  });

  testWidgets('empty profile → weight & goal render as em-dash, no fake defaults',
      (tester) async {
    await tester.pumpWidget(_dashboard());
    await tester.pumpAndSettle();

    // Honest empty state: em-dashes appear; NO fabricated 80/72 numbers do.
    expect(find.text('—'), findsWidgets);
    expect(find.text('80'), findsNothing);
    expect(find.text('72'), findsNothing);
    expect(find.text('80 kg'), findsNothing);
    expect(find.text('72 kg'), findsNothing);

    // The gentle setup affordance is offered (opens onboarding).
    expect(find.byKey(const Key('today-setup-profile')), findsOneWidget);
  });

  testWidgets('real weight + goal render their values, not dashes',
      (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {
        'weight_kg': 62.5,
        'target_weight_kg': 72.0,
        'goal_direction': 'gain',
      },
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('62.5'), findsWidgets); // hero weight
    expect(find.text('72 kg'), findsOneWidget); // goal badge
    // A profile with data does NOT show the setup card.
    expect(find.byKey(const Key('today-setup-profile')), findsNothing);
  });

  testWidgets("today's logged macros are summed and displayed", (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      food: [
        _entry(kcal: 300, protein: 30, carbs: 20, fat: 10),
        _entry(kcal: 200, protein: 10, carbs: 15, fat: 5),
      ],
    ));
    await tester.pumpAndSettle();

    // 500 kcal total, 40 g protein, 35 g carbs, 15 g fat — all real sums.
    expect(find.text('500'), findsOneWidget);
    expect(find.text('40'), findsOneWidget);
    expect(find.text('35'), findsOneWidget);
    expect(find.text('15'), findsOneWidget);
  });

  testWidgets('a macro ring with no goal shows its honest empty state',
      (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      food: [_entry(protein: 40)],
    ));
    await tester.pumpAndSettle();

    // There are three macro rings; none has a goal in R1.
    final rings = tester.widgetList<ProgressRing>(find.byType(ProgressRing));
    expect(rings, hasLength(3));
    for (final r in rings) {
      expect(r.goal, isNull); // no fabricated goal
    }
    // The card explains the missing goal honestly rather than faking a target.
    expect(
      find.textContaining('set a daily goal'),
      findsOneWidget,
    );
  });

  testWidgets('nothing logged today → macros show em-dash, not zero',
      (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();

    // No food logged → kcal + each macro ring reads '—', never '0'.
    expect(find.text('Nothing logged yet today.'), findsOneWidget);
    // The three rings each render an em-dash center; assert no fabricated 0s
    // are shown as macro values.
    final rings = tester.widgetList<ProgressRing>(find.byType(ProgressRing));
    for (final r in rings) {
      expect(r.value, isNull);
    }
  });

  testWidgets('workout card reflects an active session', (tester) async {
    final active = WorkoutSession(
      id: 'w-1',
      at: DateTime.now(),
      exercises: const [
        ExerciseLog(
          exerciseId: 'bench-press',
          sets: [SetEntry(weightKg: 60, reps: 8, done: true)],
        ),
      ],
    );
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      workouts: [active],
    ));
    await tester.pumpAndSettle();
    await _scrollToTraining(tester);

    expect(find.text('Workout in progress'), findsOneWidget);
    expect(find.textContaining('1 set logged'), findsOneWidget);
  });

  testWidgets('workout card shows the last finished session when none active',
      (tester) async {
    final finished = WorkoutSession(
      id: 'w-done',
      at: DateTime.now(),
      finished: true,
      exercises: const [
        ExerciseLog(
          exerciseId: 'squat',
          sets: [
            SetEntry(weightKg: 100, reps: 5, done: true),
            SetEntry(weightKg: 100, reps: 5, done: true),
          ],
        ),
      ],
    );
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      workouts: [finished],
    ));
    await tester.pumpAndSettle();
    await _scrollToTraining(tester);

    expect(find.text('Last workout'), findsOneWidget);
    // Real exercise name from the catalog + real set count.
    expect(find.textContaining('Squat'), findsOneWidget);
    expect(find.textContaining('2 sets'), findsOneWidget);
  });

  testWidgets('workout card invites a start when there are no sessions',
      (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();
    await _scrollToTraining(tester);

    expect(find.text('Start a workout'), findsOneWidget);
  });
}
