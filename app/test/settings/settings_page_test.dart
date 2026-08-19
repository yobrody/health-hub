// Widget smoke test for SettingsPage (Task 9).
//
// Asserts:
//   • The settings-page key is present (required by the nav test).
//   • All 8 section rows are visible (by stable Key).
//   • The page key survives rendering inside a full MaterialApp.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/core/secrets.dart';
import 'package:health_hub/core/secure_store.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/settings/settings_page.dart';

// ── Fakes ─────────────────────────────────────────────────────────────────────

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
  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.online;
}

class FakeSecureStore implements SecureStore {
  final _data = <String, String>{};
  @override
  Future<void> write(String key, String value) async => _data[key] = value;
  @override
  Future<String?> read(String key) async => _data[key];
  @override
  Future<void> delete(String key) async => _data.remove(key);
}

ProfileRepo _repo() => ProfileRepo(
      api: FakeProfileApi(),
      outbox: Outbox(FakeOutboxStore()),
      store: FakeProfileStore(),
    );

/// Pump SettingsPage with repo + secrets injected. A ProviderScope wraps it so
/// the ConsumerState has a ProviderContainer even though no provider is read
/// (every dependency is supplied explicitly).
Widget _harness() => ProviderScope(
      child: MaterialApp(
        home: SettingsPage(
          repo: _repo(),
          secrets: Secrets(FakeSecureStore()),
        ),
      ),
    );

// ── Tests ──────────────────────────────────────────────────────────────────────

void main() {
  testWidgets('settings-page key is present (nav test contract)', (tester) async {
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('settings-page')), findsOneWidget);
  });

  testWidgets('all 8 section rows are rendered', (tester) async {
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // Every section has a stable key: settings-<name>
    for (final key in [
      'settings-health-connections',
      'settings-health-key',
      'settings-budget',
      'settings-units',
      'settings-gyms',
      'settings-goal-reset',
      'settings-notifications',
      'settings-privacy',
    ]) {
      expect(find.byKey(Key(key)), findsOneWidget, reason: 'missing: $key');
    }
  });

  testWidgets('section labels are visible', (tester) async {
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('Health connections'), findsOneWidget);
    expect(find.text('Health key'), findsOneWidget);
    expect(find.text('Budget'), findsOneWidget);
    expect(find.text('Units'), findsOneWidget);
    expect(find.text('Gyms'), findsOneWidget);
    expect(find.text('Goal reset'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Privacy'), findsOneWidget);
  });
}
