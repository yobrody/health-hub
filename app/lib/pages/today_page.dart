import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../brain/brain_providers.dart';
import '../brain/brain_section.dart';
import '../brain/insight.dart';
import '../design_system/colors.dart';
import '../design_system/components/insight_card.dart';
import '../design_system/components/progress_ring.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/motion.dart';
import '../design_system/spacing.dart';
import '../design_system/typography.dart';
import '../metrics/weigh_in_repo.dart';
import '../metrics/weight_trend.dart';
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_goals.dart';
import '../nutrition/nutrition_goals_repo.dart';
import '../nutrition/nutrition_repo.dart';
import '../nutrition/plan/meal_plan.dart';
import '../nutrition/plan/meal_plan_client.dart';
import '../nutrition/plan/meal_plan_repo.dart';
import '../onboarding/onboarding_flow.dart';
import '../pantry/pantry_glance.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';
import '../settings/settings_page.dart';
import '../widgets/log_weight_sheet.dart';
import '../widgets/nutrition_goals_editor.dart';
import 'nutrition_page.dart';
import 'plan_page.dart';
import 'weight_page.dart';

/// The daily dashboard — the flagship luxury home screen.
///
/// It leads with the **food loop** — the app's moat — made visible: a greeting,
/// a **loop strip** (Plan → Cart → Restock, live real counts), then a
/// goal-adaptive hero (the "start your loop" invitation on a fresh device, or
/// the single most-relevant NEXT action once there's real guidance), the
/// camera-first "Log a meal" action, the "For you" insights, and — DEMOTED to a
/// secondary glance below — today's calorie ring + macro rings, the weight card,
/// and a conditional "Restock soon" card. Depth is one tap away.
///
/// **Honesty is the spine.** Every value comes from REAL data:
///  * weight/goal from the [Profile] ([profileRepoProvider]);
///  * today's calories + macros summed from the [NutritionRepo]'s logged
///    entries — planned lines and null macros never fabricate a number;
///  * "Restock soon" from the pantry's REAL low/expiring/reorder-due items (the
///    pure [restockSoon] selector) — the card is omitted when nothing's due.
///
/// Anything the user hasn't provided renders as `—` ([showOrDash]) — never a
/// guessed default. There is **no macro-goal store in R1**, so the nutrition
/// rings show today's real totals with an honest "no goal set" empty state
/// rather than a fake `/2200`. There is likewise **no sleep/recovery data**, so
/// there is deliberately NO readiness card — omitted, not fabricated.
///
/// The repos default to the composition-root providers; the optional overrides
/// let widget tests inject in-memory fakes without a ProviderScope.
class TodayPage extends ConsumerStatefulWidget {
  const TodayPage({
    super.key,
    this.repo,
    this.nutritionRepo,
    this.goalsRepo,
    this.weighInRepo,
    this.pantryRepo,
    this.mealPlanRepo,
    this.onOpenPantry,
    this.onOpenGym,
    this.onOpenCart,
    this.onOpenPlan,
  });

  final ProfileRepo? repo;
  final NutritionRepo? nutritionRepo;
  final NutritionGoalsRepo? goalsRepo;
  final WeighInRepo? weighInRepo;
  final PantryRepo? pantryRepo;
  final MealPlanRepo? mealPlanRepo;

  /// Called when the pantry-glance card is tapped — opens the Fridge & Pantry
  /// (Food) page. Wired by the root shell to switch to the Food tab. When null
  /// (e.g. in isolated tests) the card still renders but tapping is a no-op.
  final VoidCallback? onOpenPantry;

  /// Switch to the Gym tab (wired by the root shell). Used by a Brain TRAIN
  /// insight's "Start a workout" action. Null in isolated tests → a no-op.
  final VoidCallback? onOpenGym;

  /// Switch to the Cart tab (wired by the root shell). Used by a Brain BUY
  /// insight's "Add to list" action (after the item is added). Null → no-op.
  final VoidCallback? onOpenCart;

  /// Open the "Plan my week" screen — the loop strip's Plan cell taps here.
  /// When null (isolated widget tests) the page defaults to its internal
  /// [_TodayPageState._openPlan], which pushes [PlanPage] wired from the
  /// composition-root providers. Tests that want to assert routing WITHOUT the
  /// Supabase-backed plan client inject a fake callback here.
  final VoidCallback? onOpenPlan;

  @override
  ConsumerState<TodayPage> createState() => _TodayPageState();
}

class _TodayPageState extends ConsumerState<TodayPage> {
  late final ProfileRepo _repo = widget.repo ?? ref.read(profileRepoProvider);
  late final NutritionRepo _nutrition =
      widget.nutritionRepo ?? ref.read(nutritionRepoProvider);
  late final NutritionGoalsRepo _goals =
      widget.goalsRepo ?? ref.read(nutritionGoalsRepoProvider);
  late final WeighInRepo _weighIns =
      widget.weighInRepo ?? ref.read(weighInRepoProvider);
  late final PantryRepo _pantry =
      widget.pantryRepo ?? ref.read(pantryRepoProvider);
  late final MealPlanRepo _mealPlan =
      widget.mealPlanRepo ?? ref.read(mealPlanRepoProvider);

