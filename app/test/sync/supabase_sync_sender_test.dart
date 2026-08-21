// Tests for SupabaseSyncSender — the Supabase-backed flush destination for the
// shared Outbox (P4-D3).
//
// Everything runs through a FakeSupabaseWriter + FakeAuthService: no real
// Supabase.instance, no network. The load-bearing guarantees under test:
//   • path → table mapping (incl. profile's `/tdee/profile` and the reserve
//     goals/weigh-ins routes);
//   • an UNKNOWN path is NOT dropped (stays queued → non-online);
//   • no authenticated user → NOT dropped (stays queued);
//   • an authed upsert carries user_id + the full body as `data` and lifts the
//     flat columns faithfully;
//   • an upsert conflicts on the right column (id vs user_id singleton);
//   • a DELETE mutation deletes by id;
//   • a writer throw keeps the mutation queued (non-online).

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/api/probe_status.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/sync/send_result.dart';
import 'package:health_hub/sync/supabase_sync_sender.dart';
import 'package:health_hub/sync/supabase_writer.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;

/// Records every upsert/delete; can be armed to throw. Never touches a network.
class FakeSupabaseWriter implements SupabaseWriter {
  final List<({String table, Map<String, dynamic> row, String onConflict})>
      upserts = [];
  final List<({String table, String idColumn, String idValue})> deletes = [];
  final Map<String, List<Map<String, dynamic>>> _tables = {};
  bool throwOnWrite = false;

  /// If set, writes throw THIS instead of the generic StateError — lets a test
  /// drive the PostgREST permanent-vs-transient classification.
  Object? throwWith;

  void seed(String table, List<Map<String, dynamic>> rows) =>
      _tables[table] = rows;

  Never _fail() => throw (throwWith ?? StateError('write failed'));

  @override
  Future<void> upsert(
    String table,
    Map<String, dynamic> row, {
    required String onConflict,
  }) async {
    if (throwOnWrite || throwWith != null) _fail();
    upserts.add((table: table, row: row, onConflict: onConflict));
  }

  @override
  Future<void> deleteById(
    String table, {
    required String idColumn,
    required String idValue,
  }) async {
    if (throwOnWrite || throwWith != null) _fail();
    deletes.add((table: table, idColumn: idColumn, idValue: idValue));
  }

  @override
  Future<List<Map<String, dynamic>>> selectAll(String table) async =>
      _tables[table] ?? const [];
}

const _user = AuthUser(id: 'user-123', email: 'a@b.c', emailConfirmed: true);

SupabaseSyncSender _sender(
  FakeSupabaseWriter writer, {
  AuthUser? user = _user,
}) =>
    SupabaseSyncSender(
      writer: writer,
      auth: FakeAuthService(initialUser: user),
    );

PendingMutation _mut({
  required String path,
  String method = 'PUT',
  Map<String, dynamic>? body,
}) =>
    PendingMutation(
      id: 'm-1',
      dedupeKey: 'k',
      method: method,
      path: path,
      body: body,
      createdAt: 0,
    );

