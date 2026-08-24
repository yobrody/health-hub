import 'package:flutter/material.dart';

import '../cart/grocery_list_repo.dart';
import '../design_system/colors.dart';
import '../design_system/components/app_button.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../meals/eat_in_service.dart';
import '../meals/meal_composition.dart';
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_goals.dart';
import '../nutrition/nutrition_goals_repo.dart';
import '../nutrition/nutrition_repo.dart';
import '../nutrition/plan/meal_plan.dart';
import '../nutrition/plan/meal_plan_client.dart';
import '../nutrition/plan/meal_plan_repo.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';

/// "Plan my week" — the agentic loop's face.
///
/// Generates a weekly meal plan from the user's REAL goals + pantry (via the
/// [MealPlanClient]), shows it, and turns the gap between the plan and the
/// kitchen ([neededIngredients]) into a one-tap grocery cart.
///
/// Honesty travels through every state: no goal → "set your goal first" (never a
/// guessed plan); the planner failing → an honest "couldn't plan" (never a
/// fabricated week); meals are marked `~` (estimates); "you have everything"
/// when the pantry already covers the plan.
///
/// Constructor-injected repos/client (like [TransformationPage]) so it renders
/// deterministically in tests + goldens with fakes.
class PlanPage extends StatefulWidget {
  const PlanPage({
    super.key,
    required this.planRepo,
    required this.planClient,
    required this.goalsRepo,
    required this.pantryRepo,
    required this.groceryRepo,
    required this.nutritionRepo,
    required this.eatInService,
    this.now,
  });

  final MealPlanRepo planRepo;
  final MealPlanClient planClient;
  final NutritionGoalsRepo goalsRepo;
  final PantryRepo pantryRepo;
  final GroceryListRepo groceryRepo;
  final NutritionRepo nutritionRepo;
  final EatInService eatInService;

  /// Injectable clock so goldens/tests are deterministic.
  final DateTime? now;

  @override
  State<PlanPage> createState() => _PlanPageState();
}

class _PlanPageState extends State<PlanPage> {
  bool _loading = true;
  bool _generating = false;
  bool _addedToCart = false;
  String? _error;

  NutritionGoals _goals = const NutritionGoals();
  List<PantryItem> _pantry = const [];
  MealPlan? _plan;

  /// Meals already logged this session (key `dayIndex:mealIndex`) so we don't
  /// double-log or double-deduct.
  final Set<String> _loggedMeals = {};

  /// Captured ONCE (not recomputed per generate) so the week's start can't shift
  /// under the app across a midnight boundary mid-session.
  late final DateTime _weekStart;

  @override
  void initState() {
    super.initState();
    final n = widget.now ?? DateTime.now();
    _weekStart = DateTime(n.year, n.month, n.day);
    _load();
  }

  Future<void> _load() async {
    final goals = await widget.goalsRepo.load();
    final pantry = await widget.pantryRepo.all();
    final plan = await widget.planRepo.load();
    if (!mounted) return;
    setState(() {
      _goals = goals;
      _pantry = pantry;
      _plan = plan;
      _loading = false;
    });
  }

  /// The user must have at least a calorie target — otherwise a plan would be a
  /// guess, which the app never shows.
  bool get _hasGoal => _goals.caloriesKcal != null;

  static const _planFailed =
      "Couldn't build a plan right now. Please try again in a moment.";

  Future<void> _generate() async {
    setState(() {
      _generating = true;
      _error = null;
      _addedToCart = false;
    });
    try {
      // Re-read fresh goals + pantry so we plan against the CURRENT kitchen, not
      // a snapshot taken when the page opened (else we could tell you to buy
      // something you've since added).
      final goals = await widget.goalsRepo.load();
      final pantry = await widget.pantryRepo.all();
      if (!mounted) return;
      setState(() {
        _goals = goals;
        _pantry = pantry;
      });

      final plan = await widget.planClient.planWeek(
        goals: goals,
        pantry: pantry,
        weekStart: _weekStart,
      );
      if (!mounted) return;
      if (plan == null) {
        setState(() => _error = _planFailed); // honest failure, never fabricated.
        return;
      }
      await widget.planRepo.save(plan);
      if (!mounted) return;
      setState(() => _plan = plan);
    } catch (_) {
      // A persist/read failure must not fabricate a plan — surface it honestly.
      if (mounted) setState(() => _error = _planFailed);
    } finally {
      // Always clear the spinner, even if save threw (else it spins forever).
      if (mounted) setState(() => _generating = false);
    }
  }