  Profile _profile = const Profile();
  _DayNutrition _today = const _DayNutrition.empty();
  NutritionGoals _goalsData = const NutritionGoals();
  WeightTrend _weightTrend = WeightTrend.none;
  List<RestockItem> _restock = const [];

  /// The loop's live state, all from REAL data:
  ///  • [_planMealCount] — meals across the current plan (null = no plan yet);
  ///  • [_cartGapCount]  — how many planned ingredients the kitchen lacks;
  ///  • the restock count is [_restock].length.
  int? _planMealCount;
  int _cartGapCount = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final profile = await _repo.load();
    final foodLog = await _nutrition.all();
    final goals = await _goals.load();
    final weighInHistory = await _weighIns.all();
    final pantryItems = await _pantry.all();
    // Tolerant read (like every other load in the app): a plan-store hiccup must
    // never blank the whole Home — an unreadable/absent plan is an honest "no
    // plan yet" (null), which the loop strip renders as "Plan your week".
    MealPlan? plan;
    try {
      plan = await _mealPlan.load();
    } catch (_) {
      plan = null;
    }
    if (!mounted) return;

    // Anchor both the "today" food filter and the pantry glance to a SINGLE
    // `now`, so the two snapshots can't disagree if the clock ticks past
    // midnight between the awaits above.
    final now = DateTime.now();
    final todayEntries = _nutrition.logsForDay(foodLog, now);

    // The loop counts — all from REAL data, never fabricated. A missing plan
    // leaves the meal count null (an honest "no plan yet"), which the strip
    // renders as its "Plan your week" empty label; the cart-gap count is the
    // real diff between the plan and the kitchen (0 when there's no plan or the
    // pantry already covers it).
    final planMealCount =
        plan?.days.fold<int>(0, (n, d) => n + d.meals.length);
    final cartGaps =
        plan == null ? 0 : neededIngredients(plan, pantryItems).length;

