// Widget test for the TodayPage honest empty-state demo (Task 8).
//
// Proves the pattern the whole app will follow: a not-yet-provided profile
// value renders as `—` (never a fabricated 80 kg / 72 kg), alongside a gentle
// "set this up" affordance that opens onboarding.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pages/today_page.dart';
import 'package:health_hub/profile/profile_repo.dart';

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

ProfileRepo _repo([Map<String, dynamic>? stored]) => ProfileRepo(
      api: FakeProfileApi(),
      outbox: Outbox(FakeOutboxStore()),
      store: FakeProfileStore(stored),
    );

void main() {
  testWidgets('renders today-page key', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: TodayPage(repo: _repo())),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('today-page')), findsOneWidget);
  });

  testWidgets('with no profile, weight/goal render as em-dash (no fake defaults)',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: TodayPage(repo: _repo())),
    );
    await tester.pumpAndSettle();

    // The honest empty state: em-dashes appear, and NO fabricated numbers do.
    expect(find.text('—'), findsWidgets);
    expect(find.text('80'), findsNothing);
    expect(find.text('72'), findsNothing);
    expect(find.text('80 kg'), findsNothing);
    expect(find.text('72 kg'), findsNothing);

    // A "set up" affordance is offered.
    expect(find.byKey(const Key('today-setup-profile')), findsOneWidget);
  });

  testWidgets('with a real weight, it renders the value, not a dash',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: TodayPage(repo: _repo({'weight_kg': 62.5}))),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('62.5'), findsWidgets);
  });
}
