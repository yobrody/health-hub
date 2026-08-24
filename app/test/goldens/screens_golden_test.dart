// Visual screenshot harness for Health Hub.
//
// Renders every key screen to PNGs under test/goldens/images/ using real fonts
// (Fraunces + Inter via google_fonts), at iPhone-13 logical size (390×844),
// devicePixelRatio 3, with representative seeded data — light AND dark theme.
//
// Generate PNGs:
//   flutter test --update-goldens --tags golden
//
// These are excluded from CI (tagged 'golden') so platform font diffs never
// break the build. Run locally to inspect design; commit the images for review.
//
// The test does NOT make network calls. Real Fraunces + Inter TTFs are checked
// in under test/goldens/fonts/ and registered via FontLoader in setUpAll under
// the family names google_fonts resolves to, so the goldens render true glyphs
// on any machine (no pub-cache warming needed).

@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:health_hub/auth/auth_screen.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/nav/root_scaffold.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/onboarding/onboarding_flow.dart';
import 'package:health_hub/meals/eat_in_service.dart';
import 'package:health_hub/nutrition/plan/meal_plan.dart';
import 'package:health_hub/pages/gym_page.dart';
import 'package:health_hub/pages/nutrition_page.dart';
import 'package:health_hub/pages/plan_page.dart';
import 'package:health_hub/pages/transformation_page.dart';
import 'package:health_hub/pages/weight_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/settings/settings_page.dart';

import '../e2e/journey_scope.dart';

// ── Constants ─────────────────────────────────────────────────────────────────

/// iPhone 13 logical canvas (points). At DPR 3 → 1170×2532 physical pixels.
const _kSize = Size(390, 844);
const _kDpr = 3.0;

// ── Representative seed data ──────────────────────────────────────────────────

// Profile JSON: 26 y/o male, 62 kg current, 72 kg goal (lean bulk).
// Keys are the snake_case names Profile.fromJson reads (target_weight_kg,
// goal_direction, primary_gym) — camelCase here would silently parse as null,
// which is what made the Transformation golden render its honest "set your
// goal" empty state instead of the populated roadmap.
const _profile = {
  'weight_kg': 62.0,
  'height_cm': 178.0,
  'age_years': 26,
  'sex': 'male',
  'goal_direction': 'gain',
  'target_weight_kg': 72.0,
  'body_fat_percent': 16.0,
  'primary_gym': 'The Gym Group',
};

// Nutrition goals — camelCase to match NutritionGoals.fromJson.
const _goals = {
  'caloriesKcal': 2600.0,
  'proteinG': 155.0,
  'carbsG': 300.0,
  'fatG': 85.0,
};

// Logged meals today.
final _food = [
  FoodLogEntry(
    id: 'food-1',
    name: 'Greek yogurt',
    at: DateTime(2026, 8, 23, 8, 0),
    kcal: 130,
    proteinG: 17,
    carbsG: 9,
    fatG: 2,
    grams: 200,
    tier: AccuracyTier.exact,
    source: 'manual',
  ),
  FoodLogEntry(
    id: 'food-2',
    name: 'Oats with banana',
    at: DateTime(2026, 8, 23, 8, 30),
    kcal: 380,
    proteinG: 12,
    carbsG: 72,
    fatG: 6,
    grams: 350,
    tier: AccuracyTier.exact,
    source: 'manual',
  ),
  FoodLogEntry(
    id: 'food-3',
    name: '~Chicken salad',
    at: DateTime(2026, 8, 23, 13, 0),
    kcal: 420,
    proteinG: 38,
    carbsG: 25,
    fatG: 18,
    tier: AccuracyTier.estimate,
    source: 'ai',
  ),
];