    setState(() {
      _profile = profile;
      _today = _DayNutrition.from(todayEntries);
      _goalsData = goals;
      _weightTrend = computeWeightTrend(weighInHistory);
      _restock = restockSoon(pantryItems, now);
      _planMealCount = planMealCount;
      _cartGapCount = cartGaps;
      _loading = false;
    });
  }

  /// Open the daily-targets editor, then refresh so the rings reflect the new
  /// (or cleared) goal immediately.
  Future<void> _editGoals() async {
    final saved = await showNutritionGoalsEditor(
      context,
      repo: _goals,
      current: _goalsData,
      profile: _profile,
    );
    if (saved == true) await _reload();
  }

  /// Open the quick log-weight sheet, then refresh so the weight card + trend
  /// update immediately.
  Future<void> _logWeight() async {
    final saved = await showLogWeightSheet(
      context,
      repo: _weighIns,
      analytics: ref.read(analyticsProvider),
    );
    if (saved == true) await _reload();
  }

  /// Open the weight detail page (chart + history). Refreshes on return so the
  /// Home weight card reflects any weigh-ins logged while in the detail page.
  Future<void> _openWeightPage() async {
    await Navigator.of(context).push<void>(
      _appRoute(
        (_) => WeightPage(
          weighInRepo: _weighIns,
          profileRepo: _repo,
          analytics: ref.read(analyticsProvider),
        ),
      ),
    );
    await _reload();
  }

  /// A fade + gentle horizontal slide route for all modal pushes from Home.
  /// Duration matches [AppMotion.base] so it feels consistent with in-page
  /// element transitions. Finite — `pumpAndSettle` completes in tests.
  PageRouteBuilder<T> _appRoute<T>(WidgetBuilder builder) {
    return PageRouteBuilder<T>(
      transitionDuration: AppMotion.base,
      reverseTransitionDuration: AppMotion.base,
      pageBuilder: (context, animation, secondaryAnimation) =>
          builder(context),
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        final curved =
            CurvedAnimation(parent: animation, curve: AppMotion.enter);
        return FadeTransition(
          opacity: curved,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0.04, 0),
              end: Offset.zero,
            ).animate(curved),
            child: child,
          ),
        );
      },
    );
  }

  /// Open the existing Settings hub as a route (it left the bottom bar in the
  /// R-1 restructure). SettingsPage reads the composition-root providers via
  /// `ref`, which the pushed route inherits from the ambient ProviderScope.
  Future<void> _openSettings() async {
    await Navigator.of(context).push<void>(
      _appRoute((_) => const SettingsPage()),
    );
    // A goal reset / profile edit in Settings can change what Home shows.
    await _reload();
  }

  /// Open the existing meal-capture (Nutrition) flow as a route — it's a Home
  /// action now, not a tab. Refresh after, since logging a meal changes today's
  /// nutrition totals (and can deduct from the pantry → restock).
  Future<void> _openLogMeal() async {
    await Navigator.of(context).push<void>(
      _appRoute((_) => const NutritionPage()),
    );
    await _reload();
  }

  /// Open the agentic "Plan my week" screen as a route, wired to the SAME repos
  /// + planner client the composition root provides (mirrors [_openWeightPage]).
  /// Refreshes on return so the loop strip's plan / cart-gap counts reflect any
  /// plan generated or gaps added while inside.
  Future<void> _openPlan() async {
    await Navigator.of(context).push<void>(
      _appRoute(
        (_) => PlanPage(
          planRepo: _mealPlan,
          planClient: ref.read(mealPlanClientProvider),
          goalsRepo: _goals,
          pantryRepo: _pantry,
          groceryRepo: ref.read(groceryListRepoProvider),
          nutritionRepo: _nutrition,
          eatInService: ref.read(eatInServiceProvider),
          analytics: ref.read(analyticsProvider),
        ),
      ),
    );
    await _reload();
  }

  /// Route a Brain insight action to the REAL flow. addToCart writes the item to
  /// the real grocery list then jumps to Cart; the others navigate to where the
  /// user acts. Nothing is faked — the item genuinely lands on the Cart list.
  Future<void> _onInsightAction(InsightAction action) async {
    switch (action.kind) {
      case InsightActionKind.addToCart:
        final added = await performInsightAction(ref, action);
        if (!mounted) return;
        if (added) widget.onOpenCart?.call();
      case InsightActionKind.startWorkout:
        widget.onOpenGym?.call();
      case InsightActionKind.logMeal:
        await _openLogMeal();
      case InsightActionKind.openGoals:
        await _editGoals();
      case InsightActionKind.none:
        break;
    }
  }

  Future<void> _openOnboarding() async {
    await Navigator.of(context).push<void>(
      _appRoute((_) => OnboardingFlow(
            repo: _repo,
            onDone: () => Navigator.of(context).pop(),
          )),
    );
    await _reload();
  }

  /// All the scrollable content of the home screen. Extracted so the
  /// TweenAnimationBuilder can wrap the whole list without nesting issues.
  Widget _buildContent() {
    // The Brain's ranked home insights (most-actionable first). The TOP one is
    // promoted to the "NEXT" hero; the remainder fall to the "For you" section
    // below (which is told to skip the first so nothing duplicates). This is a
    // read of the SAME real insights the section renders — no separate source.
    final homeInsights = insightsForScreen(ref, BrainScreen.home);
    final topInsight = homeInsights.isNotEmpty ? homeInsights.first : null;

    // A genuinely fresh device: no profile, no plan, nothing eaten today. This
    // gates the "start your food loop" invitation (vs. the NEXT-action hero).
    final isBrandNew =
        _profile.isEmpty && _planMealCount == null && _today.isEmpty;

    return ListView(
      padding: AppSpacing.pagePadding,
      children: [
        // Top row: a quiet settings/profile button (top-LEFT — the rift
        // seam stays top-RIGHT, they never collide) beside the greeting.
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.space1),
              child: IconButton(
                key: const Key('home-settings-btn'),
                onPressed: _openSettings,
                tooltip: 'Settings',
                visualDensity: VisualDensity.compact,
                icon: Icon(
                  Icons.settings_outlined,
                  color: context.appColors.textSecondary,
                ),
              ),
            ),
            AppSpacing.gapH2,
            Expanded(child: _GreetingHeader(profile: _profile)),
            // Reserve the top-right corner for the rift seam (painted in
            // the Stack above the ListView) — no widget here.
            const SizedBox(width: 40),
          ],
        ),
        AppSpacing.gapV6,

        // ── The LOOP strip — the moat made visible, ALWAYS on ─────────────────
        // Plan → Cart → Restock, each a live REAL count with an honest empty
        // label. The differentiator the user sees first, every day.
        _LoopStrip(
          planMealCount: _planMealCount,
          cartGapCount: _cartGapCount,
          restockCount: _restock.length,
          onOpenPlan: widget.onOpenPlan ?? _openPlan,
          onOpenCart: widget.onOpenCart,
          onOpenRestock: widget.onOpenPantry,
        ),
        AppSpacing.gapV8,

        // ── HERO — adapts to state ────────────────────────────────────────────
        if (isBrandNew) ...[
          // A brand-new device leads with the loop invitation…
          _StartLoopCard(onStart: widget.onOpenPantry),
          AppSpacing.gapV6,
          // …and still offers the gentle profile-setup affordance (its Key is a
          // test/first-run contract). Shown right below the invitation.
          _SetupProfileCard(onTap: _openOnboarding),
          AppSpacing.gapV8,
        ] else ...[
          // If the profile is empty (but there's a plan / logged food), keep
          // the honest setup affordance available above the hero.
          if (_profile.isEmpty) ...[
            _SetupProfileCard(onTap: _openOnboarding),
            AppSpacing.gapV6,
          ],
          // The single most-relevant NEXT action, as a prominent hero card.
          // Reuses the shared InsightCard (kind badge + title + detail + its
          // action) so it's honest by construction and routes via the same
          // handler. Omitted when the Brain has nothing genuine to promote.
          if (topInsight != null) ...[
            const SectionHeader(title: 'NEXT'),
            KeyedSubtree(
              key: const Key('home-next-action'),
              child: InsightCard(
                insight: topInsight,
                onAction: _onInsightAction,
              ),
            ),
            AppSpacing.gapV8,
          ],
        ],

        // The single, camera-first primary action — snap-to-log a meal.
        FilledButton.icon(
          key: const Key('home-log-meal-btn'),
          onPressed: _openLogMeal,
          icon: const Icon(Icons.photo_camera_outlined),
          label: const Text('Log a meal'),
        ),
        AppSpacing.gapV8,

        // The Brain's "For you" section — the REMAINING personalized insights
        // (skipFirst drops the one promoted to the NEXT hero above, so nothing
        // duplicates). Renders NOTHING when there are no leftover insights
        // (BrainSection returns SizedBox.shrink), so the section — and this
        // trailing gap — simply collapse away. Keyed for tests.
        BrainSection(
          sectionKey: const Key('home-brain'),
          screen: BrainScreen.home,
          title: 'FOR YOU',
          onAction: _onInsightAction,
          trailingGap: true,
          // Only drop the top insight here when it's actually promoted to the
          // NEXT hero above (i.e. not on a brand-new device, where the hero is
          // the "start your loop" invitation and this section shows them all).
          skipFirst: !isBrandNew && topInsight != null,
        ),

        // ── Today's nutrition — DEMOTED to a secondary glance ─────────────────
        // The calorie ring + macros still live here (same honest data + keys),
        // now sized down and placed below the loop + next action rather than
        // leading — so the app reads as a food-loop tool, not a calorie counter.
        const SectionHeader(title: 'TODAY'),
        _NutritionHero(
          today: _today,
          goals: _goalsData,
          goalDirection: _profile.goalDirection,
          onEditGoals: _editGoals,
        ),
        AppSpacing.gapV8,

        SectionHeader(
          title: 'WEIGHT',
          trailing: TextButton(
            key: const Key('today-log-weight'),
            onPressed: _logWeight,
            child: const Text('Log weight'),
          ),
        ),
        _WeightCard(
          profile: _profile,
          trend: _weightTrend,
          onTap: _openWeightPage,
        ),
        AppSpacing.gapV8,

        // Restock soon — replaces BOTH the old training card AND the old
        // pantry-glance card (R-1): it's a strict superset of that glance
        // (low + expiring) plus reorder-due, so Home shows ONE calm
        // pantry-urgency surface, not two. Surfaced
        // ONLY when real pantry data has items low / expiring /
        // reorder-due; omitted entirely when nothing's due (never a
        // fabricated urgency). Tapping opens Food (and later feeds Cart).
        if (_restock.isNotEmpty) ...[
          SectionHeader(
            title: 'RESTOCK SOON',
            trailing: TextButton(
              key: const Key('today-open-restock'),
              onPressed: widget.onOpenPantry,
              child: const Text('Open'),
            ),
          ),
          _RestockSoonCard(
            items: _restock,
            onTap: widget.onOpenPantry,
          ),
          AppSpacing.gapV8,
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      // A non-animating placeholder (not a spinner): the loads resolve almost
      // immediately, and an animated indicator would keep widget-test
      // `pumpAndSettle` from ever settling.
      return const Scaffold(
        key: Key('today-page'),
        body: SizedBox.shrink(),
      );
    }

    final noAnim = MediaQuery.of(context).disableAnimations;

    return Scaffold(
      key: const Key('today-page'),
      body: SafeArea(
        child: Stack(
          children: [
            // R-5 entrance animation: the full list fades + slides up gently
            // when content first loads. Finite (TweenAnimationBuilder, not
            // repeat) so pumpAndSettle completes in widget tests. Skipped
            // entirely when reduced-motion is on.
            noAnim
                ? _buildContent()
                : TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: 1),
                    duration: AppMotion.slow,
                    curve: AppMotion.enter,
                    builder: (context, t, child) => Opacity(
                      opacity: t,
                      child: Transform.translate(
                        offset: Offset(0, (1 - t) * 16),
                        child: child,
                      ),
                    ),
                    child: _buildContent(),
                  ),
            // R2 game-entry seam — intentionally disabled/inert in R1.
            // This reserved affordance is the entry point for a future separate
            // game app; tapping it does nothing in this release.
            const Positioned(
              top: 0,
              right: 0,
              child: _RiftSeam(),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Greeting header ──────────────────────────────────────────────────────────

/// A warm, editorial greeting + today's date. Uses the profile only for the
/// time-of-day greeting (no user name field exists — so we never fabricate one).
class _GreetingHeader extends StatelessWidget {
  const _GreetingHeader({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final now = DateTime.now();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _dateLabel(now),
          style: text.labelMedium?.copyWith(
            color: colors.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        AppSpacing.gapV1,
        Text(
          _greetingFor(now),
          style: text.headlineMedium,
        ),
      ],
    );
  }

  String _greetingFor(DateTime now) {
    final h = now.hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _dateLabel(DateTime now) {
    const weekdays = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    final wd = weekdays[now.weekday - 1];
    final mo = months[now.month - 1];
    return '$wd, $mo ${now.day}'.toUpperCase();
  }
}

// ── Setup-profile card (honest empty state) ──────────────────────────────────

/// The gentle "set up your profile" affordance, shown when the profile is
/// entirely empty. Ported forward from the old page — same honesty message,
/// same [Key] so nav/first-run tests keep working.
class _SetupProfileCard extends StatelessWidget {
  const _SetupProfileCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return StatCard(
      warm: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Set up your profile', style: text.titleMedium),
          AppSpacing.gapV2,
          Text(
            'We show “—” for anything you haven’t entered — never a guessed '
            'number. Add your details to see real targets.',
            style: text.bodyMedium,
          ),
          AppSpacing.gapV4,
          FilledButton(
            key: const Key('today-setup-profile'),
            onPressed: onTap,
            child: const Text('Set up profile'),
          ),
        ],
      ),
    );
  }
}

// ── Weight card ──────────────────────────────────────────────────────────────

/// Current weight as an editorial hero number, plus a real ▲/▼ trend, goal
/// direction and goal weight.
///
/// Current weight comes from the LATEST real weigh-in ([WeightTrend.currentKg]);
/// if there are no weigh-ins yet it falls back to the profile's single
/// [weightKg] scalar. The trend delta is shown ONLY when the history supports it
/// (≥2 real weigh-ins) — with one reading we show current and no arrow, never an
/// invented trend.
class _WeightCard extends StatelessWidget {
  const _WeightCard({
    required this.profile,
    required this.trend,
    this.onTap,
  });

  final Profile profile;
  final WeightTrend trend;

  /// Optional tap handler — makes the whole card navigate to the weight detail
  /// page (chart + history). When null (e.g. in isolated tests) the card still
  /// renders but tapping is a no-op.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    // Prefer the latest real weigh-in; fall back to the profile scalar. Track
    // WHICH source so we can label it honestly — a profile scalar can be stale
    // (last edited weeks ago) and must not read as a fresh weigh-in.
    final fromWeighIn = trend.currentKg != null;
    final currentKg = trend.currentKg ?? profile.weightKg;
    final hasWeight = currentKg != null;
    final weightStr = hasWeight ? formatKg(currentKg) : '—';

    return StatCard(
      key: const Key('today-weight-card'),
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      weightStr,
                      style: AppTypography.heroNumber(
                        color: hasWeight
                            ? colors.textPrimary
                            : colors.textSecondary,
                        fontSize: 52,
                      ),
                    ),
                    if (hasWeight) ...[
                      AppSpacing.gapH2,
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          'kg',
                          style: text.titleMedium
                              ?.copyWith(color: colors.textSecondary),
                        ),
                      ),
                    ],
                    // A real ▲/▼ delta — only when ≥2 weigh-ins ground it.
                    if (trend.hasTrend) ...[
                      AppSpacing.gapH2,
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _TrendChip(trend: trend),
                      ),
                    ],
                  ],
                ),
                AppSpacing.gapV1,
                Text(
                  _subtitle(fromWeighIn),
                  style: text.bodyMedium?.copyWith(color: colors.textSecondary),
                ),
              ],
            ),
          ),
          _GoalBadge(
            goalDirection: profile.goalDirection,
            targetWeightKg: profile.targetWeightKg,
          ),
        ],
      ),
    );
  }

  /// A quiet supporting line under the hero number. [fromWeighIn] is false when
  /// the displayed number is the profile scalar (not a real weigh-in); we
  /// disclose that with a "· from profile" qualifier so a possibly-stale profile
  /// value never reads as a fresh weigh-in.
  String _subtitle(bool fromWeighIn) {
    final hasWeight = trend.currentKg != null || profile.weightKg != null;
    if (!hasWeight) return 'Log your weight to begin';
    final String base;
    final dir = profile.goalDirection;
    switch (dir) {
      case 'gain':
        base = 'Building — gaining weight';
      case 'cut':
        base = 'Cutting — losing weight';
      case 'maintain':
        base = 'Holding steady';
      default:
        base = 'Current weight';
    }
    return fromWeighIn ? base : '$base · from profile';
  }
}