  Future<void> _addGapsToCart(List<NeededIngredient> gaps) async {
    for (final g in gaps) {
      await widget.groceryRepo.add(g.name);
    }
    if (!mounted) return;
    setState(() => _addedToCart = true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(gaps.length == 1
            ? 'Added 1 item to your cart'
            : 'Added ${gaps.length} items to your cart'),
      ),
    );
  }

  /// Log a planned meal: record its macros to the food log (counts toward Today)
  /// AND deduct its ingredients from the pantry — the loop's "deduct as you eat"
  /// arrow. The food log always lands; the deduction is best-effort + honest (a
  /// shortfall is surfaced, never hidden). After deducting we re-read the pantry
  /// so the shopping list stays truthful.
  Future<void> _logMeal(String key, PlanMeal meal) async {
    final at = widget.now ?? DateTime.now();
    final entry = FoodLogEntry(
      id: 'food-${DateTime.now().microsecondsSinceEpoch}',
      name: meal.name,
      at: at,
      kcal: meal.kcal,
      proteinG: meal.proteinG,
      carbsG: meal.carbsG,
      fatG: meal.fatG,
      tier: AccuracyTier.estimate, // a planned meal is an estimate until logged.
      source: 'plan',
    );

    EatInOutcome? outcome;
    final deductions = resolveDeductions(meal, _pantry);
    if (deductions.isNotEmpty) {
      final comp = MealComposition(
        id: 'meal-${DateTime.now().microsecondsSinceEpoch}',
        name: meal.name,
        ingredients: [
          for (final d in deductions)
            Ingredient(pantryItemId: d.pantryItemId, grams: d.grams),
        ],
      );
      // The food log must land regardless; the deduction is best-effort.
      try {
        outcome = await widget.eatInService.eatMeal(comp);
      } catch (_) {
        outcome = null;
      }
    }
    await widget.nutritionRepo.add(entry);
    if (!mounted) return;
    setState(() => _loggedMeals.add(key));

    // Re-read the pantry so the shopping list reflects what we just consumed.
    final pantry = await widget.pantryRepo.all();
    if (!mounted) return;
    setState(() => _pantry = pantry);

    final short = outcome?.shortfallByItemId.length ?? 0;
    final msg = outcome != null && outcome.hadShortfall
        ? 'Logged — short on $short ingredient${short == 1 ? '' : 's'}'
        : (deductions.isEmpty
            ? 'Logged to today'
            : 'Logged + deducted from your kitchen');
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      key: const Key('plan-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: Text('Plan my week',
            style: text.titleLarge?.copyWith(color: colors.textPrimary)),
      ),
      body: _loading
          ? const Center(child: SizedBox.shrink())
          : ListView(
              padding: AppSpacing.pagePadding,
              children: _buildBody(colors, text),
            ),
    );
  }

  List<Widget> _buildBody(AppColors colors, TextTheme text) {
    if (!_hasGoal) return [_needsGoalCard(colors, text)];
    if (_plan == null) return _emptyState(colors, text);
    return _planView(colors, text, _plan!);
  }

  // ── No-goal honest state ────────────────────────────────────────────────────

  Widget _needsGoalCard(AppColors colors, TextTheme text) {
    return StatCard(
      key: const Key('plan-needs-goal'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Set your goal first',
              style: text.titleMedium?.copyWith(color: colors.textPrimary)),
          AppSpacing.gapV2,
          Text(
            'A weekly plan is built around your real calorie + macro targets. '
            'Set them on the Goals page and come back — we never plan against a '
            'guess.',
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
        ],
      ),
    );
  }

  // ── Empty state (has goal, no plan) ─────────────────────────────────────────

  List<Widget> _emptyState(AppColors colors, TextTheme text) {
    return [
      Icon(Icons.auto_awesome, color: colors.primaryStrong, size: 32),
      AppSpacing.gapV4,
      Text('Plan your week in one tap',
          style: text.headlineSmall?.copyWith(color: colors.textPrimary)),
      AppSpacing.gapV2,
      Text(
        'We build a 7-day plan around your goals, preferring what you already '
        'have — then turn the gaps into your grocery cart.',
        style: text.bodyMedium?.copyWith(color: colors.textSecondary),
      ),
      AppSpacing.gapV6,
      _primaryButton(
        key: const Key('plan-generate-btn'),
        label: 'Plan my week',
        busy: _generating,
        onPressed: _generating ? null : _generate,
      ),
      if (_error != null) ...[
        AppSpacing.gapV4,
        _errorText(colors, text),
      ],
    ];
  }

  // ── Plan view ───────────────────────────────────────────────────────────────

  List<Widget> _planView(AppColors colors, TextTheme text, MealPlan plan) {
    final gaps = neededIngredients(plan, _pantry);
    return [
      _shoppingCard(colors, text, gaps),
      AppSpacing.gapV8,
      const SectionHeader(title: 'YOUR WEEK'),
      for (var i = 0; i < plan.days.length; i++) ...[
        _dayCard(colors, text, plan.days[i], i),
        AppSpacing.gapV4,
      ],
      AppSpacing.gapV2,
      AppButtonRegenerate(
        busy: _generating,
        onPressed: _generating ? null : _generate,
      ),
      if (_error != null) ...[
        AppSpacing.gapV4,
        _errorText(colors, text),
      ],
    ];
  }

  Widget _shoppingCard(
      AppColors colors, TextTheme text, List<NeededIngredient> gaps) {
    return StatCard(
      key: const Key('plan-shopping-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shopping_basket_outlined,
                  size: 18, color: colors.primaryStrong),
              AppSpacing.gapH2,
              Text('Shopping list',
                  style: text.titleMedium?.copyWith(color: colors.textPrimary)),
            ],
          ),
          AppSpacing.gapV3,
          if (gaps.isEmpty)
            Text('You already have everything this plan needs. ✓',
                key: const Key('plan-no-gaps'),
                style: text.bodyMedium?.copyWith(color: colors.textSecondary))
          else ...[
            Text(
              gaps.length == 1
                  ? '1 thing to buy — the rest is in your kitchen.'
                  : '${gaps.length} things to buy — the rest is in your kitchen.',
              style: text.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
            AppSpacing.gapV3,
            for (final g in gaps) _gapRow(colors, text, g),
            AppSpacing.gapV4,
            _primaryButton(
              key: const Key('plan-add-to-cart-btn'),
              label: _addedToCart ? 'Added to cart ✓' : 'Add gaps to cart',
              onPressed: _addedToCart ? null : () => _addGapsToCart(gaps),
            ),
          ],
        ],
      ),
    );
  }

  Widget _gapRow(AppColors colors, TextTheme text, NeededIngredient g) {
    // Disclose grams-on-hand for a shortfall; an unquantified need shows no
    // fabricated amount.
    final detail = switch (g.coverage) {
      IngredientCoverage.short =>
        'have ${_g(g.gramsOnHand)}, need ${_g(g.gramsNeeded)}',
      IngredientCoverage.absent =>
        g.gramsNeeded != null ? 'need ${_g(g.gramsNeeded)}' : null,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.space2),
      child: Row(
        children: [
          Icon(Icons.circle, size: 6, color: colors.primaryStrong),
          AppSpacing.gapH3,
          Expanded(
            child: Text(g.name,
                style: text.bodyMedium?.copyWith(color: colors.textPrimary)),
          ),
          if (detail != null)
            Text(detail,
                style: text.bodySmall?.copyWith(color: colors.textSecondary)),
        ],
      ),
    );
  }

  Widget _dayCard(AppColors colors, TextTheme text, PlanDay day, int index) {
    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(_dayLabel(day.date, index),
                    style: text.labelMedium?.copyWith(
                      color: colors.primaryStrong,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                    )),
              ),
              _dayTotalLabel(colors, text, day),
            ],
          ),
          AppSpacing.gapV3,
          for (var i = 0; i < day.meals.length; i++) ...[
            if (i > 0) AppSpacing.gapV3,
            _mealRow(colors, text, day.meals[i], '$index:$i'),
          ],
        ],
      ),
    );
  }

  /// The day's total kcal vs the goal — the honest "does this day hit my target"
  /// glance. Sums only meals with a known kcal; if any is missing it prefixes
  /// `≥` (the real total is at least this). Omitted when nothing sums.
  Widget _dayTotalLabel(AppColors colors, TextTheme text, PlanDay day) {
    final known = day.meals.map((m) => m.kcal).whereType<double>();
    if (known.isEmpty) return const SizedBox.shrink();
    final sum = known.fold<double>(0, (a, b) => a + b).round();
    final anyMissing = day.meals.any((m) => m.kcal == null);
    final goal = _goals.caloriesKcal;
    final label = goal != null
        ? '${anyMissing ? '≥' : ''}$sum / ${goal.round()} kcal'
        : '${anyMissing ? '≥' : ''}$sum kcal';
    return Text(label,
        style: text.labelMedium?.copyWith(color: colors.textSecondary));
  }

  Widget _mealRow(
      AppColors colors, TextTheme text, PlanMeal meal, String key) {
    final kcal = meal.kcal;
    // `~` marks an estimate; a missing kcal shows `—`, never a fabricated 0.
    final kcalLabel = kcal == null
        ? '—'
        : '${meal.tier == AccuracyTier.estimate ? '~' : ''}${kcal.round()} kcal';
    final logged = _loggedMeals.contains(key);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${_slotLabel(meal.slot)} · ${meal.name}',
                      style: text.bodyMedium
                          ?.copyWith(color: colors.textPrimary)),
                  if (meal.ingredients.isNotEmpty)
                    Text(
                      meal.ingredients.map((i) => i.name).join(', '),
                      style: text.bodySmall
                          ?.copyWith(color: colors.textSecondary),
                    ),
                ],
              ),
            ),
            AppSpacing.gapH3,
            Text(kcalLabel,
                style: text.bodySmall?.copyWith(color: colors.textSecondary)),
          ],
        ),
        // A quiet per-meal action — "Log" eats the meal (deducts pantry + logs
        // macros). The one solid-orange primary stays "Add gaps to cart".
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: Key('plan-log-meal-$key'),
            onPressed: logged ? null : () => _logMeal(key, meal),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.space1, vertical: 0),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              foregroundColor: colors.primaryStrong,
            ),
            child: Text(logged ? 'Logged ✓' : 'Log this meal',
                style: text.labelMedium?.copyWith(color: colors.primaryStrong)),
          ),
        ),
      ],
    );
  }

  Widget _errorText(AppColors colors, TextTheme text) => Text(
        _error!,
        key: const Key('plan-error'),
        style: text.bodyMedium
            ?.copyWith(color: Theme.of(context).colorScheme.error),
      );

  Widget _primaryButton({
    required Key key,
    required String label,
    required VoidCallback? onPressed,
    bool busy = false,
  }) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        key: key,
        onPressed: onPressed,
        child: busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2))
            : Text(label),
      ),
    );
  }

  // ── Labels ──────────────────────────────────────────────────────────────────

  static const _weekdays = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  String _dayLabel(DateTime date, int index) {
    final weekday = _weekdays[(date.weekday - 1) % 7].toUpperCase();
    return 'DAY ${index + 1} · $weekday';
  }

  String _slotLabel(MealSlot slot) => switch (slot) {
        MealSlot.breakfast => 'Breakfast',
        MealSlot.lunch => 'Lunch',
        MealSlot.dinner => 'Dinner',
        MealSlot.snack => 'Snack',
      };

  static String _g(double? grams) => grams == null ? '—' : '${grams.round()} g';
}

/// The quiet "regenerate" secondary action (tonal — not a second orange fill).
class AppButtonRegenerate extends StatelessWidget {
  const AppButtonRegenerate({super.key, required this.onPressed, this.busy = false});

  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        key: const Key('plan-regenerate-btn'),
        onPressed: onPressed,
        style: AppButtons.secondaryTonal(
          colors,
          text,
          onDark: Theme.of(context).brightness == Brightness.dark,
        ),
        child: busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Regenerate plan'),
      ),
    );
  }
}
