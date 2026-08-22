/// The Brain — a PURE, fully-tested engine that turns one user's REAL data into
/// personalized, honest insights.
///
/// `computeInsights(BrainInputs)` is a pure function: same inputs → same
/// insights, no `DateTime.now()`, no I/O, no repos. That makes it deterministic,
/// heavily testable, and personalized BY CONSTRUCTION (the output is a function
/// of that user's inputs, so two different users' data yield different insights).
///
/// HONESTY INVARIANTS (do NOT weaken — this is the whole point of the feature):
///  • Every insight, and every [WhyFact] value on it, comes from the user's REAL
///    data. No goal/history/pantry → an honest [InsightKind.setup] insight,
///    never filler or a guessed number.
///  • No insight implies data we don't have. If an insight can't be grounded in
///    real values, it is NOT emitted — a smaller honest brain beats a fabricated
///    one.
///  • Deterministic: [BrainInputs.now] is passed in, never read from the clock.
library;

import '../gym/exercise.dart';
import '../gym/exercise_catalog.dart';
import '../gym/progression.dart';
import '../gym/workout_session.dart';
import '../metrics/weigh_in.dart';
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_goals.dart';
import '../pantry/pantry_glance.dart';
import '../pantry/pantry_item.dart';
import '../profile/profile_model.dart';
import 'insight.dart';

// ── Priority tiers ────────────────────────────────────────────────────────────
//
// Higher shows first. Real, actionable insights lead; honest setup prompts trail
// so a user with real data never sees a "set this up" card above genuine
// guidance. These are ordering weights, not user data.

const int _pEatUrgent = 100; // a real remaining-goal gap
const int _pTrainDue = 90; // a workout is due, with a real progression verdict
const int _pBuy = 80; // a real low/expiring/reorder-due pantry item
const int _pTrainInfo = 60; // training info (recently trained, keep going)
const int _pSetup = 10; // honest "set this up" prompts — always last

/// How many hours' worth of pantry-restock signals to surface as BUY insights,
/// and how many named pantry items to cite in an EAT insight. Small, so a screen
/// stays a calm glance, not a dump. Documented product constants, not user data.
const int _kMaxBuyInsights = 3;
const int _kMaxPantryNamesInEat = 3;

/// Days since the last workout at/after which a session is considered "due".
///
/// A DISCLOSED product default (a rest-day cadence), NOT fabricated per-user
/// data — the app has no per-user training schedule yet, and the TRAIN insight's
/// `why` always cites the REAL "last trained N days ago" so the user can judge
/// the recommendation for themselves. Below this we surface an honest
/// "trained recently" info insight instead of nudging a session.
const int kWorkoutDueAfterDays = 2;

// ── Inputs ────────────────────────────────────────────────────────────────────

/// The real state the Brain reasons over — plain data gathered from the repos by
/// [brain_providers], never repos themselves (keeps the engine pure + testable).
class BrainInputs {
  const BrainInputs({
    required this.now,
    this.goals = const NutritionGoals(),
    this.todaysLog = const [],
    this.pantryItems = const [],
    this.workoutHistory = const [],
    this.weighIns = const [],
    this.profile = const Profile(),
  });

  /// The reference "now" — passed in so the engine stays deterministic.
  final DateTime now;

  /// The user's daily targets. Every target may be null (unset) — an unset
  /// calorie/protein goal drives the honest EAT setup prompt.
  final NutritionGoals goals;

  /// TODAY's food-log entries (already filtered to the local day by the caller).
  final List<FoodLogEntry> todaysLog;

  /// The full pantry inventory. BUY insights come only from real signals on
  /// these items (via [restockSoon]).
  final List<PantryItem> pantryItems;

  /// The user's workout sessions (any order). Drives the TRAIN insight.
  final List<WorkoutSession> workoutHistory;

  /// The user's weigh-in history. Reserved for future weight-aware insights;
  /// never fabricated into one here.
  final List<WeighIn> weighIns;

  /// The user's profile (weight, goal direction). Used only to enrich an EAT
  /// insight's phrasing honestly — never to fabricate a target.
  final Profile profile;
}

// ── The engine ────────────────────────────────────────────────────────────────