/// The goal target chip on the weight card. Shows the goal weight, or a quiet
/// "no goal" state when unset — never a fabricated 72 kg.
class _GoalBadge extends StatelessWidget {
  const _GoalBadge({
    required this.goalDirection,
    required this.targetWeightKg,
  });

  final String? goalDirection;
  final double? targetWeightKg;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final hasGoal = targetWeightKg != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          'GOAL',
          style: text.labelSmall?.copyWith(color: colors.textSecondary),
        ),
        AppSpacing.gapV1,
        Text(
          hasGoal ? '${formatKg(targetWeightKg!)} kg' : '—',
          style: text.titleLarge?.copyWith(
            color: hasGoal ? colors.primaryStrong : colors.textSecondary,
          ),
        ),
      ],
    );
  }
}

/// A small ▲/▼ weight-trend chip: the net change since the earliest logged
/// weigh-in. Down (weight loss) reads green (accent); up reads in the warm
/// primary; a flat delta is a quiet dash. Never shown without a real trend.
class _TrendChip extends StatelessWidget {
  const _TrendChip({required this.trend});

  final WeightTrend trend;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    // Only ever built inside `if (trend.hasTrend)`, which guarantees a non-null
    // delta — assert it rather than `?? 0` (a fabricated 0 would read as a real
    // "no change" trend if the guard were ever removed).
    final delta = trend.deltaKg!;

