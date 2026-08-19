// Unit tests for GoalResetController (Task 9).
//
// Verifies that reset():
//   • Nulls out goalDirection AND targetWeightKg on the stored Profile.
//   • Does NOT fabricate any value (the reset Profile is honest-null).
//   • Saves the updated Profile via ProfileRepo.
//
// Uses in-memory fakes throughout — no platform channels, no I/O.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_repo.dart';
import 'package:health_hub/settings/goal_reset_controller.dart';

// ── In-memory fakes (same pattern as the profile_repo tests) ─────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);
  @override
  Future<void> save(List<PendingMutation> items) async => _items = List.of(items);
}

class FakeProfileStore implements ProfileStore {
  Map<String, dynamic>? _saved;
  FakeProfileStore([this._saved]);
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
  test('reset() nulls goalDirection and targetWeightKg, saves, no fabrication',
      () async {
    // Start with a profile that has goal fields set.
    final repo = _repo({
      'weight_kg': 62.5,
      'goal_direction': 'gain',
      'target_weight_kg': 72.0,
    });

    final controller = GoalResetController(repo: repo);
    await controller.reset();

    final loaded = await repo.load();

    // Goal fields must be null — not 72, not 'gain', not any default.
    expect(loaded.goalDirection, isNull);
    expect(loaded.targetWeightKg, isNull);

    // Non-goal fields must be preserved (reset touches only goal fields).
    expect(loaded.weightKg, 62.5);
  });

  test('reset() on an already-empty profile saves without fabricating anything',
      () async {
    final repo = _repo(); // no stored profile
    final controller = GoalResetController(repo: repo);
    await controller.reset();

    final loaded = await repo.load();
    expect(loaded.goalDirection, isNull);
    expect(loaded.targetWeightKg, isNull);
    // Nothing was fabricated.
    expect(loaded.weightKg, isNull);
    expect(loaded.heightCm, isNull);
  });

  test('reset() does not set goalDirection to any non-null value', () async {
    final repo = _repo({'goal_direction': 'cut', 'target_weight_kg': 65.0});
    final controller = GoalResetController(repo: repo);
    await controller.reset();

    final loaded = await repo.load();
    expect(loaded.goalDirection, isNull);
    expect(loaded.targetWeightKg, isNull);
  });
}