/// Compute the personalized, honest insights for this user's real state.
///
/// Ordered by [Insight.priority] (most actionable first, setup prompts last).
/// Within an equal priority, insertion order is preserved (a stable sort).
List<Insight> computeInsights(BrainInputs inputs) {
  final out = <Insight>[];

  _addEatInsight(inputs, out);
  _addBuyInsights(inputs, out);
  _addTrainInsight(inputs, out);

  // Stable sort by descending priority. Dart's List.sort is not guaranteed
  // stable, so use an index tie-breaker to keep insertion order within a tier.
  final indexed = [for (var i = 0; i < out.length; i++) (i, out[i])];
  indexed.sort((a, b) {
    final byPriority = b.$2.priority.compareTo(a.$2.priority);
    if (byPriority != 0) return byPriority;
    return a.$1.compareTo(b.$1);
  });
  return [for (final e in indexed) e.$2];
}

// ── EAT ───────────────────────────────────────────────────────────────────────

/// EAT: what to eat now, grounded in the REAL remaining calorie/protein gap vs
/// today's REAL eaten totals — preferring real pantry items when they match.
///
/// Honesty:
///  • With NO real calorie AND NO real protein goal → an honest [InsightKind
///    .setup] prompt ("Set a daily goal to see what to eat"), never a guessed
///    target. openGoals action.
///  • With a real goal, the `why` cites the real goal + the real eaten total
///    (both from the user's data). "Remaining" is a real subtraction of two real
///    numbers, floored at 0 (you can't have negative food to eat).
///  • Pantry items are NAMED only when they genuinely exist AND are relevant
///    (high-protein-sounding) — never invented.
void _addEatInsight(BrainInputs inputs, List<Insight> out) {
  final goals = inputs.goals;
  final calGoal = goals.caloriesKcal;
  final proGoal = goals.proteinG;

  // No real calorie or protein goal → honest setup prompt (never a fake target).
  if (calGoal == null && proGoal == null) {
    out.add(const Insight(
      id: 'eat-setup',
      kind: InsightKind.setup,
      title: 'Set a daily goal to see what to eat',
      detail:
          'Add a calorie or protein target and the Brain will tell you what to '
          'eat next — grounded in your real intake, never a guess.',
      action: InsightAction(
        kind: InsightActionKind.openGoals,
        label: 'Set goals',
      ),
      priority: _pSetup,
    ));
    return;
  }

  // Real eaten totals from today's log (null when nothing real logged for that
  // macro). Mirrors the home page's honest day-aggregate.
  final eatenKcal = _sumMacro(inputs.todaysLog, (e) => e.kcal);
  final eatenProtein = _sumMacro(inputs.todaysLog, (e) => e.proteinG);

  final why = <WhyFact>[];
  double? remainingKcal;
  double? remainingProtein;

  if (calGoal != null) {
    why.add(WhyFact(label: 'Calorie goal', value: '${_fmt(calGoal)} kcal'));
    // Honesty: a null eaten total is an ABSENCE of data (nothing logged yet),
    // NOT a measured 0 — surface it as such rather than a fabricated "0 kcal".
    // The remaining arithmetic below treats no-log as 0 (correct: goal − 0), but
    // the displayed fact must not claim a verified zero intake.
    why.add(WhyFact(
      label: 'Eaten today',
      value: eatenKcal != null ? '${_fmt(eatenKcal)} kcal' : 'nothing logged yet',
    ));
    remainingKcal = (calGoal - (eatenKcal ?? 0)).clamp(0, double.infinity);
  }
  if (proGoal != null) {
    why.add(WhyFact(label: 'Protein goal', value: '${_fmt(proGoal)} g'));
    why.add(WhyFact(
      label: 'Protein eaten',
      value:
          eatenProtein != null ? '${_fmt(eatenProtein)} g' : 'nothing logged yet',
    ));
    remainingProtein = (proGoal - (eatenProtein ?? 0)).clamp(0, double.infinity);
  }

  // Build the headline from whichever real target(s) we have.
  final String title;
  if (remainingKcal != null && remainingProtein != null) {
    title =
        '${_fmt(remainingKcal)} kcal · ${_fmt(remainingProtein)} g protein left';
  } else if (remainingKcal != null) {
    title = '${_fmt(remainingKcal)} kcal left today';
  } else {
    title = '${_fmt(remainingProtein!)} g protein left today';
  }

  // Prefer real pantry items that plausibly help the remaining goal. Only NAME
  // items that genuinely exist; if none match, we say nothing about the pantry.
  final proteinLeaning = remainingProtein == null || remainingProtein > 0;
  final matches = _relevantPantryNames(
    inputs.pantryItems,
    highProtein: proteinLeaning,
  );

  final String detail;
  if (matches.isNotEmpty) {
    detail = 'You have ${_joinNames(matches)} — reach for '
        '${matches.length == 1 ? 'it' : 'those'} to close the gap.';
  } else if ((remainingKcal ?? 1) <= 0 && (remainingProtein ?? 1) <= 0) {
    detail = "You've hit today's targets — nice work.";
  } else {
    detail = 'Log your next meal to keep the numbers honest.';
  }

  out.add(Insight(
    id: 'eat',
    kind: InsightKind.eat,
    title: title,
    detail: detail,
    why: why,
    action: const InsightAction(
      kind: InsightActionKind.logMeal,
      label: 'Log a meal',
    ),
    priority: _pEatUrgent,
  ));
}

