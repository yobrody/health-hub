// EXHAUSTIVE state coverage — every EMPTY, OFFLINE, and ERROR state, plus the
// honest `—` / `~` displays, driven through the REAL app.
//
// The honesty spine: nothing is ever fabricated. An absent value shows `—`, an
// estimate shows `~`, a queued offline write is a SUCCESS (never surfaced as a
// failure), a failed sync is surfaced truthfully with a retry, and a no-result
// barcode falls back to manual entry rather than inventing a product.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/nutrition/food_log_entry.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/sync/send_result.dart';
import 'package:health_hub/pages/nutrition_page.dart';
import 'package:health_hub/pantry/pantry_item.dart';

import 'coverage_scope.dart';
import 'journey_scope.dart';

void main() {
  Finder pageScroll(Key pageKey) => find
      .descendant(of: find.byKey(pageKey), matching: find.byType(Scrollable))
      .first;

  Future<void> pumpApp(WidgetTester tester, List<Override> overrides) async {
    await tester.pumpWidget(
      ProviderScope(overrides: overrides, child: const HealthHubApp()),
    );
    await tester.pumpAndSettle();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMPTY STATES — honest setup prompts, never fabrication
  // ══════════════════════════════════════════════════════════════════════════
  group('Empty states', () {
    testWidgets('no data anywhere: Home has no fabricated Brain guidance',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      // No goal / pantry / workout → the "For you" section is omitted entirely
      // (Home excludes setup prompts; nothing genuine to show).
      expect(find.byKey(const Key('home-brain')), findsNothing);
      // The nutrition card's honest empty caption.
      await tester.scrollUntilVisible(
        find.text('Nothing logged yet today.'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Nothing logged yet today.'), findsOneWidget);
    });

    testWidgets('empty pantry → Food gate (never a fabricated kitchen)',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('food-gate')), findsOneWidget);
      expect(find.byKey(const Key('kitchen-scene')), findsNothing);
    });

    testWidgets('no workout history → Gym shows the honest TRAIN setup prompt',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Gym'));
      await tester.pumpAndSettle();
      // A setup prompt, never a fabricated "due in N days".
      expect(find.byKey(const Key('insight-card-train-setup')), findsOneWidget);
      expect(find.byKey(const Key('insight-card-train')), findsNothing);
    });

    testWidgets('no goal → Nutrition shows the honest EAT setup prompt',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('insight-card-eat-setup')), findsOneWidget);
      // The honest empty log line (below the form — scroll to it).
      await tester.scrollUntilVisible(
        find.text('Nothing logged today.'),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      expect(find.text('Nothing logged today.'), findsOneWidget);
    });

    testWidgets('empty grocery list → honest "Your list is empty"',
        (tester) async {
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Cart'));
      await tester.pumpAndSettle();
      expect(find.text('Your list is empty'), findsOneWidget);
    });

    testWidgets('an empty zone shows an honest "is empty" (no fabricated items)',
        (tester) async {
      // A fridge item so the kitchen scene renders, but the FREEZER is empty.
      final h = JourneyHarness(pantry: [
        const PantryItem(
            id: 'a', name: 'A', zone: PantryZone.fridge, source: 'manual'),
      ]);
      await pumpApp(tester, h.overrides);
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kitchen-zone-freezer')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('kitchen-zone-empty')), findsOneWidget);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HONEST `—` / `~` DISPLAYS
  // ══════════════════════════════════════════════════════════════════════════
  group('Honest displays', () {
    testWidgets('no goal weight → the GOAL badge shows "—", not a fabricated 72',
        (tester) async {
      final h = JourneyHarness(); // profile has only the sentinel weight_kg
      await pumpApp(tester, h.overrides);
      await tester.scrollUntilVisible(
        find.text('GOAL'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      // The GOAL label is present with a dash value (no target weight set).
      expect(find.text('GOAL'), findsOneWidget);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('a Guess entry renders with the honest ~ marker in the log',
        (tester) async {
      final h = JourneyHarness(food: [
        FoodLogEntry(
          id: 'g1',
          name: '~Curry',
          at: DateTime.now(),
          kcal: null, // unmeasured → shows as — in the tile detail
          tier: AccuracyTier.estimate,
          source: 'manual',
        ),
      ]);
      await pumpApp(tester, h.overrides);
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      // Scroll down to today's log (below the form).
      await tester.scrollUntilVisible(
        find.text("TODAY'S LOG"),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      // The estimate marker (~) is shown next to the name.
      expect(find.text('~'), findsWidgets);
      // Unmeasured kcal shows as — in the tile (never a fabricated 0).
      expect(find.textContaining('— kcal'), findsWidgets);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OFFLINE — writes queue (never lost), sync banner is honest
  // ══════════════════════════════════════════════════════════════════════════
  group('Offline', () {
    testWidgets('a queued write is a SUCCESS — the meal persists + is on the log',
        (tester) async {
      // The harness repos ALWAYS queue through their in-memory outbox (the
      // MemProfileApi/outbox return a non-online status), so logging a meal here
      // exercises the offline-queued path: the write must land, not "fail".
      final h = JourneyHarness();
      await pumpApp(tester, h.overrides);
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('nutrition-name')), 'Offline meal');
      await tester.enterText(find.byKey(const Key('nutrition-kcal')), '350');
      await tester.scrollUntilVisible(
        find.byKey(const Key('nutrition-log-btn')),
        200,
        scrollable: pageScroll(const Key('nutrition-page')),
      );
      await tester.tap(find.byKey(const Key('nutrition-log-btn')));
      await tester.pumpAndSettle();

      // The write genuinely persisted (queued == success — never lost, never a
      // surfaced failure), and appears on today's log.
      final log = await h.nutritionRepo.all();
      expect(log.single.name, 'Offline meal');
      expect(find.text('Offline meal'), findsWidgets);
    });

    testWidgets('pending outbox → the honest "Syncing…" banner is shown',
        (tester) async {
      final h = JourneyHarness();
      final outbox = Outbox(MemOutboxStore([samplePending('p1'), samplePending('p2')]));
      addTearDown(outbox.dispose);
      await pumpApp(tester, coverageOverrides(h, outbox: outbox));
      expect(find.byKey(const Key('sync-status-pending')), findsOneWidget);
      // The count is REAL (2 queued) — never a fabricated status.
      expect(find.textContaining('2 changes queued'), findsOneWidget);
      // Never the failed banner while only pending.
      expect(find.byKey(const Key('sync-status-failed')), findsNothing);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ERROR PATHS — surfaced truthfully
  // ══════════════════════════════════════════════════════════════════════════
  group('Error paths', () {
    testWidgets('failed sync → honest warning banner + a working retry',
        (tester) async {
      final h = JourneyHarness();
      // Seed the outbox, then move the item to the FAILED state (a permanent
      // reject) so the banner shows the honest "couldn't sync" warning.
      final outbox = Outbox(MemOutboxStore([samplePending('f1')]));
      addTearDown(outbox.dispose);
      await outbox.flushClassified((_) async => SendResult.rejectPermanent);
      await pumpApp(tester, coverageOverrides(h, outbox: outbox));

      expect(find.byKey(const Key('sync-status-failed')), findsOneWidget);
      expect(find.textContaining("couldn't sync"), findsOneWidget);

      // Tapping "Try again" requeues the failed write (moves failed → pending):
      // the failed banner clears, the pending banner appears — nothing is lost.
      await tester.tap(find.byKey(const Key('sync-status-retry')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sync-status-failed')), findsNothing);
      expect(find.byKey(const Key('sync-status-pending')), findsOneWidget);
      // The write survived the round-trip (requeued, not dropped).
      expect(await outbox.pending(), hasLength(1));
      expect(await outbox.failed(), isEmpty);
    });

    testWidgets('barcode with NO result → no fabricated product (manual entry)',
        (tester) async {
      final h = JourneyHarness();
      // A stub OFF client that resolves every code to null (no product found).
      await pumpApp(
          tester, coverageOverrides(h, offClient: StubOffClient(null)));
      await tester.tap(find.byKey(const Key('home-log-meal-btn')));
      await tester.pumpAndSettle();

      final state =
          tester.state<NutritionPageState>(find.byType(NutritionPage));
      await state.handleBarcodeResult('9999999999999');
      await tester.pumpAndSettle();

      // Nothing was pre-filled or logged — the user must add it manually.
      expect(await h.nutritionRepo.all(), isEmpty);
      // The name field is empty (no fabricated product name).
      final nameField =
          tester.widget<TextField>(find.byKey(const Key('nutrition-name')));
      expect(nameField.controller?.text ?? '', isEmpty);
    });
  });
}