    final (IconData icon, Color color) = switch (trend.direction) {
      TrendDirection.down => (Icons.arrow_downward, colors.accent),
      TrendDirection.up => (Icons.arrow_upward, colors.primaryStrong),
      _ => (Icons.remove, colors.textSecondary),
    };

    // Absolute magnitude — the arrow already carries direction.
    final magnitude = formatKg(delta.abs());

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 2),
        Text(
          '$magnitude kg',
          key: const Key('today-weight-trend'),
          style: text.labelLarge?.copyWith(color: color),
        ),
      ],
    );
  }
}

// ── Nutrition hero ───────────────────────────────────────────────────────────

/// The home centerpiece: today's calories as a big ring, three macro rings under
/// it, an honest caption, and a set/edit-goals affordance.
///
/// Modelled on the calorie-ring home that nutrition-app users already know (so
/// it's instantly familiar), wearing our own warm/serif brand. It sits directly
/// on the canvas — no card — so it reads as THE focal point, not one more tile.
///
/// **Honesty is preserved.** The big ring only fills against a REAL calorie
/// goal; with no goal it shows what you've eaten on a bare track (no fabricated
/// denominator), and `—` when nothing's logged. Each macro ring likewise fills
/// only against a real target. The "/ target kcal" line shows only when the
/// calorie goal is set.
class _NutritionHero extends StatelessWidget {
  const _NutritionHero({
    required this.today,
    required this.goals,
    required this.onEditGoals,
    this.goalDirection,
  });

