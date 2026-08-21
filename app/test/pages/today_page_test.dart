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
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
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


class FakeGoalsStore implements NutritionGoalsStore {
  FakeGoalsStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class FakeWeighInStore implements WeighInStore {
  FakeWeighInStore([List<WeighIn>? seed]) : _items = seed ?? [];
  List<WeighIn> _items;
  @override
  Future<List<WeighIn>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<WeighIn> items) async => _items = List.of(items);
}

class FakePantryStore implements PantryStore {
  FakePantryStore([List<PantryItem>? seed]) : _items = seed ?? [];
  List<PantryItem> _items;
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
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

NutritionGoalsRepo _goalsRepo([Map<String, dynamic>? stored]) =>
    NutritionGoalsRepo(
      outbox: Outbox(FakeOutboxStore()),
      store: FakeGoalsStore(stored),
    );

WeighInRepo _weighInRepo([List<WeighIn>? seed]) => WeighInRepo(
      outbox: Outbox(FakeOutboxStore()),
      store: FakeWeighInStore(seed),
    );

PantryRepo _pantryRepo([List<PantryItem>? seed]) => PantryRepo(
      outbox: Outbox(FakeOutboxStore()),
      store: FakePantryStore(seed),
    );

Widget _dashboard({
  Map<String, dynamic>? profile,
  List<FoodLogEntry>? food,
  Map<String, dynamic>? goals,
  List<WeighIn>? weighIns,
  List<PantryItem>? pantry,
}) {
  return ProviderScope(
    child: MaterialApp(
      theme: lightTheme,
      home: TodayPage(
        repo: _profileRepo(profile),
        nutritionRepo: _nutritionRepo(food),
        goalsRepo: _goalsRepo(goals),
        weighInRepo: _weighInRepo(weighIns),
        pantryRepo: _pantryRepo(pantry),
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

/// Scroll the dashboard ListView up so the (last) restock-soon section is built
/// and laid out — a ListView lazily builds only the children in view, and the
/// restock card sits below the fold in the default test viewport.
Future<void> _scrollToRestock(WidgetTester tester) async {
  await tester.dragUntilVisible(
    find.text('RESTOCK SOON'),
    find.byType(Scrollable),
    const Offset(0, -300),
  );
  await tester.pumpAndSettle();
}

/// A pantry item helper for restock-soon tests.
PantryItem _pItem(
  String id, {
  double? qty,
  String? unit,
  DateTime? expiry,
  int? reorderCadenceDays,
  DateTime? lastBought,
}) =>
    PantryItem(
      id: id,
      name: id,
      zone: PantryZone.fridge,
      qty: qty,
      unit: unit,
      expiry: expiry,
      reorderCadenceDays: reorderCadenceDays,
      lastBought: lastBought,
      source: 'manual',
    );

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

  // ── Restock-soon card (R-1, replaces the training card) ────────────────────

  testWidgets('restock-soon card shows real low/expiring pantry items',
      (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      pantry: [
        // Genuinely low (known gram qty below threshold).
        _pItem('Butter', qty: 20, unit: 'g'),
        // Expiring soon (real near expiry).
        _pItem('Milk', expiry: DateTime.now().add(const Duration(days: 1))),
        // Nothing due — must NOT surface (no fabricated urgency).
        _pItem('Rice', qty: 900, unit: 'g'),
      ],
    ));
    await tester.pumpAndSettle();
    await _scrollToRestock(tester);

    expect(find.byKey(const Key('home-restock-soon')), findsOneWidget);
    // Both due items appear; the not-due one does not.
    expect(find.text('Butter'), findsOneWidget);
    expect(find.text('Milk'), findsOneWidget);
    expect(find.text('Rice'), findsNothing);
  });

  testWidgets('restock-soon card is OMITTED when nothing is due (honest)',
      (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      // A well-stocked, far-dated item → nothing to restock.
      pantry: [
        _pItem('Rice',
            qty: 900,
            unit: 'g',
            expiry: DateTime.now().add(const Duration(days: 365))),
      ],
    ));
    await tester.pumpAndSettle();

    // No restock section, no fabricated "all good" urgency card.
    expect(find.byKey(const Key('home-restock-soon')), findsNothing);
    expect(find.text('RESTOCK SOON'), findsNothing);
  });

