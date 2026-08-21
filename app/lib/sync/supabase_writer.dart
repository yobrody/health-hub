import 'package:supabase_flutter/supabase_flutter.dart';

/// The tiny seam the Supabase sync layer writes/reads through.
///
/// Both [SupabaseSyncSender] (outbox flush → writes) and [SupabaseHydrator]
/// (login → reads) depend on THIS interface, not on `Supabase.instance`
/// directly. That keeps them fully unit-testable with an in-memory fake and
/// guarantees no test path ever touches the real client or the network.
///
/// The real implementation ([RealSupabaseWriter]) is a thin adapter over
/// `Supabase.instance.client.from(table)...`; it is not unit-tested (it needs a
/// live client), exactly like the `SharedPrefs*` stores elsewhere in the repo.
abstract class SupabaseWriter {
  /// Upsert [row] into [table], resolving conflicts on [onConflict] (the PK or
  /// unique column). This is how a replayed Outbox mutation lands idempotently:
  /// the same row upserted twice yields one row, so a re-flush is safe.
  Future<void> upsert(
    String table,
    Map<String, dynamic> row, {
    required String onConflict,
  });

  /// Delete the row of [table] whose [idColumn] equals [idValue]. Used when a
  /// queued mutation is a DELETE (e.g. `DELETE /pantry/{id}`). Deleting an
  /// already-absent row is a no-op (idempotent), so a replay is safe.
  Future<void> deleteById(
    String table, {
    required String idColumn,
    required String idValue,
  });

  /// Select every row of [table] visible to the current user (RLS restricts
  /// this to the caller's own rows server-side). Returns the raw row maps; the
  /// hydrator rebuilds aggregates from each row's `data` jsonb.
  Future<List<Map<String, dynamic>>> selectAll(String table);
}

/// Production [SupabaseWriter] backed by the initialized Supabase client.
///
/// NOT unit-tested (requires a live `Supabase.instance`). Every call is scoped
/// to the authenticated session, and RLS (`auth.uid() = user_id`) enforces
/// tenancy server-side regardless of what the client sends.
class RealSupabaseWriter implements SupabaseWriter {
  RealSupabaseWriter(this._client);

  final SupabaseClient _client;

  @override
  Future<void> upsert(
    String table,
    Map<String, dynamic> row, {
    required String onConflict,
  }) async {
    await _client.from(table).upsert(row, onConflict: onConflict);
  }

  @override
  Future<void> deleteById(
    String table, {
    required String idColumn,
    required String idValue,
  }) async {
    await _client.from(table).delete().eq(idColumn, idValue);
  }

  @override
  Future<List<Map<String, dynamic>>> selectAll(String table) async {
    final rows = await _client.from(table).select();
    return List<Map<String, dynamic>>.from(rows);
  }
}