  final _DayNutrition today;
  final NutritionGoals goals;
  final VoidCallback onEditGoals;

  /// The user's goal (`gain` / `cut` / `maintain` / null). Drives ONLY the tone
  /// of the caption — never the data. A gain/cut goal keeps the number-forward
  /// framing (calories/protein are their metric); maintain/null gets a calmer,
  /// less pressuring line over the SAME honest values.
  final String? goalDirection;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final eaten = today.kcal;
    final goal = goals.caloriesKcal;
    final hasGoal = goal != null && goal > 0;

    // The honest center read for the big ring:
    //  • goal set → calories REMAINING (goal − eaten, floored at 0);
    //  • no goal  → what you've eaten, or '—' when nothing is logged.
    final String center;
    if (hasGoal) {
      final remaining = goal - (eaten ?? 0);
      center = _round(remaining < 0 ? 0 : remaining);
    } else {
      center = eaten != null ? _round(eaten) : '—';
    }

    return Column(
      children: [
        // The calorie ring — now a SECONDARY glance (the loop is the hero), so
        // it's sized down from the old 208 centerpiece to a calm ~150 read.
        // Same honest fill rules.
        ProgressRing(
          key: const Key('today-calorie-ring'),
          value: eaten, // drives the arc (eaten / goal); null → bare track
          goal: goal, // null → honest empty state, never a fabricated fill
          centerLabel: center,
          unit: hasGoal ? 'kcal left' : 'kcal today',
          label: 'CALORIES',
          size: 150,
          strokeWidth: 12,
          color: colors.primaryStrong,
        ),
        AppSpacing.gapV5,
        // The three macro rings — each fills against its REAL goal, else stays
        // in the honest empty state (null goal → bare track, no fake fill).
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            ProgressRing(
              value: today.proteinG,
              goal: goals.proteinG,
              label: 'Protein',
              unit: 'g',
              color: colors.primary,
            ),
            ProgressRing(
              value: today.carbsG,
              goal: goals.carbsG,
              label: 'Carbs',
              unit: 'g',
              color: colors.primaryStrong,
            ),
            ProgressRing(
              value: today.fatG,
              goal: goals.fatG,
              label: 'Fat',
              unit: 'g',
              color: colors.accent,
            ),
          ],
        ),
        AppSpacing.gapV4,
        // Honest supporting line, plus the real calorie target when it's set.
        Text(
          _caption(),
          style: text.bodySmall,
          textAlign: TextAlign.center,
        ),
        if (hasGoal) ...[
          AppSpacing.gapV1,
          Text(
            '/ ${_round(goal)} kcal',
            style: text.titleSmall?.copyWith(color: colors.textSecondary),
          ),
        ],
        AppSpacing.gapV2,
        TextButton(
          key: const Key('today-edit-goals'),
          onPressed: onEditGoals,
          child: Text(goals.isEmpty ? 'Set daily goals' : 'Edit goals'),
        ),
      ],
    );
  }

  String _round(double v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(0);

  /// The honest supporting line: nothing logged, targets active, or an
  /// invitation to set a daily goal.
  ///
  /// Goal-adaptive TONE only (the numbers above are identical either way): a
  /// `maintain` goal gets a calmer, low-pressure line so the app doesn't nag
  /// someone who isn't chasing a number; gain/cut (and an as-yet-unset
  /// direction) keep the number-forward framing, since calories/protein are the
  /// metric they're actively tracking.
  String _caption() {
    final calm = goalDirection == 'maintain';
    if (today.isEmpty) {
      return calm ? 'Nothing logged yet — no pressure.' : 'Nothing logged yet today.';
    }
    if (goals.isEmpty) {
      return 'Tracked above — set a daily goal to see targets.';
    }
    return calm
        ? 'Tracked — no pressure, just holding steady.'
        : 'Tracked above, against your daily targets.';
  }
}

// ── Loop strip ───────────────────────────────────────────────────────────────

