// Widget tests for the weight detail page (WeightPage).
//
// Honesty invariants tested:
//   • ≥2 real weigh-ins → WeightLineChart widget present (the real chart).
//   • Exactly 1 real weigh-in → single-point state + "Log another" message.
//   • 0 weigh-ins → honest empty state message.
//   • Goal line legend shown ONLY when a real targetWeightKg is set.
//   • A null-weight weigh-in is excluded from the chart (≥2 real check).
//   • Tapping the log-weight button opens the LogWeightSheet.
//   • Tapping the Home weight card (today_page) opens weight-page.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_goals_repo.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/pages/weight_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/pantry_repo.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class _FakeProfileStore implements ProfileStore {
  _FakeProfileStore([this._saved]);
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class _FakeProfileApi implements ProfileApi {
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class _FakeWeighInStore implements WeighInStore {
  _FakeWeighInStore([List<WeighIn>? seed]) : _items = seed ?? [];
  List<WeighIn> _items;
  @override
  Future<List<WeighIn>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<WeighIn> items) async => _items = List.of(items);
}

class _FakeNutritionStore implements NutritionStore {
  @override
  Future<List<FoodLogEntry>> load() async => [];
  @override
  Future<void> save(List<FoodLogEntry> items) async {}
}

class _FakeGoalsStore implements NutritionGoalsStore {
  @override
  Future<Map<String, dynamic>?> load() async => null;
  @override
  Future<void> save(Map<String, dynamic> json) async {}
}

class _FakePantryStore implements PantryStore {
  @override
  Future<List<PantryItem>> load() async => [];
  @override
  Future<void> save(List<PantryItem> items) async {}
}

// ── Builders ─────────────────────────────────────────────────────────────────

Outbox _outbox() => Outbox(_FakeOutboxStore());

WeighInRepo _weighInRepo([List<WeighIn>? seed]) => WeighInRepo(
      outbox: _outbox(),
      store: _FakeWeighInStore(seed),
    );

ProfileRepo _profileRepo([Map<String, dynamic>? stored]) => ProfileRepo(
      api: _FakeProfileApi(),
      outbox: _outbox(),
      store: _FakeProfileStore(stored),
    );

/// Builds a WeightPage wrapped in a full MaterialApp + theme.
Widget _weightPage({
  List<WeighIn>? history,
  Map<String, dynamic>? profileJson,
}) {
  return MaterialApp(
    theme: lightTheme,
    home: WeightPage(
      weighInRepo: _weighInRepo(history),
      profileRepo: _profileRepo(profileJson),
    ),
  );
}

/// A real weigh-in with a guaranteed non-null weight.
WeighIn _weighIn(double kg, {DateTime? at}) =>
    WeighIn.now(weightKg: kg, at: at ?? DateTime.now());

