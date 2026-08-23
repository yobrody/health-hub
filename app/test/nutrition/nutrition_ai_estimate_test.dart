// Widget tests for the AI nutrition-estimate path on NutritionPage.
//
// The estimate client is a FakeNutritionEstimateClient (no network); the photo
// and text seams are driven directly via the public state methods
// (handleAiPhotoResult / handleAiTextResult), so no camera is touched.
//
// Honesty invariants under test:
//  • A successful estimate prefills the form as an ESTIMATE — the honest
//    confidence banner shows, the `~` marker appears on Log, tier=estimate.
//  • A null macro from the estimate stays BLANK in the form (never a 0).
//  • Confirming (Log) an AI-estimate form logs an estimate entry (source 'ai',
//    tier estimate), NOT an exact one.
//  • A null estimate → honest snackbar, nothing prefilled, nothing logged.
//  • Both the text and photo paths behave identically.
//  • No "exact/measured" framing is shown for an estimate.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/nutrition/estimate/nutrition_estimate.dart';
import 'package:health_hub/nutrition/estimate/nutrition_estimate_client.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/nutrition/nutrition_repo.dart';
import 'package:health_hub/nutrition/off_client.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/nutrition_page.dart';

// ── In-memory fakes ──────────────────────────────────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

class _FakeNutritionStore implements NutritionStore {
  List<FoodLogEntry> _items = [];
  List<FoodLogEntry> get items => List.unmodifiable(_items);
  @override
  Future<List<FoodLogEntry>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<FoodLogEntry> items) async {
    _items = List.of(items);
  }
}

class _StubOffClient extends OffClient {
  _StubOffClient() : super(Dio());
  @override
  Future<PackagedFood?> lookupBarcode(String code) async => null;
}

// ── Build helper ─────────────────────────────────────────────────────────────

Widget _buildPage(
  _FakeNutritionStore store,
  NutritionEstimateClient estimateClient,
) {
  final repo = NutritionRepo(
    outbox: Outbox(_FakeOutboxStore()),
    store: store,
  );
  return ProviderScope(
    overrides: [
      nutritionRepoProvider.overrideWithValue(repo),
      offClientProvider.overrideWithValue(_StubOffClient()),
      nutritionEstimateClientProvider.overrideWithValue(estimateClient),
    ],
    child: const MaterialApp(home: NutritionPage()),
  );
}

NutritionPageState _state(WidgetTester tester) =>
    tester.state<NutritionPageState>(find.byType(NutritionPage));