/// The home "loop strip" — the app's moat, made visible and ALWAYS on.
///
/// Three tappable cells across the top of Home: **Plan → Cart → Restock**, each
/// showing a live REAL count with an honest empty label:
///  • Plan    — `<N> meals` when a plan exists, else "Plan your week";
///  • Cart    — `<G> to buy` (the real plan-vs-kitchen gap), else "No gaps" (0);
///  • Restock — `<R> low` (real low/expiring/reorder-due items), else "Stocked".
///
/// **Honesty:** every count is derived only from real data (the meal plan, the
/// [neededIngredients] gap diff, the [restockSoon] selector). A 0 is shown
/// honestly as its empty label — never hidden as if unknown, never a fabricated
/// number. A missing plan leaves the meal count null → the "Plan your week"
/// invitation, not a fake "0 meals".
class _LoopStrip extends StatelessWidget {
  const _LoopStrip({
    required this.planMealCount,
    required this.cartGapCount,
    required this.restockCount,
    this.onOpenPlan,
    this.onOpenCart,
    this.onOpenRestock,
  });

  /// Meals across the current plan; `null` = no plan yet (honest empty state).
  final int? planMealCount;

  /// Real plan-vs-kitchen shopping gaps (0 when no plan or fully covered).
  final int cartGapCount;

  /// Real restock-soon items (low / expiring / reorder-due).
  final int restockCount;

  final VoidCallback? onOpenPlan;
  final VoidCallback? onOpenCart;
  final VoidCallback? onOpenRestock;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    // Plan cell: "<N> meals" or the honest "Plan your week" invitation.
    final (String planValue, String planLabel) = planMealCount == null
        ? ('Plan', 'your week')
        : ('$planMealCount', planMealCount == 1 ? 'meal' : 'meals');

    // Cart cell: "<G> to buy", or "No gaps" when there's nothing to buy (0 is
    // shown honestly, never hidden).
    final (String cartValue, String cartLabel) =
        cartGapCount == 0 ? ('No', 'gaps') : ('$cartGapCount', 'to buy');

    // Restock cell: "<R> low", or "Stocked" when nothing's due.
    final (String restockValue, String restockLabel) =
        restockCount == 0 ? ('Stocked', '') : ('$restockCount', 'low');

    return StatCard(
      child: Row(
        children: [
          Expanded(
            child: _LoopCell(
              cellKey: const Key('home-loop-plan'),
              icon: Icons.event_note_outlined,
              value: planValue,
              label: planLabel,
              color: colors.primaryStrong,
              onTap: onOpenPlan,
            ),
          ),
          _LoopDivider(color: colors.hairline),
          Expanded(
            child: _LoopCell(
              cellKey: const Key('home-loop-cart'),
              icon: Icons.shopping_basket_outlined,
              value: cartValue,
              label: cartLabel,
              color: colors.primary,
              onTap: onOpenCart,
            ),
          ),
          _LoopDivider(color: colors.hairline),
          Expanded(
            child: _LoopCell(
              cellKey: const Key('home-loop-restock'),
              icon: Icons.inventory_2_outlined,
              value: restockValue,
              label: restockLabel,
              color: colors.accent,
              onTap: onOpenRestock,
            ),
          ),
        ],
      ),
    );
  }
}

/// One tappable cell of the loop strip — an icon, a big value, a small label.
class _LoopCell extends StatelessWidget {
  const _LoopCell({
    required this.cellKey,
    required this.icon,
    required this.value,
    required this.label,
    required this.color,
    this.onTap,
  });

