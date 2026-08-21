// ignore_for_file: prefer_initializing_formals

import '../api/probe_status.dart';
import '../auth/auth_service.dart';
import '../offline/pending_mutation.dart';
import 'sync_service.dart' show MutationSender;
import 'supabase_tables.dart';
import 'supabase_writer.dart';

/// The Supabase-backed [MutationSender] — the new flush destination for the
/// shared [Outbox].
///
/// It satisfies the SAME seam `ApiClient` did (`sendMutation` → [ProbeStatus]),
/// so [SyncService] and every repo's queued write are untouched: only WHERE a
/// mutation lands changes. For each [PendingMutation] it:
///
///   1. Resolves the path → a [SupabaseTable] (unknown path ⇒ leaves it queued,
///      never dropped — [ProbeStatus.offline]).
///   2. Requires an authenticated user; with none it returns
///      [ProbeStatus.offline] so the write STAYS queued until login (it must
///      never succeed-drop while unauthenticated — that would lose the write).
///   3. Builds the row: `user_id` = the CURRENT session user, the client `id`
///      (except the profile/goals singletons keyed on `user_id`), `data` = the
///      whole mutation body (the aggregate's `toJson()` — source of truth), plus
///      the flat, queryable columns lifted faithfully from the body. Nothing is
///      fabricated: a value absent from the body is left absent (NULL server-side).
///   4. Upserts on the table's conflict column so a re-flushed mutation replays
///      idempotently, or DELETEs by id for a queued DELETE.
///
/// Honesty / integrity contract (mirrors the Outbox's):
///  * A failure (throw, unknown path, or no auth) returns a non-online status,
///    so the Outbox keeps the mutation queued — a write is NEVER lost.
///  * Every row carries `user_id` = the current user; RLS enforces the same
///    server-side, so a write can never cross users.
///  * Success ([ProbeStatus.online]) is returned only after Supabase confirms.
class SupabaseSyncSender implements MutationSender {
  SupabaseSyncSender({
    required SupabaseWriter writer,
    required AuthService auth,
  })  : _writer = writer,
        _auth = auth;

  final SupabaseWriter _writer;
  final AuthService _auth;

  @override
  Future<ProbeStatus> sendMutation(PendingMutation m) async {
    final table = tableForPath(m.path);
    if (table == null) {
      // Unknown route — we don't know where this belongs. Do NOT drop it; keep
      // it queued (a later build may add the mapping). Report offline.
      return ProbeStatus.offline;
    }

    final userId = _auth.currentUser?.id;
    if (userId == null) {
      // No session → we cannot scope the row to a user, and RLS would reject it
      // anyway. Keep it queued until the user signs in. Never succeed-drop.
      return ProbeStatus.offline;
    }

    try {
      if (m.method.toUpperCase() == 'DELETE') {
        // A queued DELETE (e.g. `DELETE /pantry/{id}`). Singletons are never
        // deleted this way; only the multi-row aggregates enqueue DELETEs.
        final id = _idFromPath(m.path);
        if (id == null) return ProbeStatus.offline; // malformed — stay queued.
        await _writer.deleteById(table.name, idColumn: 'id', idValue: id);
        return ProbeStatus.online;
      }

      final row = _buildRow(table, m, userId);
      if (row == null) return ProbeStatus.offline; // couldn't build — stay queued.
      await _writer.upsert(table.name, row, onConflict: table.conflictColumn);
      return ProbeStatus.online;
    } catch (_) {
      // Any write failure (network, RLS, server) → stay queued, retry later.
      return ProbeStatus.offline;
    }
  }

  /// Build the upsert row for [table] from [m]'s body + the current [userId].
  ///
  /// Always includes `user_id` and the full body as `data`. For multi-row
  /// aggregates it also carries the client `id` (from the body) and lifts the
  /// flat queryable columns the schema defines — faithfully, only when present.
  /// Returns `null` when a required piece is missing (e.g. a non-singleton with
  /// no id), so the caller keeps the mutation queued rather than writing a bad row.
  Map<String, dynamic>? _buildRow(
    SupabaseTable table,
    PendingMutation m,
    String userId,
  ) {
    final body = m.body ?? const <String, dynamic>{};

    // `data` is the source of truth: the whole aggregate snapshot, verbatim.
    final row = <String, dynamic>{
      'user_id': userId,
      'data': body,
    };

    if (table.singleton) {
      // Singletons upsert on `user_id` (one row per user). The `profile` table
      // has NO `id` column — user_id IS its primary key — so we set no id. But
      // `nutrition_goals` additionally declares a `text` PK `id` (required, no
      // default): omitting it would violate NOT NULL and the write would fail
      // forever (silently re-queued). So we mint a STABLE per-user id for it —
      // stable so an Outbox replay upserts idempotently (insert supplies id,
      // conflict on user_id updates), and unique per user so the global `id` PK
      // never collides across users. Nothing is fabricated in `data`.
      if (table.name == 'nutrition_goals') {
        row['id'] = 'goals-$userId';
      }
      _liftSingletonColumns(table, body, row);
      return row;
    }

    // Multi-row aggregate: the client id is mandatory (it's the PK we upsert on).
    final id = body['id'] as String? ?? _idFromPath(m.path);
    if (id == null) return null;
    row['id'] = id;
    _liftFlatColumns(table, body, row);
    return row;
  }