/// A weigh-in with a null weight (placeholder / imported).
WeighIn _nullWeighIn({DateTime? at}) =>
    WeighIn.now(weightKg: null, at: at ?? DateTime.now());

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  group('WeightPage — honest states', () {
    testWidgets('≥2 real weigh-ins → WeightLineChart widget is present',
        (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(_weightPage(history: [
        _weighIn(62.0, at: now.subtract(const Duration(days: 7))),
        _weighIn(63.0, at: now),
      ]));
      await tester.pumpAndSettle();

      // The real chart widget should be in the tree.
      expect(find.byType(WeightLineChart), findsOneWidget);
      // The empty and single states must NOT appear.
      expect(find.byKey(const Key('weight-empty-message')), findsNothing);
      expect(find.byKey(const Key('weight-single-message')), findsNothing);
    });

    testWidgets(
        'Exactly 1 real weigh-in → single-point state + "Log another" message',
        (tester) async {
      await tester.pumpWidget(_weightPage(history: [
        _weighIn(62.0),
      ]));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('weight-single-message')), findsOneWidget);
      expect(find.text('Log another to see your trend'), findsOneWidget);
      expect(find.byType(WeightLineChart), findsNothing);
      expect(find.byKey(const Key('weight-empty-message')), findsNothing);
    });

    testWidgets('0 weigh-ins → honest empty state message', (tester) async {
      await tester.pumpWidget(_weightPage(history: []));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('weight-empty-message')), findsOneWidget);
      expect(
          find.text('No weigh-ins yet — log your first'), findsOneWidget);
      expect(find.byType(WeightLineChart), findsNothing);
      expect(find.byKey(const Key('weight-single-message')), findsNothing);
    });
  });

  group('WeightPage — goal line', () {
    testWidgets(
        'goal line legend shown when profile has a real targetWeightKg',
        (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(_weightPage(
        history: [
          _weighIn(62.0, at: now.subtract(const Duration(days: 7))),
          _weighIn(63.0, at: now),
        ],
        profileJson: {'target_weight_kg': 75.0},
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('weight-goal-line-legend')), findsOneWidget);
      expect(find.textContaining('Goal:'), findsOneWidget);
    });

    testWidgets(
        'goal line legend NOT shown when profile has no targetWeightKg',
        (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(_weightPage(
        history: [
          _weighIn(62.0, at: now.subtract(const Duration(days: 7))),
          _weighIn(63.0, at: now),
        ],
        // No profileJson → targetWeightKg stays null.
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('weight-goal-line-legend')), findsNothing);
    });
  });

  group('WeightPage — null-weight weigh-in exclusion', () {
    testWidgets(
        'a null-weight weigh-in is excluded: 2 null + 1 real → single-point state',
        (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(_weightPage(history: [
        // Two null-weight readings — these must NOT count toward the chart.
        _nullWeighIn(at: now.subtract(const Duration(days: 10))),
        _nullWeighIn(at: now.subtract(const Duration(days: 5))),
        // One REAL reading.
        _weighIn(62.0, at: now),
      ]));
      await tester.pumpAndSettle();

      // Only 1 real reading → single-point state, not the line chart.
      expect(find.byKey(const Key('weight-single-message')), findsOneWidget);
      expect(find.byType(WeightLineChart), findsNothing);
    });

    testWidgets(
        'null-weight weigh-ins alongside ≥2 real ones → chart still renders',
        (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(_weightPage(history: [
        _nullWeighIn(at: now.subtract(const Duration(days: 14))),
        _weighIn(61.0, at: now.subtract(const Duration(days: 7))),
        _weighIn(62.5, at: now),
      ]));
      await tester.pumpAndSettle();

      // 2 real readings → the line chart.
      expect(find.byType(WeightLineChart), findsOneWidget);
    });
  });

  group('WeightPage — log weight opens the sheet', () {
    testWidgets('tapping the FAB opens the LogWeightSheet', (tester) async {
      await tester.pumpWidget(_weightPage(history: []));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('weight-page-fab')));
      await tester.pumpAndSettle();

      // The sheet identifies itself via the text field inside LogWeightSheet.
      expect(find.byKey(const Key('log-weight-field')), findsOneWidget);
    });

    testWidgets('tapping the header "Log weight" button opens the sheet',
        (tester) async {
      await tester.pumpWidget(_weightPage(history: []));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('weight-page-log-btn')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('log-weight-field')), findsOneWidget);
    });
  });

  group('TodayPage — weight card opens WeightPage', () {
    testWidgets('tapping the weight card navigates to weight-page',
        (tester) async {
      // Build TodayPage with minimal fakes — we only care about the nav tap.
      final weighInRepo = _weighInRepo([]);
      final profileRepo = _profileRepo();

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: lightTheme,
            home: TodayPage(
              repo: profileRepo,
              nutritionRepo: NutritionRepo(
                outbox: _outbox(),
                store: _FakeNutritionStore(),
              ),
              goalsRepo: NutritionGoalsRepo(
                outbox: _outbox(),
                store: _FakeGoalsStore(),
              ),
              weighInRepo: weighInRepo,
              pantryRepo: PantryRepo(
                outbox: _outbox(),
                store: _FakePantryStore(),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The weight card is on the page — tap it.
      final card = find.byKey(const Key('today-weight-card'));
      expect(card, findsOneWidget);
      await tester.tap(card);
      await tester.pumpAndSettle();

      // WeightPage should now be in the tree.
      expect(find.byKey(const Key('weight-page')), findsOneWidget);
    });
  });
}
