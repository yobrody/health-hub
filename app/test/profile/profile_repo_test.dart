// Tests for ProfileRepo (Task 8).
//
// Contract:
//  • Saving ONLINE PUTs only the non-null fields (a skipped field is never sent
//    as a fabricated value).
//  • Saving OFFLINE (client throws / degraded) enqueues via the Outbox and
//    reports WriteOutcome.queued — NEVER failed.
//  • The profile is persisted locally so onboarding survives a restart.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/profile/profile_model.dart';
import 'package:health_hub/profile/profile_repo.dart';

// ── In-memory fake OutboxStore (mirrors outbox_test.dart) ────────────────────

class FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_items);

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = List.of(items);
  }
}

// ── In-memory fake local profile store ───────────────────────────────────────

class FakeProfileStore implements ProfileStore {
  Map<String, dynamic>? _saved;

  @override
  Future<Map<String, dynamic>?> load() async => _saved;

  @override
  Future<void> save(Map<String, dynamic> json) async {
    _saved = Map<String, dynamic>.from(json);
  }
}

// ── Fake ApiClient profile PUT ───────────────────────────────────────────────

/// Records the params sent and simulates online / offline / degraded.
class FakeProfileApi implements ProfileApi {
  FakeProfileApi({this.result = ProbeStatus.online, this.throwOnCall = false});

  ProbeStatus result;
  bool throwOnCall;
  Map<String, dynamic>? lastParams;
  int calls = 0;

  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async {
    calls++;
    lastParams = params;
    if (throwOnCall) {
      throw Exception('network down');
    }
    return result;
  }
}

void main() {
  group('ProfileRepo.save — online', () {
    test('PUTs only the non-null fields (skipped fields never sent)', () async {
      final api = FakeProfileApi(result: ProbeStatus.online);
      final outbox = Outbox(FakeOutboxStore());
      final store = FakeProfileStore();
      final repo = ProfileRepo(api: api, outbox: outbox, store: store);

      // weight + goal set; everything else skipped (null).
      const profile = Profile(weightKg: 62.5, goalDirection: 'gain');
      final outcome = await repo.save(profile);

      expect(outcome, WriteOutcome.sent);
      expect(api.calls, 1);
      // Only the two provided fields were sent.
      expect(api.lastParams, {'weight_kg': 62.5, 'goal_direction': 'gain'});
      // Not a single fabricated value.
      expect(api.lastParams!.containsKey('height_cm'), isFalse);
      expect(api.lastParams!.containsKey('target_weight_kg'), isFalse);
      expect(api.lastParams!.values, isNot(contains(80)));
      expect(api.lastParams!.values, isNot(contains(72)));
    });

    test("maps goalDirection 'cut' → backend 'lose'", () async {
      final api = FakeProfileApi(result: ProbeStatus.online);
      final repo = ProfileRepo(
        api: api,
        outbox: Outbox(FakeOutboxStore()),
        store: FakeProfileStore(),
      );
      await repo.save(const Profile(goalDirection: 'cut'));
      expect(api.lastParams!['goal_direction'], 'lose');
    });

    test('an all-null profile sends NO fabricated params', () async {
      final api = FakeProfileApi(result: ProbeStatus.online);
      final repo = ProfileRepo(
        api: api,
        outbox: Outbox(FakeOutboxStore()),
        store: FakeProfileStore(),
      );
      await repo.save(const Profile());
      expect(api.lastParams, isEmpty);
    });

    test('persists the profile locally on save', () async {
      final store = FakeProfileStore();
      final repo = ProfileRepo(
        api: FakeProfileApi(result: ProbeStatus.online),
        outbox: Outbox(FakeOutboxStore()),
        store: store,
      );
      await repo.save(const Profile(weightKg: 62.5));
      final loaded = await repo.load();
      expect(loaded.weightKg, 62.5);
    });
  });

  group('ProfileRepo.save — offline / degraded → queued (never failed)', () {
    test('a thrown network error enqueues and reports queued, not failed', () async {
      final api = FakeProfileApi(throwOnCall: true);
      final outbox = Outbox(FakeOutboxStore());
      final repo = ProfileRepo(
        api: api,
        outbox: outbox,
        store: FakeProfileStore(),
      );

      final outcome = await repo.save(const Profile(weightKg: 62.5));

      expect(outcome, WriteOutcome.queued);
      expect(outcome, isNot(WriteOutcome.failed));
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.first.method, 'PUT');
      expect(pending.first.path, '/tdee/profile');
      expect(pending.first.body, {'weight_kg': 62.5});
    });

    test('a degraded/offline status enqueues and reports queued', () async {
      final api = FakeProfileApi(result: ProbeStatus.offline);
      final outbox = Outbox(FakeOutboxStore());
      final repo = ProfileRepo(
        api: api,
        outbox: outbox,
        store: FakeProfileStore(),
      );

      final outcome = await repo.save(const Profile(goalDirection: 'gain'));

      expect(outcome, WriteOutcome.queued);
      expect((await outbox.pending()), hasLength(1));
    });

    test('the queued mutation carries only non-null fields (no fabrication)', () async {
      final api = FakeProfileApi(throwOnCall: true);
      final outbox = Outbox(FakeOutboxStore());
      final repo = ProfileRepo(
        api: api,
        outbox: outbox,
        store: FakeProfileStore(),
      );
      await repo.save(const Profile(weightKg: 62.5, goalDirection: 'gain'));
      final body = (await outbox.pending()).first.body!;
      expect(body, {'weight_kg': 62.5, 'goal_direction': 'gain'});
      expect(body.containsKey('target_weight_kg'), isFalse);
      expect(body.values, isNot(contains(72)));
    });

    test('offline save still persists locally (onboarding survives restart)', () async {
      final store = FakeProfileStore();
      final repo = ProfileRepo(
        api: FakeProfileApi(throwOnCall: true),
        outbox: Outbox(FakeOutboxStore()),
        store: store,
      );
      await repo.save(const Profile(weightKg: 62.5));
      expect((await repo.load()).weightKg, 62.5);
    });
  });

  group('ProfileRepo.load / hasProfile — first-run detection', () {
    test('no stored profile → hasProfile false, load is all-null', () async {
      final repo = ProfileRepo(
        api: FakeProfileApi(),
        outbox: Outbox(FakeOutboxStore()),
        store: FakeProfileStore(),
      );
      expect(await repo.hasProfile(), isFalse);
      expect((await repo.load()).isEmpty, isTrue);
    });

    test('after a save → hasProfile true', () async {
      final repo = ProfileRepo(
        api: FakeProfileApi(),
        outbox: Outbox(FakeOutboxStore()),
        store: FakeProfileStore(),
      );
      await repo.save(const Profile(weightKg: 62.5));
      expect(await repo.hasProfile(), isTrue);
    });
  });
}
