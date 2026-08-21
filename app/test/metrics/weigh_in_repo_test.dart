// Tests for WeighInRepo — many-per-user persist + Outbox-queued sync.
//
//   • add persists locally AND enqueues a POST /weigh-ins (queued, not failed);
//   • a fresh repo on the SAME store sees the reading (survives restart);
//   • latest() returns the genuinely-latest reading BY TIMESTAMP;
//   • concurrent adds BOTH survive — no lost write (the _synchronized lock);
//   • each add enqueues with a per-reading dedupeKey.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/metrics/weigh_in.dart';
import 'package:health_hub/metrics/weigh_in_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

class _FakeWeighInStore implements WeighInStore {
  List<WeighIn> _items = [];
  @override
  Future<List<WeighIn>> load() async => _items;
  @override
  Future<void> save(List<WeighIn> items) async => _items = items;
}

class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];
  @override
  Future<List<PendingMutation>> load() async => _items;
  @override
  Future<void> save(List<PendingMutation> items) async => _items = items;
}

void main() {
  late _FakeWeighInStore store;
  late Outbox outbox;
  late WeighInRepo repo;

  setUp(() {
    store = _FakeWeighInStore();
    outbox = Outbox(_FakeOutboxStore());
    repo = WeighInRepo(outbox: outbox, store: store);
  });

  test('add persists locally AND enqueues POST /weigh-ins (queued)', () async {
    final w = WeighIn(id: 'weigh-1', at: DateTime(2026, 8, 21), weightKg: 62.5);
    final outcome = await repo.add(w);
    expect(outcome, WriteOutcome.queued);

    final all = await repo.all();
    expect(all.single.weightKg, 62.5);

    final pending = await outbox.pending();
    expect(pending.length, 1);
    expect(pending.first.method, 'POST');
    expect(pending.first.path, '/weigh-ins');
    expect(pending.first.dedupeKey, 'weigh-in:weigh-1');
    expect(pending.first.body!['weightKg'], 62.5);
  });

  test('a fresh repo on the SAME store sees the reading (survives restart)',
      () async {
    await repo.add(WeighIn(id: 'weigh-1', at: DateTime(2026, 8, 21), weightKg: 62));
    final fresh = WeighInRepo(outbox: outbox, store: store);
    expect((await fresh.all()).single.weightKg, 62);
  });

  test('latest() returns the genuinely-latest reading by timestamp', () async {
    await repo.add(WeighIn(id: 'a', at: DateTime(2026, 8, 1), weightKg: 65));
    await repo.add(WeighIn(id: 'b', at: DateTime(2026, 8, 20), weightKg: 62));
    // Add an OLDER reading last — latest() must still return the Aug 20 one.
    await repo.add(WeighIn(id: 'c', at: DateTime(2026, 8, 10), weightKg: 63));

    final latest = await repo.latest();
    expect(latest!.id, 'b');
    expect(latest.weightKg, 62);
  });

  test('latest() on an empty history → null', () async {
    expect(await repo.latest(), isNull);
  });

  test('concurrent adds BOTH survive — no lost write (the _synchronized lock)',
      () async {
    // Fire two adds without awaiting between them — they interleave at the
    // async load→save boundary. Without the serialized lock the second save
    // clobbers the first, silently dropping a reading.
    await Future.wait([
      repo.add(WeighIn(id: 'x', at: DateTime(2026, 8, 1), weightKg: 65)),
      repo.add(WeighIn(id: 'y', at: DateTime(2026, 8, 2), weightKg: 64)),
    ]);
    final ids = (await repo.all()).map((w) => w.id).toSet();
    expect(ids, containsAll(<String>['x', 'y']),
        reason: 'both concurrent adds must survive — neither clobbers the other');
  });
}