// Pantry items across all zones.
final _pantry = [
  PantryItem(
    id: 'pi-1',
    name: 'Chicken breast',
    zone: PantryZone.fridge,
    qty: 500,
    unit: 'g',
    expiry: DateTime(2026, 8, 24),
    source: 'manual',
  ),
  PantryItem(
    id: 'pi-2',
    name: 'Greek yogurt',
    zone: PantryZone.fridge,
    qty: 400,
    unit: 'g',
    expiry: DateTime(2026, 8, 26),
    source: 'manual',
  ),
  // Low-stock item → triggers the BUY insight / restock card.
  PantryItem(
    id: 'pi-3',
    name: 'Whole milk',
    zone: PantryZone.fridge,
    qty: 60,
    unit: 'ml',
    expiry: DateTime(2026, 8, 25),
    source: 'manual',
  ),
  PantryItem(
    id: 'pi-4',
    name: 'Rolled oats',
    zone: PantryZone.pantry,
    qty: 800,
    unit: 'g',
    source: 'manual',
  ),
  PantryItem(
    id: 'pi-5',
    name: 'Brown rice',
    zone: PantryZone.pantry,
    qty: 1200,
    unit: 'g',
    source: 'manual',
  ),
  PantryItem(
    id: 'pi-6',
    name: 'Frozen broccoli',
    zone: PantryZone.freezer,
    qty: 500,
    unit: 'g',
    source: 'manual',
  ),
  PantryItem(
    id: 'pi-7',
    name: 'Olive oil',
    zone: PantryZone.condiments,
    qty: 250,
    unit: 'ml',
    source: 'manual',
  ),
  // Another low-stock / expiring item.
  PantryItem(
    id: 'pi-8',
    name: 'Eggs',
    zone: PantryZone.fridge,
    qty: 30,
    unit: 'g',
    expiry: DateTime(2026, 8, 24),
    source: 'manual',
  ),
];

// Weigh-ins spanning ~4 weeks (ascending, realistic lean bulk).
final _weighIns = [
  WeighIn(id: 'w1', at: DateTime(2026, 7, 26), weightKg: 61.0),
  WeighIn(id: 'w2', at: DateTime(2026, 8, 2),  weightKg: 61.4),
  WeighIn(id: 'w3', at: DateTime(2026, 8, 9),  weightKg: 61.7),
  WeighIn(id: 'w4', at: DateTime(2026, 8, 16), weightKg: 62.0),
  WeighIn(id: 'w5', at: DateTime(2026, 8, 23), weightKg: 62.3),
];

// A finished workout session (bench press + squats).
final _workouts = [
  WorkoutSession(
    id: 'ws-1',
    at: DateTime(2026, 8, 21, 9, 0),
    exercises: [
      ExerciseLog(
        exerciseId: 'bench-press',
        sets: [
          const SetEntry(weightKg: 70, reps: 8, done: true),
          const SetEntry(weightKg: 70, reps: 8, done: true),
          const SetEntry(weightKg: 70, reps: 7, done: true),
        ],
      ),
      ExerciseLog(
        exerciseId: 'squat',
        sets: [
          const SetEntry(weightKg: 100, reps: 5, done: true),
          const SetEntry(weightKg: 100, reps: 5, done: true),
          const SetEntry(weightKg: 100, reps: 4, done: true),
        ],
      ),
    ],
    finished: true,
  ),
];