String _fieldText(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller?.text ?? '';

void main() {
  group('AI nutrition estimate', () {
    testWidgets('the Estimate-with-AI affordance is present', (tester) async {
      await tester.pumpWidget(
        _buildPage(_FakeNutritionStore(),
            FakeNutritionEstimateClient(result: null)),
      );
      await tester.pump();
      expect(
        find.byKey(const Key('nutrition-ai-estimate-btn')),
        findsOneWidget,
      );
    });

    testWidgets('text estimate prefills the form as an ESTIMATE with the banner',
        (tester) async {
      const est = NutritionEstimate(
        name: 'Chicken salad',
        kcal: 420,
        proteinG: 38,
        carbsG: null, // couldn't estimate → must stay BLANK
        fatG: 24,
        confidence: 0.6,
        note: 'Assumed a standard bowl.',
      );
      final store = _FakeNutritionStore();
      await tester.pumpWidget(
        _buildPage(store, FakeNutritionEstimateClient(result: est)),
      );
      await tester.pump();

      await _state(tester).handleAiTextResult('chicken salad');
      await tester.pump();

      // Form prefilled from the estimate.
      expect(_fieldText(tester, 'nutrition-name'), 'Chicken salad');
      expect(_fieldText(tester, 'nutrition-kcal'), '420');
      expect(_fieldText(tester, 'nutrition-protein'), '38.0');
      expect(_fieldText(tester, 'nutrition-fat'), '24.0');
      // The null macro stays BLANK — never a fabricated 0.
      expect(_fieldText(tester, 'nutrition-carbs'), '');

      // The honest estimate banner is shown with the confidence.
      expect(
        find.byKey(const Key('nutrition-ai-estimate-banner')),
        findsOneWidget,
      );
      expect(find.textContaining('60% confidence'), findsOneWidget);
      expect(find.textContaining('check before saving'), findsOneWidget);
    });

    testWidgets('confirming an AI-estimate form logs an ESTIMATE (not exact)',
        (tester) async {
      const est = NutritionEstimate(
        name: 'Curry',
        kcal: 600,
        proteinG: 25,
        carbsG: null,
        fatG: 30,
        confidence: 0.5,
      );
      final store = _FakeNutritionStore();
      await tester.pumpWidget(
        _buildPage(store, FakeNutritionEstimateClient(result: est)),
      );
      await tester.pump();

      await _state(tester).handleAiTextResult('curry');
      await tester.pump();

      // Confirm via the normal Log path (scroll it into view first — the
      // estimate banner lengthens the form, so the button is below the fold
      // and lazily built by the ListView).
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pump();

      expect(store.items, hasLength(1));
      final entry = store.items.first;
      // Estimate tier — NEVER exact.
      expect(entry.tier, AccuracyTier.estimate);
      // `~` marker on the name.
      expect(entry.name, startsWith('~'));
      expect(entry.name, contains('Curry'));
      // Source recorded as ai.
      expect(entry.source, 'ai');
      // Estimated macros carried; the null one stays null (not 0).
      expect(entry.kcal, 600);
      expect(entry.proteinG, 25);
      expect(entry.fatG, 30);
      expect(entry.carbsG, isNull);
    });

    testWidgets('photo estimate uses the fake-bytes seam and prefills',
        (tester) async {
      const est = NutritionEstimate(
        name: 'Burrito',
        kcal: 700,
        confidence: 0.4,
      );
      final client = FakeNutritionEstimateClient(result: est);
      final store = _FakeNutritionStore();
      await tester.pumpWidget(_buildPage(store, client));
      await tester.pump();

      final bytes = Uint8List.fromList([10, 20, 30]);
      await _state(tester).handleAiPhotoResult(bytes);
      await tester.pump();

      // The seam forwarded the bytes to the client.
      expect(client.lastImage, bytes);
      // And prefilled the form as an estimate.
      expect(_fieldText(tester, 'nutrition-name'), 'Burrito');
      expect(_fieldText(tester, 'nutrition-kcal'), '700');
      expect(
        find.byKey(const Key('nutrition-ai-estimate-banner')),
        findsOneWidget,
      );
    });

    testWidgets('null estimate → honest snackbar, nothing prefilled or logged',
        (tester) async {
      final store = _FakeNutritionStore();
      await tester.pumpWidget(
        _buildPage(store, FakeNutritionEstimateClient(result: null)),
      );
      await tester.pump();

      await _state(tester).handleAiTextResult('something unclear');
      await tester.pump();

      // Truthful fallback snackbar.
      expect(find.byKey(const Key('nutrition-ai-snackbar')), findsOneWidget);
      // Nothing prefilled.
      expect(_fieldText(tester, 'nutrition-name'), '');
      expect(_fieldText(tester, 'nutrition-kcal'), '');
      // No estimate banner.
      expect(
        find.byKey(const Key('nutrition-ai-estimate-banner')),
        findsNothing,
      );
      // Nothing logged.
      expect(store.items, isEmpty);
    });

    testWidgets('an estimate never shows exact/measured framing',
        (tester) async {
      const est = NutritionEstimate(name: 'Soup', kcal: 200, confidence: 0.5);
      await tester.pumpWidget(
        _buildPage(
            _FakeNutritionStore(), FakeNutritionEstimateClient(result: est)),
      );
      await tester.pump();

      await _state(tester).handleAiTextResult('soup');
      await tester.pump();

      // No forbidden framing anywhere on the estimate form.
      expect(find.textContaining('measured'), findsNothing);
      expect(find.textContaining('Exact'), findsNothing);
      expect(find.textContaining('exact'), findsNothing);
    });
  });
}
