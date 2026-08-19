import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── Fakes so the first-run gate resolves to the app (a profile "exists") and no
//    page hits a platform channel (secure storage / shared_preferences). ───────

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
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

// A repo whose store already holds a profile → hasProfile() == true → the gate
// shows the app immediately (the contract this test relies on).
ProfileRepo _repoWithProfile() => ProfileRepo(
      api: _FakeProfileApi(),
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakeProfileStore({'weight_kg': 62.5}),
    );

// In-memory workout store so GymPage's initState async never hits a platform
// channel → pumpAndSettle does not time out.
class _FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> _sessions = [];
  @override
  Future<List<WorkoutSession>> load() async => List.unmodifiable(_sessions);
  @override
  Future<void> save(List<WorkoutSession> sessions) async =>
      _sessions = List.of(sessions);
}

WorkoutRepo _workoutRepo() => WorkoutRepo(
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakeWorkoutStore(),
    );

void main() {
  testWidgets('root nav switches tabs', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          profileRepoProvider.overrideWithValue(_repoWithProfile()),
          workoutRepoProvider.overrideWithValue(_workoutRepo()),
        ],
        child: const HealthHubApp(),
      ),
    );
    await tester.pumpAndSettle();
    // starts on Today (first-run gate resolved to the app, not onboarding)
    expect(find.byKey(const Key('today-page')), findsOneWidget);
    // has all 5 destinations
    for (final label in ['Today', 'Food', 'Gym', 'Nutrition', 'Settings']) {
      expect(find.text(label), findsWidgets);
    }
    // tapping Gym shows the gym page
    await tester.tap(find.text('Gym'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gym-page')), findsOneWidget);
  });
}