  final Key cellKey;
  final IconData icon;
  final String value;
  final String label;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return InkWell(
      key: cellKey,
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.space2),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.space2),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: color),
            AppSpacing.gapV2,
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: text.titleMedium?.copyWith(
                color: colors.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (label.isNotEmpty) ...[
              AppSpacing.gapV1,
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: text.labelSmall?.copyWith(color: colors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A quiet vertical hairline between loop cells.
class _LoopDivider extends StatelessWidget {
  const _LoopDivider({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Container(width: 1, height: 44, color: color);
}

// ── Start-the-loop invitation (brand-new device) ─────────────────────────────

/// The brand-new-device hero: an honest, warm invitation to START the food loop
/// (snap fridge → plan week → fill cart from the gaps). Shown only on a genuinely
/// fresh device (no profile, no plan, nothing logged); once there's real
/// guidance, the NEXT-action hero takes this slot instead.
class _StartLoopCard extends StatelessWidget {
  const _StartLoopCard({this.onStart});

  /// Opens the Food/fridge tab to add the first items — the loop's front door.
  final VoidCallback? onStart;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return StatCard(
      warm: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Start your food loop', style: text.titleMedium),
          AppSpacing.gapV2,
          Text(
            'Snap your fridge → we plan your week → fill your cart from the gaps.',
            style: text.bodyMedium,
          ),
          AppSpacing.gapV4,
          FilledButton.icon(
            key: const Key('home-start-loop'),
            onPressed: onStart,
            icon: const Icon(Icons.kitchen_outlined),
            label: const Text('Add your fridge'),
          ),
        ],
      ),
    );
  }
}

// ── Restock-soon card ────────────────────────────────────────────────────────

/// The home "Restock soon" tile — replaces the old training card (R-1). It
/// lists the pantry items that are honestly worth restocking (low / expiring /
/// reorder-due), built ONLY from real [PantryItem] fields via the pure
/// [restockSoon] selector. It is NEVER shown empty — the caller omits the whole
/// section when there's nothing due (no fabricated urgency). Tapping opens Food
/// (and later feeds the Cart).
class _RestockSoonCard extends StatelessWidget {
  const _RestockSoonCard({required this.items, this.onTap});

  final List<RestockItem> items;
  final VoidCallback? onTap;

  /// Cap the list so the card stays a calm glance, not a full inventory.
  static const int _maxShown = 4;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final shown = items.take(_maxShown).toList();
    final overflow = items.length - shown.length;

    return StatCard(
      key: const Key('home-restock-soon'),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shopping_basket_outlined,
                  size: 18, color: colors.primaryStrong),
              AppSpacing.gapH2,
              Expanded(
                // R-5: cross-fade the count text when items.length changes.
                // AnimatedSwitcher is finite — pumpAndSettle completes.
                child: AnimatedSwitcher(
                  duration: AppMotion.fast,
                  child: Text(
                    items.length == 1
                        ? '1 item to restock soon'
                        : '${items.length} items to restock soon',
                    key: ValueKey(items.length),
                    style: text.titleSmall,
                  ),
                ),
              ),
              Icon(Icons.chevron_right, color: colors.textSecondary),
            ],
          ),
          AppSpacing.gapV3,
          for (final r in shown) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.space1),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      r.item.name,
                      style: text.bodyMedium
                          ?.copyWith(color: colors.textPrimary),
                    ),
                  ),
                  Text(
                    _reasonLabel(r),
                    style: text.bodySmall
                        ?.copyWith(color: colors.textSecondary),
                  ),
                ],
              ),
            ),
          ],
          if (overflow > 0)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.space1),
              child: Text(
                '+$overflow more',
                style: text.bodySmall?.copyWith(color: colors.textSecondary),
              ),
            ),
        ],
      ),
    );
  }

  /// The honest reason(s) an item surfaced — expiring / low / reorder-due.
  String _reasonLabel(RestockItem r) {
    final parts = <String>[
      if (r.isExpiring) 'expiring',
      if (r.isLow) 'low',
      if (r.isReorderDue) 'reorder due',
    ];
    return parts.join(' · ');
  }
}

// ── Day-nutrition aggregate ──────────────────────────────────────────────────

/// Today's summed intake. Each total is `null` when NO logged entry contributed
/// a real value for that macro (so the UI shows `—`, never a fabricated `0`).
/// This sums the REAL food log ([FoodLogEntry]s from [NutritionRepo]): a meal
/// the user logged from a plan is a genuine logged entry and IS counted here —
/// only an un-logged planned line (which never becomes a [FoodLogEntry]) is
/// absent, because it was never eaten.
class _DayNutrition {
  const _DayNutrition({
    this.kcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
  });

  const _DayNutrition.empty()
      : kcal = null,
        proteinG = null,
        carbsG = null,
        fatG = null;

  final double? kcal;
  final double? proteinG;
  final double? carbsG;
  final double? fatG;

  /// True when nothing with real macros has been logged today.
  bool get isEmpty =>
      kcal == null && proteinG == null && carbsG == null && fatG == null;

  /// Sum a day's [entries]. A macro total is the sum of the entries that have a
  /// real (non-null) value for it; if NONE do, the total stays `null` (honest
  /// "not tracked"), never a fabricated `0`.
  factory _DayNutrition.from(List<FoodLogEntry> entries) {
    double? kcal, protein, carbs, fat;

    void add(double? total, double? v, void Function(double) set) {
      if (v == null) return;
      set((total ?? 0) + v);
    }

    for (final e in entries) {
      add(kcal, e.kcal, (x) => kcal = x);
      add(protein, e.proteinG, (x) => protein = x);
      add(carbs, e.carbsG, (x) => carbs = x);
      add(fat, e.fatG, (x) => fat = x);
    }

    return _DayNutrition(
      kcal: kcal,
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
    );
  }
}

// ── _RiftSeam ────────────────────────────────────────────────────────────────

/// The hidden R2 game-entry seam, positioned top-right on the home screen.
///
/// In Release 1 this is INERT — tapping does nothing user-facing. It is a
/// deliberately subtle affordance: a small, quiet icon that doesn't stand out.
/// The drag / pack-tear / rift animation and the game itself are built in R2.
///
/// Key: 'home-rift-seam' — present in R1 so the test can assert it exists and
/// that tapping it does not navigate or crash.
class _RiftSeam extends StatelessWidget {
  // ignore: avoid_unused_constructor_parameters — kept to match StatelessWidget convention
  const _RiftSeam();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    // Very subtle: low opacity + a small icon that reads as decorative, not
    // actionable. Easy to miss — that's intentional.
    //
    // Excluded from semantics: the seam is purely decorative and inert in R1
    // (onTap == null). Screen readers skip it entirely so users aren't
    // confused by a non-interactive element with no action.
    return ExcludeSemantics(
      child: GestureDetector(
        key: const Key('home-rift-seam'),
        // R1: inert tap — no navigation, no feedback, no side-effects.
        onTap: null,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.space4),
          child: Opacity(
            opacity: 0.18,
            child: Icon(
              Icons.blur_on_outlined,
              size: 20,
              color: colors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}