void main() {
  group('path → table mapping', () {
    test('/workouts and /workouts/{id} → workouts', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      await s.sendMutation(_mut(path: '/workouts', body: {'id': 'w-1', 'at': 't'}));
      await s.sendMutation(
          _mut(path: '/workouts/w-2', body: {'id': 'w-2', 'at': 't'}));
      expect(w.upserts.map((u) => u.table), ['workouts', 'workouts']);
    });

    test('/pantry → pantry_items, /nutrition → food_log_entries', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      await s.sendMutation(_mut(
          path: '/pantry',
          body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'}));
      await s.sendMutation(_mut(
          path: '/nutrition',
          body: {'id': 'food-1', 'name': 'Coffee', 'at': 't'}));
      expect(w.upserts.map((u) => u.table),
          ['pantry_items', 'food_log_entries']);
    });

    test('/tdee/profile → profile singleton (conflict on user_id)', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final r = await s.sendMutation(
          _mut(path: '/tdee/profile', body: {'weight_kg': 62.5}));
      expect(r, ProbeStatus.online);
      expect(w.upserts.single.table, 'profile');
      expect(w.upserts.single.onConflict, 'user_id');
      // Singleton row carries NO client id (keyed on user_id).
      expect(w.upserts.single.row.containsKey('id'), isFalse);
    });

    test('reserve routes: /goals → nutrition_goals, /weigh-ins → weigh_ins',
        () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      await s.sendMutation(_mut(path: '/goals', body: {'caloriesKcal': 2500}));
      await s.sendMutation(_mut(
          path: '/weigh-ins/weigh-1',
          body: {'id': 'weigh-1', 'weightKg': 62.5, 'at': 't'}));
      expect(w.upserts.map((u) => u.table), ['nutrition_goals', 'weigh_ins']);
    });

    test('/goals lifts the four targets + user_id + data (singleton)', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final body = {
        'caloriesKcal': 2500,
        'proteinG': 150,
        'carbsG': 250,
        'fatG': 70,
      };
      final r = await s.sendMutation(_mut(path: '/goals', body: body));
      expect(r, ProbeStatus.online);
      final u = w.upserts.single;
      expect(u.table, 'nutrition_goals');
      expect(u.onConflict, 'user_id'); // singleton keyed on user_id
      expect(u.row['user_id'], 'user-123');
      // nutrition_goals has a required `id` PK; a STABLE per-user id is set so
      // the NOT-NULL PK is satisfied and replays upsert idempotently.
      expect(u.row['id'], 'goals-user-123');
      expect(u.row['data'], body); // full snapshot = source of truth
      // Flat columns lifted (camelCase → snake_case).
      expect(u.row['calories_kcal'], 2500);
      expect(u.row['protein_g'], 150);
      expect(u.row['carbs_g'], 250);
      expect(u.row['fat_g'], 70);
    });

    test('/goals with an unset target leaves that column absent (NULL, honest)',
        () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      // Only calories set — the three macro targets are absent from the body.
      await s.sendMutation(_mut(path: '/goals', body: {'caloriesKcal': 2200}));
      final row = w.upserts.single.row;
      expect(row['calories_kcal'], 2200);
      // No fabricated 0s for the unset macros.
      expect(row.containsKey('protein_g'), isFalse);
      expect(row.containsKey('carbs_g'), isFalse);
      expect(row.containsKey('fat_g'), isFalse);
    });

    test('/weigh-ins lifts weight_kg + at + id + user_id + data', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final body = {
        'id': 'weigh-1',
        'at': '2026-08-21T08:00:00.000',
        'weightKg': 62.5,
      };
      final r =
          await s.sendMutation(_mut(path: '/weigh-ins', body: body));
      expect(r, ProbeStatus.online);
      final u = w.upserts.single;
      expect(u.table, 'weigh_ins');
      expect(u.onConflict, 'id'); // multi-row keyed on id
      expect(u.row['user_id'], 'user-123');
      expect(u.row['id'], 'weigh-1');
      expect(u.row['data'], body);
      expect(u.row['weight_kg'], 62.5);
      expect(u.row['at'], '2026-08-21T08:00:00.000');
    });

    test('/weigh-ins with a null weight leaves weight_kg absent (honest)',
        () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      // A reading with no weight (weightKg omitted by the model's toJson).
      await s.sendMutation(_mut(
          path: '/weigh-ins',
          body: {'id': 'weigh-2', 'at': '2026-08-21T08:00:00.000'}));
      final row = w.upserts.single.row;
      expect(row['id'], 'weigh-2');
      expect(row.containsKey('weight_kg'), isFalse); // never a fabricated 0
      expect(row['at'], '2026-08-21T08:00:00.000');
    });

    test('UNKNOWN path is NOT dropped — stays queued (offline)', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final r = await s.sendMutation(_mut(path: '/mystery', body: {'id': 'x'}));
      expect(r, ProbeStatus.offline);
      expect(w.upserts, isEmpty);
      expect(w.deletes, isEmpty);
    });
  });

  group('user scoping + row shape', () {
    test('an authed upsert carries user_id + full body as data', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final body = {
        'id': 'food-1',
        'name': 'Coffee',
        'at': '2026-08-21T08:00:00.000',
        'kcal': 0.0,
        'proteinG': 0.3,
        'tier': 'exact',
        'ateOut': false,
        'source': 'manual',
        'shared': false,
      };
      final r = await s.sendMutation(_mut(path: '/nutrition', body: body));
      expect(r, ProbeStatus.online);
      final row = w.upserts.single.row;
      expect(row['user_id'], 'user-123');
      expect(row['id'], 'food-1');
      expect(row['data'], body); // the whole aggregate = source of truth.
      // Flat columns lifted faithfully (camelCase → snake_case).
      expect(row['name'], 'Coffee');
      expect(row['protein_g'], 0.3);
      expect(row['kcal'], 0.0); // a real 0 is preserved, not dropped.
      expect(row['tier'], 'exact');
      // A field absent from the body is NOT fabricated.
      expect(row.containsKey('carbs_g'), isFalse);
    });

    test('profile lifts flat cols from the backend-param body (age→age_years)',
        () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      await s.sendMutation(_mut(path: '/tdee/profile', body: {
        'weight_kg': 62.5,
        'age': 30,
        'goal_direction': 'gain',
      }));
      final row = w.upserts.single.row;
      expect(row['user_id'], 'user-123');
      expect(row['weight_kg'], 62.5);
      expect(row['age_years'], 30);
      expect(row['goal_direction'], 'gain');
      expect(row['data'], {
        'weight_kg': 62.5,
        'age': 30,
        'goal_direction': 'gain',
      });
    });

    test('multi-row upsert conflicts on id', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      await s.sendMutation(_mut(
          path: '/pantry',
          body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'}));
      expect(w.upserts.single.onConflict, 'id');
    });
  });

  group('auth gating — never lose a write', () {
    test('NO authenticated user → offline (stays queued), nothing written',
        () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w, user: null); // signed out.
      final r = await s.sendMutation(
          _mut(path: '/pantry', body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'}));
      expect(r, ProbeStatus.offline);
      expect(w.upserts, isEmpty);
    });

    test('authenticated → online (the Outbox then drops it)', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final r = await s.sendMutation(
          _mut(path: '/pantry', body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'}));
      expect(r, ProbeStatus.online);
    });

    test('a multi-row body with NO id is not written (stays queued)', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      // /pantry (no id in path) + a body missing `id` → can't form a PK. This is
      // a structurally-bad mutation a retry can't fix, so it now classifies as a
      // permanent reject (coarse `sendMutation` surfaces that as `degraded`, a
      // non-network problem); it is NOT written, and the richer classification is
      // asserted below.
      final r = await s.sendMutation(_mut(path: '/pantry', body: {'name': 'Eggs'}));
      expect(r, ProbeStatus.degraded);
      expect(w.upserts, isEmpty);
      expect(
        await s.classifySend(_mut(path: '/pantry', body: {'name': 'Eggs'})),
        SendResult.rejectPermanent,
      );
    });
  });

  group('DELETE + failure', () {
    test('a DELETE mutation deletes by id', () async {
      final w = FakeSupabaseWriter();
      final s = _sender(w);
      final r =
          await s.sendMutation(_mut(path: '/pantry/item-1', method: 'DELETE'));
      expect(r, ProbeStatus.online);
      expect(w.deletes.single.table, 'pantry_items');
      expect(w.deletes.single.idColumn, 'id');
      expect(w.deletes.single.idValue, 'item-1');
      expect(w.upserts, isEmpty);
    });

    test('a generic writer throw keeps the mutation queued (transient)',
        () async {
      final w = FakeSupabaseWriter()..throwOnWrite = true;
      final s = _sender(w);
      final mut =
          _mut(path: '/pantry', body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'});
      // A non-PostgREST throw (network/StateError) is TRANSIENT — a retry might
      // fix it — so the coarse status is `degraded` (kept queued), and the
      // richer classification is retryTransient (bump + retry, never dropped).
      expect(await s.sendMutation(mut), ProbeStatus.degraded);
      expect(await s.classifySend(mut), SendResult.retryTransient);
    });
  });

  group('classifySend — transient vs permanent (P4-E)', () {
    PendingMutation goodPantry() =>
        _mut(path: '/pantry', body: {'id': 'item-1', 'name': 'Eggs', 'zone': 'fridge'});

    test('a confirmed upsert → sent', () async {
      final s = _sender(FakeSupabaseWriter());
      expect(await s.classifySend(goodPantry()), SendResult.sent);
    });

    test('unknown path → retryEnvironment (queued, no bump)', () async {
      final s = _sender(FakeSupabaseWriter());
      expect(await s.classifySend(_mut(path: '/mystery', body: {'id': 'x'})),
          SendResult.retryEnvironment);
    });

    test('no authenticated user → retryEnvironment (queued until login)',
        () async {
      final s = _sender(FakeSupabaseWriter(), user: null);
      expect(await s.classifySend(goodPantry()), SendResult.retryEnvironment);
    });

    test('a multi-row body with NO id → rejectPermanent (structurally bad)',
        () async {
      final s = _sender(FakeSupabaseWriter());
      expect(await s.classifySend(_mut(path: '/pantry', body: {'name': 'Eggs'})),
          SendResult.rejectPermanent);
    });

    test('a DELETE with no id in the path → rejectPermanent', () async {
      final s = _sender(FakeSupabaseWriter());
      expect(await s.classifySend(_mut(path: '/pantry', method: 'DELETE')),
          SendResult.rejectPermanent);
    });

    test('PostgREST 42501 (RLS/permission) → rejectPermanent', () async {
      final w = FakeSupabaseWriter()
        ..throwWith = const PostgrestException(
            message: 'permission denied', code: '42501');
      final s = _sender(w);
      expect(await s.classifySend(goodPantry()), SendResult.rejectPermanent);
    });

    test('PostgREST 23505 (unique violation) → rejectPermanent', () async {
      final w = FakeSupabaseWriter()
        ..throwWith = const PostgrestException(
            message: 'duplicate key', code: '23505');
      expect(await _sender(w).classifySend(goodPantry()),
          SendResult.rejectPermanent);
    });

    test('PostgREST 400 (malformed) → rejectPermanent', () async {
      final w = FakeSupabaseWriter()
        ..throwWith =
            const PostgrestException(message: 'bad request', code: '400');
      expect(await _sender(w).classifySend(goodPantry()),
          SendResult.rejectPermanent);
    });

    test('PostgREST 500 (server error) → retryTransient (not permanent)',
        () async {
      final w = FakeSupabaseWriter()
        ..throwWith =
            const PostgrestException(message: 'server error', code: '500');
      expect(await _sender(w).classifySend(goodPantry()),
          SendResult.retryTransient);
    });

    test('a PostgREST error with an UNKNOWN code defaults to transient (safe)',
        () async {
      // Never mistake an unfamiliar blip for a permanent reject (which would
      // push a write out of the queue). Default to retry.
      final w = FakeSupabaseWriter()
        ..throwWith = const PostgrestException(
            message: 'who knows', code: 'XX999');
      expect(await _sender(w).classifySend(goodPantry()),
          SendResult.retryTransient);
    });

    test('a plain network throw (no code) → retryTransient', () async {
      final w = FakeSupabaseWriter()..throwWith = Exception('socket closed');
      expect(await _sender(w).classifySend(goodPantry()),
          SendResult.retryTransient);
    });
  });
}
