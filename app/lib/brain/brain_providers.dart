/// The Brain's provider layer — gathers [BrainInputs] from the REAL repos and
/// exposes the computed insights, filtered per screen.
///
/// The engine ([computeInsights]) is pure; THIS is the impure edge that reads
/// the composition-root repos (goals, nutrition, pantry, workouts, weigh-ins,
/// profile), assembles a single consistent snapshot anchored to ONE `now`, and
/// runs the engine over it. Every provider is overridable in tests via
/// `ProviderScope(overrides: [...])`.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import 'brain.dart';
import 'insight.dart';

/// The screens the Brain weaves into. Each surfaces a slice of the insights by
/// kind (Home = the top few of any kind).
enum BrainScreen { home, food, nutrition, gym, cart }

/// Gather the user's real state into a single [BrainInputs] snapshot.
///
/// Anchors today's food filter to ONE `now` so the snapshot can't disagree with
/// itself if the clock ticks past midnight between awaits. A `FutureProvider` so
/// screens can await it and show nothing (no fabricated insight) until real data
/// has loaded.
final brainInputsProvider = FutureProvider<BrainInputs>((ref) async {
  final goalsRepo = ref.watch(nutritionGoalsRepoProvider);
  final nutritionRepo = ref.watch(nutritionRepoProvider);
  final pantryRepo = ref.watch(pantryRepoProvider);
  final workoutRepo = ref.watch(workoutRepoProvider);
  final weighInRepo = ref.watch(weighInRepoProvider);
  final profileRepo = ref.watch(profileRepoProvider);

  final goals = await goalsRepo.load();
  final allFood = await nutritionRepo.all();
  final pantry = await pantryRepo.all();
  final workouts = await workoutRepo.all();
  final weighIns = await weighInRepo.all();
  final profile = await profileRepo.load();

  final now = DateTime.now();
  final todaysLog = nutritionRepo.logsForDay(allFood, now);

  return BrainInputs(
    now: now,
    goals: goals,
    todaysLog: todaysLog,
    pantryItems: pantry,
    workoutHistory: workouts,
    weighIns: weighIns,
    profile: profile,
  );
});

/// The full, ordered list of insights for the current real state. Empty while
/// [brainInputsProvider] is still loading or errored — never a fabricated stand-in.
final insightsProvider = Provider<List<Insight>>((ref) {
  final asyncInputs = ref.watch(brainInputsProvider);
  return asyncInputs.maybeWhen(
    data: computeInsights,
    orElse: () => const <Insight>[],
  );
});

/// The insights to surface on [screen], filtered by kind:
///  • home → the top few across all kinds (already priority-ordered);
///  • food / cart → BUY (restock) insights;
///  • nutrition → EAT insights;
///  • gym → TRAIN insights.
///
/// A [InsightKind.setup] prompt belongs to the kind it stands in for: the EAT
/// setup shows on the Nutrition screen, the TRAIN setup on Gym — exactly where
/// the real insight would have appeared. Home is the exception: it shows only
/// REAL insights (setup prompts are excluded there, since Home already has its
/// own setup affordances), so its "For you" section is omitted entirely when
/// there is nothing genuine to show.
List<Insight> insightsForScreen(WidgetRef ref, BrainScreen screen) {
  final all = ref.watch(insightsProvider);
  switch (screen) {
    case BrainScreen.home:
      // The top few REAL insights across all kinds (most-actionable first).
      // Setup prompts are deliberately excluded here — Home already carries
      // dedicated setup affordances (the "set up your profile" card, the
      // "Set goals" header button), so the "For you" section shows only genuine
      // guidance and is OMITTED entirely when there is none (never filler).
      return all
          .where((i) => i.kind != InsightKind.setup)
          .take(_kHomeMaxInsights)
          .toList();
    case BrainScreen.food:
    case BrainScreen.cart:
      return all.where((i) => i.kind == InsightKind.buy).toList();
    case BrainScreen.nutrition:
      return all
          .where((i) => i.kind == InsightKind.eat || _isEatSetup(i))
          .toList();
    case BrainScreen.gym:
      return all
          .where((i) => i.kind == InsightKind.train || _isTrainSetup(i))
          .toList();
  }
}

/// How many insights the Home "For you" section shows — a calm glance, not a
/// dump. A disclosed product constant, not user data.
const int _kHomeMaxInsights = 4;

/// The EAT setup prompt has a stable id — it stands in for an EAT insight, so it
/// surfaces on the Nutrition screen (and Home).
bool _isEatSetup(Insight i) =>
    i.kind == InsightKind.setup && i.id == 'eat-setup';

/// The TRAIN setup prompt stands in for a TRAIN insight → surfaces on Gym (+Home).
bool _isTrainSetup(Insight i) =>
    i.kind == InsightKind.setup && i.id == 'train-setup';

/// Perform the REAL side-effect of an insight [action] that mutates data (only
/// [InsightActionKind.addToCart] does — it adds the real item name to the real
/// grocery list). Returns true when something was actually written, so the
/// caller can confirm + refresh. Navigation-only actions (start-workout,
/// log-meal, open-goals) do nothing here — the screen handles their routing.
///
/// This is the write half of "actions do real things": the item lands on the
/// same [groceryListRepoProvider] the Cart page reads, so the flow between
/// screens is genuine, not faked.
Future<bool> performInsightAction(WidgetRef ref, InsightAction action) async {
  if (action.kind == InsightActionKind.addToCart) {
    final name = action.payload;
    if (name == null || name.trim().isEmpty) return false;
    await ref.read(groceryListRepoProvider).add(name);
    return true;
  }
  return false;
}
