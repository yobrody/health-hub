// Pure-engine tests for The Brain — the honesty spine.
//
// These prove computeInsights is:
//  • grounded 100% in the user's REAL data (every insight + every `why` value);
//  • honest when data is missing (a `setup` prompt, never a fabricated number);
//  • personalized by construction (different inputs → different, correct insights);
//  • deterministic (now is passed in) and correctly ordered.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/brain/brain.dart';
import 'package:health_hub/brain/insight.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals.dart';
import 'package:health_hub/pantry/pantry_item.dart';

// ── Builders ────────────────────────────────────────────────────────────────

final _now = DateTime(2026, 8, 22, 12);

FoodLogEntry _food(
  String name, {
  double? kcal,
  double? protein,
  DateTime? at,
}) =>
    FoodLogEntry(
      id: 'f-$name',
      name: name,
      at: at ?? _now,
      kcal: kcal,
      proteinG: protein,
      tier: AccuracyTier.exact,
      source: 'manual',
    );

PantryItem _pantry(
  String name, {
  double? qty,
  String? unit,
  DateTime? expiry,
  int? cadence,
  DateTime? lastBought,
}) =>
    PantryItem(
      id: 'p-$name',
      name: name,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      expiry: expiry,
      reorderCadenceDays: cadence,
      lastBought: lastBought,
      source: 'manual',
    );

WorkoutSession _session({
  required DateTime at,
  bool finished = true,
  List<ExerciseLog> exercises = const [],
}) =>
    WorkoutSession(
      id: 'w-${at.microsecondsSinceEpoch}',
      at: at,
      exercises: exercises,
      finished: finished,
    );

ExerciseLog _log(String exerciseId, List<SetEntry> sets) =>
    ExerciseLog(exerciseId: exerciseId, sets: sets);

Insight _byId(List<Insight> list, String id) =>
    list.firstWhere((i) => i.id == id);

bool _has(List<Insight> list, String id) => list.any((i) => i.id == id);

