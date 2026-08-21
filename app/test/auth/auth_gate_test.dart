// Auth-gate precedence tests (P4-D1). Verifies the gate in app.dart:
//   1. Not authenticated            → AuthScreen
//   2. Authenticated, no profile    → onboarding
//   3. Authenticated, has profile   → the app (RootScaffold / Today)
//
// Driven entirely by provider overrides (authServiceProvider drives the
// authStateProvider stream; profileRepoProvider drives hasProfileProvider).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/app.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_repo.dart';

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

const _signedIn =
    AuthUser(id: 'u1', email: 'brody@example.com', emailConfirmed: true);

Widget _app({
  required FakeAuthService auth,
  Map<String, dynamic>? profile,
}) =>
    ProviderScope(
      overrides: [
        authServiceProvider.overrideWithValue(auth),
        profileRepoProvider.overrideWithValue(_repo(profile)),
        workoutRepoProvider.overrideWithValue(_workoutRepo()),
      ],
      child: const HealthHubApp(),
    );

void main() {
  group('auth gate precedence', () {
    testWidgets('not authenticated → AuthScreen', (tester) async {
      final auth = FakeAuthService(); // no initial user
      await tester.pumpWidget(_app(auth: auth));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('auth-screen')), findsOneWidget);
      expect(find.byKey(const Key('onboarding-flow')), findsNothing);
      expect(find.byKey(const Key('today-page')), findsNothing);
      auth.dispose();
    });

    testWidgets('authenticated + no profile → onboarding', (tester) async {
      final auth = FakeAuthService(initialUser: _signedIn);
      await tester.pumpWidget(_app(auth: auth)); // profile == null
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('onboarding-flow')), findsOneWidget);
      expect(find.byKey(const Key('auth-screen')), findsNothing);
      expect(find.byKey(const Key('today-page')), findsNothing);
      auth.dispose();
    });

    testWidgets('authenticated + has profile → the app (Today)',
        (tester) async {
      final auth = FakeAuthService(initialUser: _signedIn);
      await tester.pumpWidget(
        _app(auth: auth, profile: {'weight_kg': 62.5}),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('today-page')), findsOneWidget);
      expect(find.byKey(const Key('auth-screen')), findsNothing);
      expect(find.byKey(const Key('onboarding-flow')), findsNothing);
      auth.dispose();
    });

    testWidgets('sign-out from an authed session returns to AuthScreen',
        (tester) async {
      final auth = FakeAuthService(initialUser: _signedIn);
      await tester.pumpWidget(
        _app(auth: auth, profile: {'weight_kg': 62.5}),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('today-page')), findsOneWidget);

      // Sign out programmatically → the stream drives the gate back to auth.
      await auth.signOut();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('auth-screen')), findsOneWidget);
      expect(find.byKey(const Key('today-page')), findsNothing);
      auth.dispose();
    });
  });
}