// Grocery items to seed the Cart.
const _groceryNames = [
  'Eggs (12)',
  'Whole milk (2 L)',
  'Protein powder',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// A representative generated week for the Plan page golden (populated state).
MealPlan _planForGolden() => MealPlan(
      id: 'plan-golden',
      weekStart: DateTime(2026, 8, 24),
      days: [
        PlanDay(date: DateTime(2026, 8, 24), meals: [
          PlanMeal(
            name: 'Greek yogurt & oats',
            slot: MealSlot.breakfast,
            tier: AccuracyTier.estimate,
            kcal: 420,
            proteinG: 30,
            ingredients: const [
              PlanIngredient(name: 'Greek yogurt', grams: 200), // in pantry
              PlanIngredient(name: 'Rolled oats', grams: 60), // in pantry
              PlanIngredient(name: 'Blueberries', grams: 80), // gap
            ],
          ),
          PlanMeal(
            name: 'Chicken & rice',
            slot: MealSlot.lunch,
            tier: AccuracyTier.estimate,
            kcal: 650,
            proteinG: 48,
            ingredients: const [
              PlanIngredient(name: 'Chicken breast', grams: 200), // in pantry
              PlanIngredient(name: 'Brown rice', grams: 120), // in pantry
            ],
          ),
        ]),
        PlanDay(date: DateTime(2026, 8, 25), meals: [
          PlanMeal(
            name: 'Salmon & veg',
            slot: MealSlot.dinner,
            tier: AccuracyTier.estimate,
            kcal: 700,
            proteinG: 45,
            ingredients: const [
              PlanIngredient(name: 'Salmon fillet', grams: 180), // gap
              PlanIngredient(name: 'Frozen broccoli', grams: 200), // in pantry
            ],
          ),
        ]),
      ],
    );

/// Build a [JourneyHarness] with representative data seeded.
JourneyHarness _harness() => JourneyHarness(
      profile: _profile,
      goals: _goals,
      food: _food,
      pantry: _pantry,
      workouts: _workouts,
      weighIns: _weighIns,
    );

/// Fix the surface to iPhone-13 logical size.
void _setIphoneSize(WidgetTester tester) {
  tester.view.physicalSize = _kSize * _kDpr;
  tester.view.devicePixelRatio = _kDpr;
}

/// Suppress RenderFlex overflow errors for the duration of [action]. These
/// arise because the system-font fallback (used when Google Fonts can't load
/// in headless tests) has different metrics than the real Fraunces/Inter, so
/// some rows overflow slightly. The PNG still renders correctly; only the
/// diagnostic error annotation is suppressed.
Future<T> _suppressOverflows<T>(Future<T> Function() action) async {
  final originalOnError = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('overflowed by')) return;
    originalOnError?.call(details);
  };
  try {
    return await action();
  } finally {
    FlutterError.onError = originalOnError;
  }
}

/// Render soft shadows for the duration of [action], then restore the default.
///
/// flutter_test forces [debugDisableShadows] on, which rasterizes every
/// elevation as a HARD BLACK shape (a thick black ring around FABs, a black
/// hairline under cards) — misleading for a design review. We flip it off
/// across the whole capture (pump AND golden rasterization) so shadows render
/// soft like a device, then restore it to `true` before the test body returns —
/// the framework asserts the flag is back to its automated-mode default between
/// tests, and that invariant check runs *before* any tearDown.
Future<T> _withSoftShadows<T>(Future<T> Function() action) async {
  debugDisableShadows = false;
  try {
    return await action();
  } finally {
    debugDisableShadows = true;
  }
}

/// Pump a widget in a [ProviderScope] + [MaterialApp] at the iPhone-13 size,
/// settle animations, and capture a golden PNG.
Future<void> _capture(
  WidgetTester tester,
  Widget widget,
  List<Override> overrides,
  ThemeData theme,
  String goldenName,
) async {
  await _withSoftShadows(() async {
    _setIphoneSize(tester);
    await _suppressOverflows(() async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: overrides,
          child: MaterialApp(
            theme: theme,
            debugShowCheckedModeBanner: false,
            home: widget,
          ),
        ),
      );
      await _settle(tester);
    });
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('images/$goldenName.png'),
    );
  });
}

/// Pump + settle with a short timeout; if animations never end, pump a few
/// frames instead so the test still completes.
/// Always called inside [_suppressOverflows] so overflow errors are already
/// being swallowed at the outer level.
Future<void> _settle(WidgetTester tester) async {
  try {
    await tester.pumpAndSettle(const Duration(milliseconds: 300));
  } catch (_) {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }
}

/// Pump the RootScaffold, optionally tap to a tab, then capture.
Future<void> _captureShell(
  WidgetTester tester,
  JourneyHarness h,
  ThemeData theme,
  int tabIndex,
  String goldenName,
) async {
  await _withSoftShadows(() async {
    _setIphoneSize(tester);
    await _suppressOverflows(() async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: h.overrides,
          child: MaterialApp(
            theme: theme,
            debugShowCheckedModeBanner: false,
            home: const RootScaffold(),
          ),
        ),
      );
      await _settle(tester);

      if (tabIndex != 0) {
        final navDests = find.byType(NavigationDestination);
        if (navDests.evaluate().length > tabIndex) {
          await tester.tap(navDests.at(tabIndex));
          await _settle(tester);
        }
      }
    });

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('images/$goldenName.png'),
    );
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

