import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/gym/workout_session.dart';
import 'package:health_hub/gym/workout_repo.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';

/// In-memory [WorkoutStore] shared between "restart" repo instances.
class _FakeWorkoutStore implements WorkoutStore {
  List<WorkoutSession> _sessions = [];

  @override
  Future<List<WorkoutSession>> load() async => _sessions;

  @override
  Future<void> save(List<WorkoutSession> sessions) async {
    _sessions = sessions;
  }
}

/// In-memory [OutboxStore] so we can assert what got enqueued.
class _FakeOutboxStore implements OutboxStore {
  List<PendingMutation> _items = [];

  @override
  Future<List<PendingMutation>> load() async => _items;

  @override
  Future<void> save(List<PendingMutation> items) async {
    _items = items;
  }
}

void main() {
  late _FakeWorkoutStore store;
  late _FakeOutboxStore outboxStore;
  late Outbox outbox;
  late WorkoutRepo repo;

  setUp(() {
    store = _FakeWorkoutStore();
    outboxStore = _FakeOutboxStore();
    outbox = Outbox(outboxStore);
    repo = WorkoutRepo(outbox: outbox, store: store);
  });

  test('startSession persists a new unfinished session and enqueues', () async {
    final session = await repo.startSession();
    expect(session.finished, isFalse);

    final all = await repo.all();
    expect(all.length, 1);
    expect(all.first.id, session.id);

    final pending = await outbox.pending();
    expect(pending.length, 1);
    expect(pending.first.method, 'POST');
    expect(pending.first.path, '/workouts');
    expect(pending.first.dedupeKey, 'workout:${session.id}');
  });

  test('saveSet persists the set AND enqueues (queued, not failed)', () async {
    final session = await repo.startSession();
    await repo.addExercise(session.id, 'ex1');

    final outcome = await repo.saveSet(
      session.id,
      'ex1',
      0,
      const SetEntry(weightKg: 60, reps: 8, effort: SetEffort.easy, done: true),
    );
    expect(outcome, WriteOutcome.queued);

    final all = await repo.all();
    final ex = all.first.exercises.firstWhere((e) => e.exerciseId == 'ex1');
    expect(ex.sets.length, 1);
    expect(ex.sets[0].weightKg, 60);
    expect(ex.sets[0].reps, 8);
    expect(ex.sets[0].done, isTrue);
  });

  test('a fresh repo on the SAME store sees the saved set (survives restart)',
      () async {
    final session = await repo.startSession();
    await repo.addExercise(session.id, 'ex1');
    await repo.saveSet(
      session.id,
      'ex1',
      0,
      const SetEntry(weightKg: 100, reps: 5, done: true),
    );

    // Simulate an app restart: new repo, SAME underlying store.
    final freshRepo = WorkoutRepo(outbox: outbox, store: store);
    final all = await freshRepo.all();
    expect(all.length, 1);
    final ex = all.first.exercises.firstWhere((e) => e.exerciseId == 'ex1');
    expect(ex.sets.single.weightKg, 100);
    expect(ex.sets.single.reps, 5);
  });

  test('saveSet upserts an existing set by index', () async {
    final session = await repo.startSession();
    await repo.addExercise(session.id, 'ex1');
    await repo.saveSet(session.id, 'ex1', 0, const SetEntry(reps: 8));
    await repo.saveSet(session.id, 'ex1', 0, const SetEntry(reps: 10, done: true));

    final all = await repo.all();
    final ex = all.first.exercises.firstWhere((e) => e.exerciseId == 'ex1');
    expect(ex.sets.length, 1);
    expect(ex.sets[0].reps, 10);
    expect(ex.sets[0].done, isTrue);
  });

  test('saveSet auto-adds the exercise if it is not present yet', () async {
    final session = await repo.startSession();
    final outcome =
        await repo.saveSet(session.id, 'exNew', 0, const SetEntry(reps: 6));
    expect(outcome, WriteOutcome.queued);

    final all = await repo.all();
    expect(all.first.exercises.any((e) => e.exerciseId == 'exNew'), isTrue);
  });

  test('activeSession returns the latest unfinished session or null', () async {
    expect(await repo.activeSession(), isNull);

    final session = await repo.startSession();
    final active = await repo.activeSession();
    expect(active, isNotNull);
    expect(active!.id, session.id);
  });

  test('finishSession flips finished and activeSession then returns null',
      () async {
    final session = await repo.startSession();
    final outcome = await repo.finishSession(session.id);
    expect(outcome, WriteOutcome.queued);

    final all = await repo.all();
    expect(all.first.finished, isTrue);
    expect(await repo.activeSession(), isNull);
  });

  test('concurrent saveSet calls for different exercises BOTH persist '
      '(no lost write — the load→modify→save race)', () async {
    final session = await repo.startSession();

    // Fire two writes without awaiting between them — they interleave at the
    // async load→save boundary. Without serialized store mutations the second
    // save clobbers the first, silently dropping a logged set (the exact
    // "never lose a logged set" bug this repo exists to prevent).
    await Future.wait([
      repo.saveSet(session.id, 'exA', 0, const SetEntry(reps: 8, done: true)),
      repo.saveSet(session.id, 'exB', 0, const SetEntry(reps: 10, done: true)),
    ]);

    final all = await repo.all();
    final ids = all.first.exercises.map((e) => e.exerciseId).toSet();
    expect(ids, containsAll(<String>['exA', 'exB']),
        reason: 'both concurrent writes must survive — neither clobbers the other');
  });

  test('saveSet enqueues a PUT keyed to the session', () async {
    final session = await repo.startSession();
    await repo.saveSet(session.id, 'ex1', 0, const SetEntry(reps: 8));

    final pending = await outbox.pending();
    // Deduped by session — one entry, the latest PUT.
    expect(pending.length, 1);
    expect(pending.first.method, 'PUT');
    expect(pending.first.path, '/workouts/${session.id}');
    expect(pending.first.dedupeKey, 'workout:${session.id}');
  });
}