// ── BUY ───────────────────────────────────────────────────────────────────────

/// BUY: real pantry items that are low / expiring / reorder-due — via the pure
/// [restockSoon] selector, which surfaces an item ONLY from a real field on it.
///
/// Honesty:
///  • Empty pantry / nothing due → NO buy insight (never a fabricated urgency).
///  • Each `why` cites the real reason (e.g. "2 g left", "expires in 2 days",
///    "reorder due") derived from the item's own fields — never invented.
///  • Action adds the REAL item name to the grocery list, then jumps to Cart.
void _addBuyInsights(BrainInputs inputs, List<Insight> out) {
  final restock = restockSoon(inputs.pantryItems, inputs.now);
  if (restock.isEmpty) return; // no real signal — never fabricate one.

  for (final r in restock.take(_kMaxBuyInsights)) {
    final why = _buyWhy(r, inputs.now);
    // Defensive honesty: restockSoon guarantees a real reason, so `why` is
    // non-empty here. If it ever weren't, skip rather than emit a groundless
    // buy insight.
    if (why.isEmpty) continue;

    out.add(Insight(
      id: 'buy-${r.item.id}',
      kind: InsightKind.buy,
      title: 'Restock ${r.item.name}',
      detail: _buyReasonSentence(r),
      why: why,
      action: InsightAction(
        kind: InsightActionKind.addToCart,
        label: 'Add to list',
        payload: r.item.name,
      ),
      priority: _pBuy,
    ));
  }
}

/// The real `why` facts for a restock item — each derived from a genuine field.
List<WhyFact> _buyWhy(RestockItem r, DateTime now) {
  final why = <WhyFact>[];
  final item = r.item;

  if (r.isLow && item.qty != null) {
    final unit = item.unit;
    why.add(WhyFact(
      label: 'In stock',
      value: unit != null ? '${_fmt(item.qty!)} $unit' : _fmt(item.qty!),
    ));
  }
  if (r.isExpiring && item.expiry != null) {
    why.add(WhyFact(label: 'Expires', value: _expiryPhrase(item.expiry!, now)));
  }
  if (r.isReorderDue && item.reorderCadenceDays != null) {
    why.add(WhyFact(
      label: 'Reorder cadence',
      value: 'every ${item.reorderCadenceDays} days',
    ));
  }
  return why;
}

/// A short honest sentence describing why this item surfaced.
String _buyReasonSentence(RestockItem r) {
  final parts = <String>[
    if (r.isExpiring) 'expiring soon',
    if (r.isLow) 'running low',
    if (r.isReorderDue) 'due for a reorder',
  ];
  return "It's ${_joinReasons(parts)}.";
}

// ── TRAIN ─────────────────────────────────────────────────────────────────────