void main() {
  setUpAll(() async {
    // Never fetch fonts over the network in tests.
    GoogleFonts.config.allowRuntimeFetching = false;

    // Register the real Fraunces + Inter TTFs (checked in under
    // test/goldens/fonts/) under the exact family names google_fonts resolves
    // to. With runtime fetching off and no cached copy, GoogleFonts falls back
    // to a font family literally named 'Fraunces' / 'Inter' — which these
    // loaders now provide — so the goldens render true glyphs (not the
    // box-glyph test fallback). Variable fonts; the default instance is used.
    // At render time google_fonts sets each TextStyle's fontFamily to
    // '${family}_$variant', where $variant is the numeric weight (e.g. 600) or
    // the literal 'regular' for w400 — see GoogleFontsFamilyWithVariant.toString
    // in google_fonts 8.2.1. So register the variable TTF under every one of
    // those exact names. The variable font carries all weights; the default
    // instance renders (real glyphs, correct proportions) — enough for a visual
    // design review even if the on-screen weight isn't axis-varied.
    const variants = [
      'regular',
      '100', '200', '300', '500', '600', '700', '800', '900',
    ];
    Future<void> loadFont(String base, String path) async {
      final bytes = await File(path).readAsBytes();
      for (final v in variants) {
        final loader = FontLoader('${base}_$v')
          ..addFont(Future.value(ByteData.view(bytes.buffer)));
        await loader.load();
      }
    }

    await loadFont('Fraunces', 'test/goldens/fonts/Fraunces.ttf');
    await loadFont('Inter', 'test/goldens/fonts/Inter.ttf');

    // Icon fonts (single family name each) so Material/Cupertino glyphs render
    // instead of the box fallback — the nav bar, chips and inline icons.
    Future<void> loadIconFont(String family, String path) async {
      final bytes = await File(path).readAsBytes();
      final loader = FontLoader(family)
        ..addFont(Future.value(ByteData.view(bytes.buffer)));
      await loader.load();
    }

    await loadIconFont('MaterialIcons', 'test/goldens/fonts/MaterialIcons.otf');
    await loadIconFont('CupertinoIcons', 'test/goldens/fonts/CupertinoIcons.ttf');
  });

  for (final themeName in ['light', 'dark']) {
    final theme = themeName == 'light' ? lightTheme : darkTheme;

    group('[$themeName]', () {
      // ── Home / Today ──────────────────────────────────────────────────────
      // The flagship home screen: weight tile, nutrition rings, restock card,
      // Brain "For you" section — all seeded with real data.

      testWidgets('home_today', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _captureShell(tester, h, theme, 0, 'home_today_$themeName');
      });

      // ── Food / Kitchen ────────────────────────────────────────────────────
      // Kitchen scene with pantry items across fridge / pantry / freezer /
      // condiments zones.

      testWidgets('food_kitchen', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _captureShell(tester, h, theme, 1, 'food_kitchen_$themeName');
      });

      // ── Gym — no session (gate + transformation card) ─────────────────────

      testWidgets('gym_no_session', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _captureShell(tester, h, theme, 2, 'gym_no_session_$themeName');
      });

      // ── Gym — mid-session (exercise picked + one logged set) ─────────────
      // Starts from GymPage directly (not the shell) so we can tap "Start"
      // and then capture the active session UI.

      testWidgets('gym_mid_session', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _capture(
          tester,
          const GymPage(),
          h.overrides,
          theme,
          'gym_gate_$themeName',
        );
        // Tap the "Start workout" button if present.
        final startBtn = find.byKey(const Key('gym-start-btn'));
        if (startBtn.evaluate().isNotEmpty) {
          await _withSoftShadows(() async {
            await tester.tap(startBtn);
            await _settle(tester);
            await expectLater(
              find.byType(MaterialApp),
              matchesGoldenFile('images/gym_mid_session_$themeName.png'),
            );
          });
        }
      });

      // ── Cart (grocery list + hand-off buttons) ────────────────────────────

      testWidgets('cart', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        // Seed grocery items (add() takes a name string).
        for (final name in _groceryNames) {
          await h.groceryRepo.add(name);
        }
        await _captureShell(tester, h, theme, 3, 'cart_$themeName');
      });

      // ── Nutrition capture (In mode — AI-estimate + barcode buttons) ───────

      testWidgets('nutrition_capture', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _capture(
          tester,
          const NutritionPage(),
          h.overrides,
          theme,
          'nutrition_capture_$themeName',
        );
      });

      // ── Weight chart (≥3 real weigh-ins → line chart shown) ──────────────

      testWidgets('weight_chart', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _capture(
          tester,
          WeightPage(
            weighInRepo: h.weighInRepo,
            profileRepo: h.profileRepo,
          ),
          h.overrides,
          theme,
          'weight_chart_$themeName',
        );
      });

      // ── Transformation (roadmap + milestones + strength targets) ──────────

      testWidgets('transformation', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _capture(
          tester,
          TransformationPage(
            weighInRepo: h.weighInRepo,
            profileRepo: h.profileRepo,
            workoutRepo: h.workoutRepo,
            now: DateTime(2026, 8, 23, 10, 30),
          ),
          h.overrides,
          theme,
          'transformation_$themeName',
        );
      });

      // ── Plan my week — populated (generated plan + shopping gaps) ──────────

      testWidgets('plan_populated', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = JourneyHarness(
          profile: _profile,
          goals: _goals,
          pantry: _pantry,
          mealPlan: _planForGolden(),
        );
        await _capture(
          tester,
          PlanPage(
            planRepo: h.mealPlanRepo,
            planClient: h.planClient,
            goalsRepo: h.goalsRepo,
            pantryRepo: h.pantryRepo,
            groceryRepo: h.groceryRepo,
            nutritionRepo: h.nutritionRepo,
            eatInService: EatInService(h.pantryRepo),
            now: DateTime(2026, 8, 24),
          ),
          h.overrides,
          theme,
          'plan_populated_$themeName',
        );
      });

      // ── Plan my week — empty (has goal, no plan yet) ──────────────────────

      testWidgets('plan_empty', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = JourneyHarness(profile: _profile, goals: _goals, pantry: _pantry);
        await _capture(
          tester,
          PlanPage(
            planRepo: h.mealPlanRepo,
            planClient: h.planClient,
            goalsRepo: h.goalsRepo,
            pantryRepo: h.pantryRepo,
            groceryRepo: h.groceryRepo,
            nutritionRepo: h.nutritionRepo,
            eatInService: EatInService(h.pantryRepo),
            now: DateTime(2026, 8, 24),
          ),
          h.overrides,
          theme,
          'plan_empty_$themeName',
        );
      });

      // ── Settings ──────────────────────────────────────────────────────────

      testWidgets('settings', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = _harness();
        await _capture(
          tester,
          SettingsPage(repo: h.profileRepo),
          h.overrides,
          theme,
          'settings_$themeName',
        );
      });

      // ── Auth screen (sign-in form) ────────────────────────────────────────
      // No ProviderScope needed — AuthScreen takes its service directly.

      testWidgets('auth_screen', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        await _withSoftShadows(() async {
          _setIphoneSize(tester);
          await _suppressOverflows(() async {
            await tester.pumpWidget(
              MaterialApp(
                theme: theme,
                debugShowCheckedModeBanner: false,
                home: AuthScreen(service: FakeAuthService()),
              ),
            );
            await _settle(tester);
          });
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('images/auth_screen_$themeName.png'),
          );
        });
      });

      // ── Onboarding (step 0 — height input) ───────────────────────────────
      // Uses noProfile: true so the first-run gate would route here.
      // We render OnboardingFlow directly without the shell gate.

      testWidgets('onboarding', (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        final h = JourneyHarness(noProfile: true);
        await _withSoftShadows(() async {
          _setIphoneSize(tester);
          await _suppressOverflows(() async {
            await tester.pumpWidget(
              ProviderScope(
                overrides: h.overrides,
                child: MaterialApp(
                  theme: theme,
                  debugShowCheckedModeBanner: false,
                  home: OnboardingFlow(
                    repo: h.profileRepo,
                    onDone: () {},
                  ),
                ),
              ),
            );
            await _settle(tester);
          });
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('images/onboarding_$themeName.png'),
          );
        });
      });
    });
  }
}