  /// Lift the flat, queryable columns for a MULTI-ROW aggregate from its body.
  ///
  /// Only copies a value the body actually carries — an absent field stays
  /// absent (NULL in Postgres), never a fabricated 0/"". `data` remains the
  /// source of truth; these columns exist purely for indexing/querying.
  void _liftFlatColumns(
    SupabaseTable table,
    Map<String, dynamic> body,
    Map<String, dynamic> row,
  ) {
    switch (table.name) {
      case 'workouts':
        // WorkoutSession.toJson(): at (ISO), finished (bool), exercises (list).
        _put(row, 'at', body['at']);
        _put(row, 'finished', body['finished']);
        _put(row, 'exercises', body['exercises']);
        _put(row, 'owner_id', body['ownerId']);
        _put(row, 'shared', body['shared']);
        break;
      case 'food_log_entries':
        // FoodLogEntry.toJson().
        _put(row, 'name', body['name']);
        _put(row, 'at', body['at']);
        _put(row, 'kcal', body['kcal']);
        _put(row, 'protein_g', body['proteinG']);
        _put(row, 'carbs_g', body['carbsG']);
        _put(row, 'fat_g', body['fatG']);
        _put(row, 'grams', body['grams']);
        _put(row, 'tier', body['tier']);
        _put(row, 'ate_out', body['ateOut']);
        _put(row, 'restaurant', body['restaurant']);
        _put(row, 'spend_gbp', body['spendGbp']);
        _put(row, 'barcode', body['barcode']);
        _put(row, 'source', body['source']);
        _put(row, 'owner_id', body['ownerId']);
        _put(row, 'shared', body['shared']);
        break;
      case 'pantry_items':
        // PantryItem.toJson().
        _put(row, 'name', body['name']);
        _put(row, 'zone', body['zone']);
        _put(row, 'qty', body['qty']);
        _put(row, 'unit', body['unit']);
        _put(row, 'expiry', body['expiry']);
        _put(row, 'price_gbp', body['priceGbp']);
        _put(row, 'store', body['store']);
        _put(row, 'purchased_at', body['purchasedAt']);
        _put(row, 'reorder_cadence_days', body['reorderCadenceDays']);
        _put(row, 'last_bought', body['lastBought']);
        _put(row, 'source', body['source']);
        _put(row, 'owner_id', body['ownerId']);
        _put(row, 'shared', body['shared']);
        break;
      case 'weigh_ins':
        // WeighIn.toJson(): weightKg (nullable), at (ISO). Lift both when
        // present; a null weight stays absent (NULL), never a fabricated 0.
        _put(row, 'weight_kg', body['weightKg'] ?? body['weight_kg']);
        _put(row, 'at', body['at']);
        break;
    }
  }

  /// Lift the flat columns for a SINGLETON (profile / nutrition_goals).
  ///
  /// The profile body uses the BACKEND param names (see `ProfileRepo.paramsFor`:
  /// `weight_kg`, `age`, `goal_direction`…), not the model's camelCase, so we
  /// read those keys. Every field is optional — absent stays NULL, honest.
  void _liftSingletonColumns(
    SupabaseTable table,
    Map<String, dynamic> body,
    Map<String, dynamic> row,
  ) {
    switch (table.name) {
      case 'profile':
        _put(row, 'height_cm', body['height_cm']);
        // ProfileRepo sends `age`; the column is `age_years`.
        _put(row, 'age_years', body['age'] ?? body['age_years']);
        _put(row, 'sex', body['sex']);
        _put(row, 'weight_kg', body['weight_kg']);
        _put(row, 'goal_direction', body['goal_direction']);
        _put(row, 'target_weight_kg', body['target_weight_kg']);
        _put(row, 'primary_gym', body['primary_gym']);
        break;
      case 'nutrition_goals':
        // NutritionGoals.toJson(): caloriesKcal/proteinG/carbsG/fatG, all
        // nullable + omitted when unset. Lift the four targets when present; an
        // unset target stays NULL server-side (the honest empty ring).
        _put(row, 'calories_kcal', body['caloriesKcal'] ?? body['calories_kcal']);
        _put(row, 'protein_g', body['proteinG'] ?? body['protein_g']);
        _put(row, 'carbs_g', body['carbsG'] ?? body['carbs_g']);
        _put(row, 'fat_g', body['fatG'] ?? body['fat_g']);
        break;
    }
  }

  /// Copy [value] into [row] under [column] ONLY when it is non-null. A null is
  /// left out entirely so Postgres stores NULL — never a fabricated stand-in.
  static void _put(Map<String, dynamic> row, String column, Object? value) {
    if (value != null) row[column] = value;
  }

  /// Extract the trailing id from a path like `/pantry/item-1` → `item-1`.
  /// Returns `null` when there is no id segment (e.g. a bare `/pantry`).
  static String? _idFromPath(String path) {
    final segments =
        path.split('/').where((s) => s.isNotEmpty).toList(growable: false);
    if (segments.length < 2) return null;
    return segments.last;
  }
}