/// TRAIN: whether a session is due (from real workout history/cadence) + the
/// honest progression suggestion for the likely next lift (via
/// [evaluateProgression]).
///
/// Honesty:
///  • NO workout history → an honest [InsightKind.setup] prompt ("Log a workout
///    to get training guidance"). startWorkout action. Never invents a due date.
///  • With history, the `why` always cites the REAL "last trained N days ago"
///    (from the real last-session timestamp) plus, when we can compute one, the
///    real progression verdict for the last-trained lift. The due/not-due call
///    is a disclosed cadence default the user can judge against that real fact.
void _addTrainInsight(BrainInputs inputs, List<Insight> out) {
  final finished = _finishedSessions(inputs.workoutHistory);

  if (finished.isEmpty) {
    out.add(const Insight(
      id: 'train-setup',
      kind: InsightKind.setup,
      title: 'Log a workout to get training guidance',
      detail:
          'Start a session and the Brain will track your progression and tell '
          'you honestly when to go heavier — all from your real lifts.',
      action: InsightAction(
        kind: InsightActionKind.startWorkout,
        label: 'Start a workout',
      ),
      priority: _pSetup,
    ));
    return;
  }

  // Most-recent finished session by real timestamp.
  final last = finished.reduce((a, b) => a.at.isAfter(b.at) ? a : b);
  final daysSince = _wholeDaysBetween(last.at, inputs.now);
  final due = daysSince >= kWorkoutDueAfterDays;

  final why = <WhyFact>[
    WhyFact(label: 'Last trained', value: _daysAgoPhrase(daysSince)),
  ];

  // The honest progression suggestion for the likely next lift: the last
  // exercise the user actually logged working sets for, evaluated over its real
  // sets. Only added when we can ground a real verdict (not recalibrating).
  final progression = _lastLiftProgression(last);
  if (progression != null) {
    final (name, result) = progression;
    if (result.verdict != ProgressionVerdict.recalibrating) {
      why.add(WhyFact(
        label: name,
        value: _verdictPhrase(result),
      ));
    }
  }

  final String title;
  final String detail;
  final int priority;
  if (due) {
    title = 'Time to train';
    detail = progression != null &&
            progression.$2.verdict != ProgressionVerdict.recalibrating
        ? 'Your last ${progression.$1} says ${_verdictSentence(progression.$2)}.'
        : "It's been ${_daysAgoPhrase(daysSince)} — start a session when ready.";
    priority = _pTrainDue;
  } else {
    title = 'Trained ${_daysAgoPhrase(daysSince)}';
    detail = 'Recovering — the Brain will nudge you when a session is due.';
    priority = _pTrainInfo;
  }

  out.add(Insight(
    id: 'train',
    kind: InsightKind.train,
    title: title,
    detail: detail,
    why: why,
    action: const InsightAction(
      kind: InsightActionKind.startWorkout,
      label: 'Start a workout',
    ),
    priority: priority,
  ));
}

/// The progression verdict for the last-trained lift in [session], or `null`
/// when no exercise had a real working set to evaluate. Returns (exerciseName,
/// result). Picks the LAST exercise in the session that has any completed set —
/// the movement the user most recently pushed.
(String, ProgressionResult)? _lastLiftProgression(WorkoutSession session) {
  for (final log in session.exercises.reversed) {
    final hasReal = log.sets.any((s) => (s.reps ?? 0) > 0);
    if (!hasReal) continue;
    final ex = _exerciseFor(log.exerciseId);
    final result = evaluateProgression(
      sets: log.sets,
      repTargetLow: kDefaultRepTargetLow,
      repTargetHigh: kDefaultRepTargetHigh,
      equipment: ex?.equipment ?? EquipmentType.bodyweight,
    );
    return (ex?.name ?? 'Last lift', result);
  }
  return null;
}

