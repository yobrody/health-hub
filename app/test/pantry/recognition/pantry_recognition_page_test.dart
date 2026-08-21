// Widget tests for the R-2 confirm-before-save flow.
//
// Contracts (honesty is load-bearing):
//  1. The confirm screen renders recognized items with their confidence shown
//     honestly (low-confidence items are visibly FLAGGED, not hidden).
//  2. Editing a zone/qty then confirming saves EXACTLY the confirmed/edited
//     items to the fake pantry — with `source: 'scan'`.
//  3. REMOVED items are NOT saved.
//  4. An EMPTY recognition result shows the honest fallback and saves nothing.
//  5. The Food-gate `runRecognition` seam: success pushes the confirm screen;
//     a RecognitionFailure surfaces an honest snackbar and saves nothing.
//     All driven with FAKE image bytes — no camera, no network.
//
// The real SupabaseRecognitionClient is NEVER built: every pump overrides
// pantryRecognitionClientProvider with a FakePantryRecognitionClient.

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/food_page.dart';
import 'package:health_hub/pages/pantry_recognition_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/recognition/pantry_recognition.dart';
import 'package:health_hub/pantry/recognition/recognition_client.dart';
import 'package:health_hub/pantry/pantry_repo.dart';

// ── Fakes (match the pattern in food_page_test) ──────────────────────────────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async =>
      _items = List.of(items);
}

class _FakePantryStore implements PantryStore {
  List<PantryItem> _items;
  _FakePantryStore(List<PantryItem> seed) : _items = List.of(seed);
  @override
  Future<List<PantryItem>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PantryItem> items) async => _items = List.of(items);
}

PantryRepo _repo(_FakePantryStore store) =>
    PantryRepo(outbox: Outbox(_FakeOutboxStore()), store: store);

// A couple of canned suggestions with mixed confidence.
const _milkHigh = RecognizedItem(
  name: 'Milk',
  zoneGuess: PantryZone.fridge,
  confidence: 0.92,
);
const _mysteryLow = RecognizedItem(
  name: 'Mystery jar',
  zoneGuess: PantryZone.pantry,
  confidence: 0.28,
);