  testWidgets('an empty pantry shows no restock card', (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-restock-soon')), findsNothing);
  });

  // ── Relocated Home affordances (R-1) ───────────────────────────────────────

  testWidgets('Home carries the settings + log-meal buttons', (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-settings-btn')), findsOneWidget);
    expect(find.byKey(const Key('home-log-meal-btn')), findsOneWidget);
  });

  // ── Nutrition-goal wiring (P4-D4) ──────────────────────────────────────────

  testWidgets('rings fill against a REAL goal when one is set', (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      food: [_entry(kcal: 500, protein: 40, carbs: 35, fat: 15)],
      goals: {
        'caloriesKcal': 2500,
        'proteinG': 150,
        'carbsG': 250,
        'fatG': 70,
      },
    ));
    await tester.pumpAndSettle();

    // Each ring now carries its real target — no more null goals.
    final rings = tester.widgetList<ProgressRing>(find.byType(ProgressRing));
    expect(rings, hasLength(3));
    expect(rings.map((r) => r.goal), [150.0, 250.0, 70.0]);
    // The calorie headline shows the real target denominator.
    expect(find.text('/ 2500 kcal'), findsOneWidget);
    // Honest caption when targets are active.
    expect(find.textContaining('against your daily targets'), findsOneWidget);
  });

  testWidgets('an unset macro target keeps the honest empty ring', (tester) async {
    // Only calories set; the three macro targets stay null → empty rings.
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5},
      food: [_entry(protein: 40)],
      goals: {'caloriesKcal': 2500},
    ));
    await tester.pumpAndSettle();

    final rings = tester.widgetList<ProgressRing>(find.byType(ProgressRing));
    for (final r in rings) {
      expect(r.goal, isNull); // macro targets unset → no fabricated fill
    }
  });

  // ── Weigh-in / weight-trend wiring (P4-D4) ─────────────────────────────────

  testWidgets('weight card shows current from the latest weigh-in', (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.5}, // profile scalar…
      weighIns: [
        // …but a newer weigh-in supersedes it as "current".
        WeighIn(
          id: 'w-1',
          at: DateTime.now().subtract(const Duration(days: 1)),
          weightKg: 63.0,
        ),
      ],
    ));
    await tester.pumpAndSettle();

    // Current = the single weigh-in's 63, not the 62.5 profile scalar.
    expect(find.textContaining('63'), findsWidgets);
    // One reading → NO trend arrow (never invented).
    expect(find.byKey(const Key('today-weight-trend')), findsNothing);
  });

  testWidgets('weight card shows a real ▼ trend with ≥2 weigh-ins', (tester) async {
    await tester.pumpWidget(_dashboard(
      profile: {'weight_kg': 62.0},
      weighIns: [
        WeighIn(
          id: 'w-old',
          at: DateTime(2026, 8, 1),
          weightKg: 65.0,
        ),
        WeighIn(
          id: 'w-new',
          at: DateTime(2026, 8, 20),
          weightKg: 62.0,
        ),
      ],
    ));
    await tester.pumpAndSettle();

    // 65 → 62 = a real 3 kg drop; the trend chip renders.
    final chip = find.byKey(const Key('today-weight-trend'));
    expect(chip, findsOneWidget);
    expect(find.textContaining('3 kg'), findsOneWidget);
  });

  testWidgets('no weigh-ins → falls back to the profile scalar, no trend',
      (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();

    expect(find.textContaining('62.5'), findsWidgets); // profile fallback
    expect(find.byKey(const Key('today-weight-trend')), findsNothing);
  });

  // ── R1 rift seam (home-rift-seam) ─────────────────────────────────────────

  testWidgets('rift seam is present on the home screen and is inert (R1)',
      (tester) async {
    await tester.pumpWidget(_dashboard(profile: {'weight_kg': 62.5}));
    await tester.pumpAndSettle();

    // The seam must exist as an affordance (the Key is the contract).
    expect(find.byKey(const Key('home-rift-seam')), findsOneWidget);

    // Tapping it must not navigate, crash, or mutate anything.
    await tester.tap(find.byKey(const Key('home-rift-seam')));
    await tester.pumpAndSettle();

    // Still on the same page — no navigation happened.
    expect(find.byKey(const Key('today-page')), findsOneWidget);
  });
}
