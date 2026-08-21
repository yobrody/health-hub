// First-run gate (P1 Task 1).
//
// app.dart shows onboarding when no profile has ever been saved on this device
// (ProfileRepo.hasProfile() == false), and the RootScaffold (Today) otherwise.
// This is driven by a provider (hasProfileProvider) so tests — including the
// existing nav test — can override it deterministically without a real store.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

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

ProfileRepo _repo([Map<String, dynamic>? stored]) => ProfileRepo(
      api: _FakeProfileApi(),
      outbox: Outbox(_FakeOutboxStore()),
      store: _FakeProfileStore(stored),
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

// A signed-in user so the auth gate resolves to the profile step under test.
const _signedIn =
    AuthUser(id: 'u1', email: 'brody@example.com', emailConfirmed: true);

void main() {
  testWidgets('no profile → onboarding is shown', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authServiceProvider.overrideWithValue(
            FakeAuthService(initialUser: _signedIn),
          ),
          profileRepoProvider.overrideWithValue(_repo()),
          workoutRepoProvider.overrideWithValue(_workoutRepo()),
        ],
        child: const HealthHubApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('onboarding-flow')), findsOneWidget);
    expect(find.byKey(const Key('today-page')), findsNothing);
  });

  testWidgets('existing profile → the app (Today) is shown', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authServiceProvider.overrideWithValue(
            FakeAuthService(initialUser: _signedIn),
          ),
          profileRepoProvider.overrideWithValue(_repo({'weight_kg': 62.5})),
          workoutRepoProvider.overrideWithValue(_workoutRepo()),
        ],
        child: const HealthHubApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('today-page')), findsOneWidget);
    expect(find.byKey(const Key('onboarding-flow')), findsNothing);
  });
}