void main() {
  // ── The confirm screen directly ────────────────────────────────────────────

  Future<PantryRepo> pumpConfirm(
    WidgetTester tester,
    RecognitionResult result, {
    _FakePantryStore? store,
  }) async {
    final s = store ?? _FakePantryStore([]);
    final repo = _repo(s);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [pantryRepoProvider.overrideWithValue(repo)],
        child: MaterialApp(home: PantryRecognitionPage(result: result)),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  testWidgets('renders recognized items; low confidence is visibly flagged',
      (tester) async {
    await pumpConfirm(
      tester,
      const RecognitionResult(items: [_milkHigh, _mysteryLow]),
    );

    expect(find.byKey(const Key('pantry-recognition-page')), findsOneWidget);
    expect(find.byKey(const Key('recognition-item-0')), findsOneWidget);
    expect(find.byKey(const Key('recognition-item-1')), findsOneWidget);

    // Confidence is shown honestly, not hidden. The low-confidence item carries
    // the "unsure" flag; the high one does not.
    expect(find.byKey(const Key('recognition-confidence-unsure')),
        findsOneWidget);
    expect(find.byKey(const Key('recognition-confidence-likely')),
        findsOneWidget);
    expect(find.textContaining('Unsure'), findsOneWidget);
  });

  testWidgets(
      'editing zone+qty then confirming saves EXACTLY those items (source scan)',
      (tester) async {
    final store = _FakePantryStore([]);
    final repo = await pumpConfirm(
      tester,
      const RecognitionResult(items: [_milkHigh]),
      store: store,
    );

    // Edit qty (was blank — the model didn't see an amount) and change zone.
    await tester.enterText(
        find.byKey(const Key('recognition-qty-0')), '2');
    await tester.enterText(
        find.byKey(const Key('recognition-unit-0')), 'L');

    // Change the zone to Freezer via the dropdown.
    await tester.tap(find.byKey(const Key('recognition-zone-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Freezer').last);
    await tester.pumpAndSettle();

    // Confirm.
    await tester.tap(find.byKey(const Key('recognition-confirm-btn')));
    await tester.pumpAndSettle();

    final saved = await repo.all();
    expect(saved.length, 1);
    final item = saved.single;
    expect(item.name, 'Milk');
    expect(item.zone, PantryZone.freezer);
    expect(item.qty, 2);
    expect(item.unit, 'L');
    expect(item.source, 'scan');
  });

  testWidgets('removed items are NOT saved; only remaining ones are',
      (tester) async {
    final store = _FakePantryStore([]);
    final repo = await pumpConfirm(
      tester,
      const RecognitionResult(items: [_milkHigh, _mysteryLow]),
      store: store,
    );

    // Remove the low-confidence "Mystery jar" (index 1).
    await tester.tap(find.byKey(const Key('recognition-remove-1')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('recognition-confirm-btn')));
    await tester.pumpAndSettle();

    final saved = await repo.all();
    expect(saved.length, 1);
    expect(saved.single.name, 'Milk');
    expect(saved.any((i) => i.name == 'Mystery jar'), isFalse);
  });

  testWidgets('blank qty stays null on save (never fabricated as 0)',
      (tester) async {
    final store = _FakePantryStore([]);
    final repo = await pumpConfirm(
      tester,
      const RecognitionResult(items: [_milkHigh]),
      store: store,
    );
    // Do not touch qty/unit — leave them blank.
    await tester.tap(find.byKey(const Key('recognition-confirm-btn')));
    await tester.pumpAndSettle();

    final saved = await repo.all();
    expect(saved.single.qty, isNull);
    expect(saved.single.unit, isNull);
  });

  testWidgets('empty recognition result shows the honest fallback, saves nothing',
      (tester) async {
    final store = _FakePantryStore([]);
    final repo =
        await pumpConfirm(tester, RecognitionResult.empty, store: store);

    expect(find.byKey(const Key('recognition-empty')), findsOneWidget);
    expect(find.textContaining("Couldn't identify"), findsOneWidget);
    // No confirm button in the empty state; nothing can be saved.
    expect(find.byKey(const Key('recognition-confirm-btn')), findsNothing);
    expect(await repo.all(), isEmpty);
  });

  // ── The Food-gate runRecognition seam ───────────────────────────────────────

  Future<(PantryRepo, FoodPage)> pumpFoodGate(
    WidgetTester tester,
    PantryRecognitionClient client, {
    required _FakePantryStore store,
  }) async {
    final repo = _repo(store);
    const page = FoodPage();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          pantryRepoProvider.overrideWithValue(repo),
          pantryRecognitionClientProvider.overrideWithValue(client),
        ],
        child: const MaterialApp(home: page),
      ),
    );
    await tester.pumpAndSettle();
    return (repo, page);
  }

  FoodPageState foodState(WidgetTester tester) =>
      tester.state<FoodPageState>(find.byType(FoodPage));

  testWidgets(
      'runRecognition success pushes the confirm screen (with fake bytes)',
      (tester) async {
    final store = _FakePantryStore([]);
    final client = FakePantryRecognitionClient(
      result: const RecognitionResult(items: [_milkHigh]),
    );
    await pumpFoodGate(tester, client, store: store);

    // Drive the testable seam directly — no camera. runRecognition awaits the
    // pushed confirm route (which the test never pops), so fire-and-forget it
    // and settle the navigation instead of awaiting its future.
    unawaited(foodState(tester).runRecognition([Uint8List.fromList([9, 9, 9])]));
    await tester.pumpAndSettle();

    // The confirm screen is now on screen with the suggestion.
    expect(find.byKey(const Key('pantry-recognition-page')), findsOneWidget);
    expect(find.byKey(const Key('recognition-item-0')), findsOneWidget);
    // Fake received the bytes.
    expect(client.lastImages.single, isNotEmpty);
  });

  testWidgets(
      'a RecognitionFailure surfaces an honest snackbar and saves nothing',
      (tester) async {
    final store = _FakePantryStore([]);
    final client = FakePantryRecognitionClient(
      error: const RecognitionFailure('Recognition failed. Add items manually.'),
    );
    final (repo, _) = await pumpFoodGate(tester, client, store: store);

    await foodState(tester).runRecognition([Uint8List.fromList([1])]);
    // A SnackBar never "settles" (its display timer keeps the tree busy), so
    // pump fixed frames rather than pumpAndSettle.
    await tester.pump(); // process the async recognize() completion
    await tester.pump(const Duration(milliseconds: 300)); // snackbar in

    // Honest error snackbar; NO confirm screen; NOTHING saved.
    expect(find.byKey(const Key('food-gate-upload-snackbar')), findsOneWidget);
    expect(find.textContaining('Add items manually'), findsWidgets);
    expect(find.byKey(const Key('pantry-recognition-page')), findsNothing);
    expect(await repo.all(), isEmpty);

    // Drain the SnackBar's display timer so no timer is pending at teardown.
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets(
      'runRecognition with an empty result pushes the honest fallback screen',
      (tester) async {
    final store = _FakePantryStore([]);
    final client = FakePantryRecognitionClient(result: RecognitionResult.empty);
    final (repo, _) = await pumpFoodGate(tester, client, store: store);

    // Fire-and-forget: the seam awaits the pushed fallback route.
    unawaited(foodState(tester).runRecognition([Uint8List.fromList([1])]));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('recognition-empty')), findsOneWidget);
    expect(await repo.all(), isEmpty);
  });
}
