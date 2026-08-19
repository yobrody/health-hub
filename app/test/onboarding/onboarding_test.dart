// Widget test for the onboarding flow (Task 8).
//
// Verifies the honesty contract at the UI layer:
//  • The flow renders.
//  • A field can be SKIPPED, and the resulting saved Profile has that field null
//    (never a fabricated default).
//  • Completing the flow calls save().

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/onboarding/onboarding_flow.dart';
import 'package:health_hub/profile/profile_model.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class FakeProfileStore implements ProfileStore {
  Map<String, dynamic>? _saved;
  @override
  Future<Map<String, dynamic>?> load() async => _saved;
  @override
  Future<void> save(Map<String, dynamic> json) async =>
      _saved = Map<String, dynamic>.from(json);
}

class FakeProfileApi implements ProfileApi {
  Map<String, dynamic>? lastParams;
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async {
    lastParams = params;
    return ProbeStatus.online;
  }
}

ProfileRepo _repo() => ProfileRepo(
      api: FakeProfileApi(),
      outbox: Outbox(FakeOutboxStore()),
      store: FakeProfileStore(),
    );

void main() {
  testWidgets('renders the onboarding flow', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: OnboardingFlow(repo: _repo(), onDone: () {})),
    );
    expect(find.byKey(const Key('onboarding-flow')), findsOneWidget);
  });

  testWidgets('skipping every step saves an all-null profile (no defaults)',
      (tester) async {
    Profile? saved;
    final repo = _repo();
    await tester.pumpWidget(
      MaterialApp(home: OnboardingFlow(repo: repo, onDone: () {})),
    );

    // Tap "Skip" until the flow finishes (Skip advances without recording).
    // There are 7 fields; skipping each leaves it null.
    for (var i = 0; i < 7; i++) {
      await tester.tap(find.byKey(const Key('onboarding-skip')));
      await tester.pumpAndSettle();
    }

    saved = await repo.load();
    // Every field skipped → every field null. No 2200/140/72/80 anywhere.
    expect(saved.heightCm, isNull);
    expect(saved.ageYears, isNull);
    expect(saved.sex, isNull);
    expect(saved.weightKg, isNull);
    expect(saved.goalDirection, isNull);
    expect(saved.targetWeightKg, isNull);
    expect(saved.primaryGym, isNull);
    expect(saved.isEmpty, isTrue);
  });

  testWidgets('entering a weight then skipping the rest saves only that field',
      (tester) async {
    final repo = _repo();
    await tester.pumpWidget(
      MaterialApp(home: OnboardingFlow(repo: repo, onDone: () {})),
    );

    // Step 1 is height — skip it.
    await tester.tap(find.byKey(const Key('onboarding-skip')));
    await tester.pumpAndSettle();
    // Step 2 is age — skip it.
    await tester.tap(find.byKey(const Key('onboarding-skip')));
    await tester.pumpAndSettle();
    // Step 3 is sex — skip it.
    await tester.tap(find.byKey(const Key('onboarding-skip')));
    await tester.pumpAndSettle();
    // Step 4 is current weight — enter 62.5.
    await tester.enterText(find.byKey(const Key('onboarding-input')), '62.5');
    await tester.tap(find.byKey(const Key('onboarding-next')));
    await tester.pumpAndSettle();
    // Skip the rest (goal direction, goal weight, gym).
    for (var i = 0; i < 3; i++) {
      await tester.tap(find.byKey(const Key('onboarding-skip')));
      await tester.pumpAndSettle();
    }

    final saved = await repo.load();
    expect(saved.weightKg, 62.5);
    expect(saved.heightCm, isNull);
    expect(saved.ageYears, isNull);
    expect(saved.targetWeightKg, isNull);
  });

  testWidgets('finishing calls onDone', (tester) async {
    var done = false;
    final repo = _repo();
    await tester.pumpWidget(
      MaterialApp(home: OnboardingFlow(repo: repo, onDone: () => done = true)),
    );
    for (var i = 0; i < 7; i++) {
      await tester.tap(find.byKey(const Key('onboarding-skip')));
      await tester.pumpAndSettle();
    }
    expect(done, isTrue);
  });
}