/// Look up a catalog exercise by id (null when it isn't in the seed catalog —
/// we then fall back to an honest generic name / bodyweight, never a guess).
Exercise? _exerciseFor(String id) {
  for (final ex in kExerciseCatalog) {
    if (ex.id == id) return ex;
  }
  return null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Sum one macro over [entries], returning `null` when NO entry has a real value
/// for it (so the caller shows "0 eaten" honestly against a real goal, and never
/// treats absence as a fabricated number elsewhere). Mirrors the home page.
double? _sumMacro(List<FoodLogEntry> entries, double? Function(FoodLogEntry) pick) {
  double? total;
  for (final e in entries) {
    final v = pick(e);
    if (v == null) continue;
    total = (total ?? 0) + v;
  }
  return total;
}

/// Real pantry item names that plausibly help close the goal. Conservative: a
/// small allow-list of protein-leaning keywords so we never claim an item is
/// "high protein" without a genuine basis. Only ever returns names of items that
/// truly exist in the pantry.
List<String> _relevantPantryNames(
  List<PantryItem> items, {
  required bool highProtein,
}) {
  if (!highProtein) return const [];
  final names = <String>[];
  for (final item in items) {
    final lower = item.name.toLowerCase();
    if (_proteinKeywords.any(lower.contains)) {
      names.add(item.name);
      if (names.length >= _kMaxPantryNamesInEat) break;
    }
  }
  return names;
}

/// Protein-leaning keywords — a conservative, disclosed heuristic (NOT user
/// data). Used only to decide whether to NAME a real pantry item in the EAT
/// insight; the item itself is always real.
const Set<String> _proteinKeywords = {
  'chicken', 'egg', 'yogurt', 'yoghurt', 'beef', 'steak', 'salmon', 'tuna',
  'fish', 'turkey', 'pork', 'tofu', 'tempeh', 'lentil', 'bean', 'chickpea',
  'protein', 'whey', 'cheese', 'milk', 'cottage', 'ham', 'prawn', 'shrimp',
  'quorn', 'edamame', 'skyr',
};

/// Finished sessions with a real timestamp — the only ones that count as
/// "trained". An unfinished (in-progress) session is not history.
List<WorkoutSession> _finishedSessions(List<WorkoutSession> all) =>
    all.where((s) => s.finished).toList();

/// Whole days between two instants (local), never negative. `at` in the future
/// (clock skew) reads as 0 days ago rather than a fabricated negative.
int _wholeDaysBetween(DateTime from, DateTime to) {
  final a = DateTime(from.toLocal().year, from.toLocal().month, from.toLocal().day);
  final b = DateTime(to.toLocal().year, to.toLocal().month, to.toLocal().day);
  final d = b.difference(a).inDays;
  return d < 0 ? 0 : d;
}

String _daysAgoPhrase(int days) {
  if (days <= 0) return 'today';
  if (days == 1) return 'yesterday';
  return '$days days ago';
}

/// An honest expiry phrase relative to [now] — "today", "tomorrow", "in N days",
/// or "N days ago" for an already-passed date. All derived from the real date.
String _expiryPhrase(DateTime expiry, DateTime now) {
  final days = _signedWholeDays(now, expiry);
  if (days < 0) return '${-days} day${-days == 1 ? '' : 's'} ago';
  if (days == 0) return 'today';
  if (days == 1) return 'tomorrow';
  return 'in $days days';
}

/// Signed whole days from [from] to [to] (negative when [to] is before [from]).
int _signedWholeDays(DateTime from, DateTime to) {
  final a = DateTime(from.toLocal().year, from.toLocal().month, from.toLocal().day);
  final b = DateTime(to.toLocal().year, to.toLocal().month, to.toLocal().day);
  return b.difference(a).inDays;
}

/// A short verdict phrase for the `why` line, always carrying the real number
/// when the engine gave one.
String _verdictPhrase(ProgressionResult r) {
  final n = r.nextWeightKg;
  switch (r.verdict) {
    case ProgressionVerdict.bump:
      return n != null ? 'go up to ${formatKg(n)} kg' : 'go heavier';
    case ProgressionVerdict.hold:
      return n != null ? 'hold ${formatKg(n)} kg' : 'hold';
    case ProgressionVerdict.deload:
      return n != null ? 'deload to ${formatKg(n)} kg' : 'deload';
    case ProgressionVerdict.recalibrating:
      return 'not enough data';
  }
}

/// A fuller verdict sentence for the detail line.
String _verdictSentence(ProgressionResult r) {
  final n = r.nextWeightKg;
  switch (r.verdict) {
    case ProgressionVerdict.bump:
      return n != null ? 'go up to ${formatKg(n)} kg' : "you've earned more weight";
    case ProgressionVerdict.hold:
      return n != null ? 'hold ${formatKg(n)} kg and push harder' : 'hold and push harder';
    case ProgressionVerdict.deload:
      return n != null ? 'back off to ${formatKg(n)} kg to rebuild' : 'back off to rebuild';
    case ProgressionVerdict.recalibrating:
      return 'log a working set for a suggestion';
  }
}

/// Format a number for display: whole numbers lose the ".0"; otherwise one dp.
String _fmt(double v) =>
    v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(1);

String _joinNames(List<String> names) {
  if (names.length == 1) return names.first;
  if (names.length == 2) return '${names[0]} + ${names[1]}';
  return '${names.sublist(0, names.length - 1).join(', ')} + ${names.last}';
}

String _joinReasons(List<String> parts) {
  if (parts.isEmpty) return 'worth restocking';
  if (parts.length == 1) return parts.first;
  if (parts.length == 2) return '${parts[0]} and ${parts[1]}';
  return '${parts.sublist(0, parts.length - 1).join(', ')}, and ${parts.last}';
}
