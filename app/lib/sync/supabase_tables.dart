/// The canonical map between the app's Outbox mutation [path]s (the existing
/// HTTP-style routes every repo already enqueues) and the Supabase tables that
/// back them (see `supabase/migrations/0001_init.sql`).
///
/// This is the single source of truth shared by [SupabaseSyncSender] (which
/// table a queued write targets) and [SupabaseHydrator] (which tables to pull
/// on login). Keeping it in one place means the two can never drift.
///
/// The mapping is by the FIRST path segment, so `/pantry` and `/pantry/{id}`
/// both resolve to `pantry_items`. An UNKNOWN path resolves to `null` — the
/// sender then leaves the mutation queued (never silently dropped) rather than
/// guessing a table.
library;

/// Description of a Supabase table an aggregate syncs to.
class SupabaseTable {
  const SupabaseTable({
    required this.name,
    required this.conflictColumn,
    required this.singleton,
  });

  /// The Postgres table name (e.g. `workouts`).
  final String name;

  /// The column an upsert conflicts on (the PK, or the unique user column for
  /// singletons). `id` for the multi-row aggregates; `user_id` for the
  /// per-user singletons ([profile], [nutrition_goals]).
  final String conflictColumn;

  /// True for one-row-per-user tables (profile, nutrition_goals): they have no
  /// meaningful client id, so they are keyed on `user_id`.
  final bool singleton;
}

// The concrete tables. Reserve mappings (goals / weigh-ins) are wired now so
// the NEXT task's repos flush without touching this file.
const _workouts =
    SupabaseTable(name: 'workouts', conflictColumn: 'id', singleton: false);
const _pantry =
    SupabaseTable(name: 'pantry_items', conflictColumn: 'id', singleton: false);
const _food = SupabaseTable(
    name: 'food_log_entries', conflictColumn: 'id', singleton: false);
const _weighIns =
    SupabaseTable(name: 'weigh_ins', conflictColumn: 'id', singleton: false);
const _profile =
    SupabaseTable(name: 'profile', conflictColumn: 'user_id', singleton: true);
const _goals = SupabaseTable(
    name: 'nutrition_goals', conflictColumn: 'user_id', singleton: true);
const _grocery = SupabaseTable(
    name: 'grocery_list', conflictColumn: 'id', singleton: false);

/// Every table the hydrator pulls on login, in a stable order.
const List<SupabaseTable> kAllSyncTables = [
  _profile,
  _goals,
  _weighIns,
  _pantry,
  _food,
  _workouts,
  _grocery,
];

/// Resolve a mutation [path] to its backing table, or `null` if unknown.
///
/// Matches on the first path segment so `/pantry` and `/pantry/item-1` both
/// map to `pantry_items`. Profile is special-cased: its route is
/// `/tdee/profile`, so both a leading `tdee` (with a `profile` tail) and a bare
/// `profile` segment resolve to the profile singleton.
SupabaseTable? tableForPath(String path) {
  final segments =
      path.split('/').where((s) => s.isNotEmpty).toList(growable: false);
  if (segments.isEmpty) return null;
  final first = segments.first;

  switch (first) {
    case 'workouts':
      return _workouts;
    case 'pantry':
      return _pantry;
    case 'nutrition':
      return _food;
    case 'grocery':
      return _grocery;
    case 'weigh-ins':
    case 'weighins':
      return _weighIns;
    case 'goals':
      return _goals;
    case 'profile':
      return _profile;
    case 'tdee':
      // `/tdee/profile` → profile singleton. Any other `/tdee/*` isn't a synced
      // aggregate, so it stays unknown (queued, not dropped).
      if (segments.length >= 2 && segments[1] == 'profile') return _profile;
      return null;
    default:
      return null;
  }
}