void main() {
  group('EAT', () {
    test('with a real calorie goal: remaining is goal minus real eaten', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 2000),
        todaysLog: [_food('Oats', kcal: 450), _food('Eggs', kcal: 300)],
      ));

      final eat = _byId(insights, 'eat');
      expect(eat.kind, InsightKind.eat);
      // 2000 - 750 = 1250 kcal left — a real subtraction of real numbers.
      expect(eat.title, contains('1250 kcal'));
      // why cites the REAL goal + REAL eaten total.
      expect(
        eat.why,
        containsAll([
          const WhyFact(label: 'Calorie goal', value: '2000 kcal'),
          const WhyFact(label: 'Eaten today', value: '750 kcal'),
        ]),
      );
      expect(eat.action?.kind, InsightActionKind.logMeal);
    });

    test('names a real relevant pantry item when protein is still short', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(proteinG: 150),
        todaysLog: [_food('Toast', protein: 10)],
        pantryItems: [_pantry('Chicken breast'), _pantry('Greek yogurt')],
      ));

      final eat = _byId(insights, 'eat');
      // 150 - 10 = 140 g protein left.
      expect(eat.title, contains('140 g protein'));
      // Names the REAL pantry items (both protein-leaning) — never invented.
      expect(eat.detail, contains('Chicken breast'));
      expect(eat.detail, contains('Greek yogurt'));
    });

    test('does NOT name a pantry item that does not exist / is not relevant', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(proteinG: 150),
        pantryItems: [_pantry('Olive oil'), _pantry('Sugar')],
      ));
      final eat = _byId(insights, 'eat');
      expect(eat.detail, isNot(contains('Olive oil')));
      expect(eat.detail, isNot(contains('Sugar')));
    });

    test('no calorie AND no protein goal → honest setup prompt, no fake number',
        () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(), // nothing set
        todaysLog: [_food('Oats', kcal: 450)],
      ));

      expect(_has(insights, 'eat'), isFalse);
      final setup = _byId(insights, 'eat-setup');
      expect(setup.kind, InsightKind.setup);
      expect(setup.action?.kind, InsightActionKind.openGoals);
      // No `why` facts — a setup prompt never claims data.
      expect(setup.why, isEmpty);
      // No fabricated target anywhere in the text.
      expect(setup.title, isNot(contains('2200')));
      expect(setup.title, isNot(contains('140')));
    });

    test('eaten total counts only real macros (a null-kcal entry adds nothing)',
        () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 1000),
        // second entry has null kcal — must NOT be treated as 0-and-counted, and
        // must NOT fabricate a value; it simply contributes nothing.
        todaysLog: [_food('A', kcal: 400), _food('B')],
      ));
      final eat = _byId(insights, 'eat');
      expect(eat.title, contains('600 kcal')); // 1000 - 400
    });

    test('nothing logged: eaten is "nothing logged yet", not a fabricated 0', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 2000),
        todaysLog: const [], // truly nothing logged today
      ));
      final eat = _byId(insights, 'eat');
      // Remaining is honestly the full goal (2000 − 0).
      expect(eat.title, contains('2000 kcal'));
      // But the "eaten" fact must NOT claim a verified 0 — it's an absence.
      expect(
        eat.why,
        contains(const WhyFact(label: 'Eaten today', value: 'nothing logged yet')),
      );
      expect(
        eat.why,
        isNot(contains(const WhyFact(label: 'Eaten today', value: '0 kcal'))),
      );
    });

    test('remaining is floored at 0 when over the goal (never negative)', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 1000),
        todaysLog: [_food('Feast', kcal: 1500)],
      ));
      final eat = _byId(insights, 'eat');
      expect(eat.title, contains('0 kcal'));
      expect(eat.title, isNot(contains('-')));
    });
  });

  group('BUY', () {
    test('from restockSoon: a low item surfaces with a real "in stock" why', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        pantryItems: [_pantry('Milk', qty: 20, unit: 'g')], // < 100 g threshold
      ));

      final buy = _byId(insights, 'buy-p-Milk');
      expect(buy.kind, InsightKind.buy);
      expect(buy.title, 'Restock Milk');
      expect(buy.why, contains(const WhyFact(label: 'In stock', value: '20 g')));
      expect(buy.action?.kind, InsightActionKind.addToCart);
      expect(buy.action?.payload, 'Milk'); // the REAL item name
    });

    test('an expiring item surfaces with a real expiry why', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        pantryItems: [
          _pantry('Yogurt', expiry: _now.add(const Duration(days: 2))),
        ],
      ));
      final buy = _byId(insights, 'buy-p-Yogurt');
      expect(buy.why, contains(const WhyFact(label: 'Expires', value: 'in 2 days')));
    });

    test('a reorder-due item surfaces with its real cadence', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        pantryItems: [
          _pantry('Coffee',
              cadence: 14,
              lastBought: _now.subtract(const Duration(days: 20))),
        ],
      ));
      final buy = _byId(insights, 'buy-p-Coffee');
      expect(
        buy.why,
        contains(const WhyFact(label: 'Reorder cadence', value: 'every 14 days')),
      );
    });

    test('empty pantry / nothing due → NO buy insight (no fabricated urgency)',
        () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        // A well-stocked, non-expiring, no-cadence item: no real restock signal.
        pantryItems: [_pantry('Rice', qty: 5000, unit: 'g')],
      ));
      expect(insights.where((i) => i.kind == InsightKind.buy), isEmpty);
    });
  });

  group('TRAIN', () {
    test('a session logged 3 days ago is DUE, with a real progression why', () {
      // Bench (freeWeight): 60kg for reps at the top of range → an earned bump.
      final insights = computeInsights(BrainInputs(
        now: _now,
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(days: 3)),
            exercises: [
              _log('bench-press', [
                const SetEntry(weightKg: 60, reps: 12, done: true),
                const SetEntry(weightKg: 60, reps: 12, done: true),
              ]),
            ],
          ),
        ],
      ));

      final train = _byId(insights, 'train');
      expect(train.kind, InsightKind.train);
      // The `why` carries the REAL "last trained N days ago".
      expect(
        train.why,
        contains(const WhyFact(label: 'Last trained', value: '3 days ago')),
      );
      // And a real progression verdict for the actual lift (Bench Press).
      expect(train.why.any((f) => f.label == 'Bench Press'), isTrue);
      expect(train.action?.kind, InsightActionKind.startWorkout);
      expect(train.priority, greaterThan(0));
    });

    test('a session logged today is NOT due — an honest recovering info insight',
        () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(hours: 2)),
            exercises: [
              _log('squat', [const SetEntry(weightKg: 80, reps: 10, done: true)]),
            ],
          ),
        ],
      ));
      final train = _byId(insights, 'train');
      expect(train.title, contains('today'));
      // Still carries the real "last trained" fact.
      expect(train.why.any((f) => f.label == 'Last trained'), isTrue);
    });

    test('no workout history → honest setup prompt, never an invented due date',
        () {
      final insights = computeInsights(BrainInputs(now: _now));
      expect(_has(insights, 'train'), isFalse);
      final setup = _byId(insights, 'train-setup');
      expect(setup.kind, InsightKind.setup);
      expect(setup.action?.kind, InsightActionKind.startWorkout);
      expect(setup.why, isEmpty);
    });

    test('an unfinished session does not count as history', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(days: 5)),
            finished: false, // in progress — not "trained"
            exercises: [
              _log('squat', [const SetEntry(weightKg: 80, reps: 10, done: true)]),
            ],
          ),
        ],
      ));
      // Falls back to the honest setup prompt.
      expect(_has(insights, 'train-setup'), isTrue);
      expect(_has(insights, 'train'), isFalse);
    });
  });

  group('ordering & shape', () {
    test('actionable insights precede setup prompts', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        // Real BUY, but no goal (EAT setup) and no history (TRAIN setup).
        pantryItems: [_pantry('Milk', qty: 10, unit: 'g')],
      ));
      final firstSetupIdx =
          insights.indexWhere((i) => i.kind == InsightKind.setup);
      final buyIdx = insights.indexWhere((i) => i.kind == InsightKind.buy);
      expect(buyIdx, greaterThanOrEqualTo(0));
      expect(firstSetupIdx, greaterThan(buyIdx));
    });

    test('every non-setup insight carries at least one real why fact', () {
      final insights = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 2000),
        pantryItems: [_pantry('Milk', qty: 10, unit: 'g')],
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(days: 3)),
            exercises: [
              _log('bench-press',
                  [const SetEntry(weightKg: 60, reps: 12, done: true)]),
            ],
          ),
        ],
      ));
      for (final i in insights.where((i) => i.kind != InsightKind.setup)) {
        expect(i.why, isNotEmpty, reason: '${i.id} must be grounded in real data');
      }
    });
  });

  group('personalization', () {
    test('two different users get different, correct insights', () {
      // User A: has a calorie goal + chicken in the pantry, no workouts.
      final a = computeInsights(BrainInputs(
        now: _now,
        goals: const NutritionGoals(caloriesKcal: 2500),
        todaysLog: [_food('Lunch', kcal: 500)],
        pantryItems: [_pantry('Chicken thighs')],
      ));

      // User B: no goal, a low pantry item, and a workout 4 days ago.
      final b = computeInsights(BrainInputs(
        now: _now,
        pantryItems: [_pantry('Butter', qty: 15, unit: 'g')],
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(days: 4)),
            exercises: [
              _log('leg-press',
                  [const SetEntry(weightKg: 100, reps: 12, done: true)]),
            ],
          ),
        ],
      ));

      // A has a real EAT insight (2000 kcal left) naming chicken; B has an EAT
      // SETUP prompt instead (no goal).
      expect(_byId(a, 'eat').title, contains('2000 kcal'));
      expect(_byId(a, 'eat').detail, contains('Chicken thighs'));
      expect(_has(b, 'eat'), isFalse);
      expect(_has(b, 'eat-setup'), isTrue);

      // A has NO train insight of any kind besides setup; B has a real TRAIN.
      expect(_has(a, 'train-setup'), isTrue);
      expect(_has(b, 'train'), isTrue);
      expect(_byId(b, 'train').why.any((f) => f.value == '4 days ago'), isTrue);

      // The two results are genuinely different.
      final aIds = a.map((i) => i.id).toSet();
      final bIds = b.map((i) => i.id).toSet();
      expect(aIds, isNot(equals(bIds)));
    });

    test('the same inputs are deterministic', () {
      BrainInputs inputs() => BrainInputs(
            now: _now,
            goals: const NutritionGoals(caloriesKcal: 2000, proteinG: 150),
            todaysLog: [_food('A', kcal: 400, protein: 30)],
            pantryItems: [_pantry('Eggs'), _pantry('Milk', qty: 10, unit: 'g')],
          );
      final first = computeInsights(inputs());
      final second = computeInsights(inputs());
      expect(first.map((i) => i.id).toList(), second.map((i) => i.id).toList());
      expect(first.map((i) => i.title).toList(),
          second.map((i) => i.title).toList());
    });
  });

  group('honesty — nothing fabricated', () {
    test('a fully-empty user gets only honest setup prompts, no numbers', () {
      final insights = computeInsights(BrainInputs(now: _now));
      // Only setup prompts (EAT + TRAIN); no buy, no fabricated eat/train.
      expect(insights.every((i) => i.kind == InsightKind.setup), isTrue);
      expect(_has(insights, 'eat-setup'), isTrue);
      expect(_has(insights, 'train-setup'), isTrue);
      // No setup prompt contains a fabricated reference number.
      for (final i in insights) {
        expect(i.title, isNot(matches(RegExp(r'\d')))); // no digits at all
      }
    });

    test('a machine weight is snapped in the progression why (real stack)', () {
      // Leg press (machine) logged at 103kg top-of-range → bump snaps to a real
      // 5kg notch; the why must not show an impossible in-between number.
      final insights = computeInsights(BrainInputs(
        now: _now,
        workoutHistory: [
          _session(
            at: _now.subtract(const Duration(days: 3)),
            exercises: [
              _log('leg-press', [
                const SetEntry(weightKg: 100, reps: 12, done: true),
                const SetEntry(weightKg: 100, reps: 12, done: true),
              ]),
            ],
          ),
        ],
      ));
      final train = _byId(insights, 'train');
      final legPress = train.why.firstWhere((f) => f.label == 'Leg Press');
      // 100kg + a 5kg machine notch = 105kg (a real, selectable weight).
      expect(legPress.value, contains('105'));
    });
  });
}
