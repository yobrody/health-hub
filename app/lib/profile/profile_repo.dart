// ignore_for_file: prefer_initializing_formals

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../api/probe_status.dart';
import '../offline/outbox.dart';
import '../offline/pending_mutation.dart';
import 'profile_model.dart';

/// The subset of [ApiClient] that [ProfileRepo] needs, extracted so tests can
/// inject a fake without a live Dio. [ApiClient] satisfies it directly.
abstract class ProfileApi {
  Future<ProbeStatus> putProfile(Map<String, dynamic> params);
}

/// A [ProfileApi] that never sends over HTTP — it always reports a non-online
/// status so [ProfileRepo] QUEUES the profile PUT into the shared [Outbox].
///
/// This is the P4-D3 routing: with Supabase configured, the profile must sync
/// to the `profile` table, not the retired HTTP backend. Queuing every profile
/// write (exactly like pantry/nutrition/workout) lets the [SupabaseSyncSender]
/// flush it to Supabase (`/tdee/profile` → `profile` table). It reports
/// [ProbeStatus.degraded] (not `offline`) purely as documentation that this is
/// a deliberate "route via the outbox" decision, not a network failure — either
/// non-online value makes the repo queue and return [WriteOutcome.queued], a
/// success state (never a user-facing failure).
class OutboxOnlyProfileApi implements ProfileApi {
  const OutboxOnlyProfileApi();

  @override
  Future<ProbeStatus> putProfile(Map<String, dynamic> params) async =>
      ProbeStatus.degraded;
}

/// Local persistence for the profile JSON, so onboarding survives a restart.
///
/// Same interface/fake pattern as [OutboxStore] / [SecureStore]: the platform
/// implementation ([SharedPrefsProfileStore]) is not unit-tested; tests inject
/// an in-memory fake.
abstract class ProfileStore {
  Future<Map<String, dynamic>?> load();
  Future<void> save(Map<String, dynamic> json);
}

/// Loads and saves the user's [Profile].
///
/// Save path:
///  1. Persist locally (survives restart, drives first-run detection).
///  2. Attempt the backend PUT of ONLY the non-null fields.
///  3. If the backend is unreachable/degraded (or the call throws), enqueue the
///     PUT via the [Outbox] and report [WriteOutcome.queued] — a SUCCESS state,
///     **never** [WriteOutcome.failed]. An offline profile save must not look
///     like a failure to the user.
class ProfileRepo {
  // Private fields with public named constructor params: `this._api` is not
  // addressable as a named argument, so these are assigned in the initializer
  // list (not initializing formals). Silenced file-wide below.
  ProfileRepo({
    required ProfileApi api,
    required Outbox outbox,
    required ProfileStore store,
  })  : _api = api,
        _outbox = outbox,
        _store = store;

  final ProfileApi _api;
  final Outbox _outbox;
  final ProfileStore _store;

  /// The backend API this repo writes through. Exposed so the composition root
  /// can assert the repo is wired to the REAL [ApiClient] (not an offline stub).
  ProfileApi get api => _api;

  /// The shared offline queue this repo enqueues into. Exposed so the
  /// composition root can confirm it is the SAME [Outbox] the SyncService
  /// flushes — otherwise a queued write would never be replayed.
  Outbox get outbox => _outbox;

  /// The backend route the profile PUT targets.
  static const String _profilePath = '/tdee/profile';

  /// Dedupe bucket — a newer profile save supersedes an older queued one.
  static const String _dedupeKey = 'profile';

  /// Build the backend query/body params from a [Profile], including ONLY the
  /// fields the user actually provided.
  ///
  /// Field-name / value mapping to the backend contract:
  ///  - `ageYears`   → `age`            (backend param is `age`)
  ///  - `goalDirection`: the model uses `'gain'|'cut'|'maintain'`; the backend
  ///    uses `'gain'|'lose'|'maintain'`, so `'cut'` is mapped to `'lose'`.
  ///  - `primaryGym` → `primary_gym`    (backend has no field yet; ignored
  ///    server-side, preserved here so a later phase can wire it up).
  /// A null field is simply omitted — nothing is fabricated.
  static Map<String, dynamic> paramsFor(Profile p) {
    return {
      if (p.weightKg != null) 'weight_kg': p.weightKg,
      if (p.heightCm != null) 'height_cm': p.heightCm,
      if (p.ageYears != null) 'age': p.ageYears,
      if (p.sex != null) 'sex': p.sex,
      if (p.goalDirection != null)
        'goal_direction': p.goalDirection == 'cut' ? 'lose' : p.goalDirection,
      if (p.targetWeightKg != null) 'target_weight_kg': p.targetWeightKg,
      if (p.primaryGym != null) 'primary_gym': p.primaryGym,
    };
  }

  /// Load the stored profile. Absent → an all-null [Profile] (honest empty),
  /// never a fabricated one.
  Future<Profile> load() async {
    final json = await _store.load();
    if (json == null) return const Profile();
    return Profile.fromJson(json);
  }

  /// First-run detection: has a profile ever been saved on this device?
  Future<bool> hasProfile() async => (await _store.load()) != null;

  /// Persist [profile] locally, then sync to the backend (or queue if offline).
  ///
  /// Returns:
  ///  - [WriteOutcome.sent]   — backend accepted it.
  ///  - [WriteOutcome.queued] — offline/degraded; safely queued for replay.
  ///    NOT a failure; callers must not surface it as one.
  Future<WriteOutcome> save(Profile profile) async {
    // 1. Always persist locally first so onboarding survives a restart even if
    //    the network is down.
    await _store.save(profile.toJson());

    final params = paramsFor(profile);

    // 2. Try the backend. A throw or a non-online status both route to the
    //    offline queue — an unreachable server is not a user-facing failure.
    ProbeStatus status;
    try {
      status = await _api.putProfile(params);
    } catch (_) {
      status = ProbeStatus.offline;
    }

    if (status == ProbeStatus.online) {
      return WriteOutcome.sent;
    }

    // 3. Offline / degraded → queue the PUT and report queued-success.
    await _outbox.enqueue(
      PendingMutation(
        id: 'profile-${DateTime.now().microsecondsSinceEpoch}',
        dedupeKey: _dedupeKey,
        method: 'PUT',
        path: _profilePath,
        body: params,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    return WriteOutcome.queued;
  }
}

// ── SharedPreferences-backed real ProfileStore ───────────────────────────────

const _kProfileKey = 'hh_profile_v1';

/// Production [ProfileStore] backed by [SharedPreferences]. Not unit-tested
/// (platform channel); the interface is what makes [ProfileRepo] testable.
class SharedPrefsProfileStore implements ProfileStore {
  const SharedPrefsProfileStore();

  @override
  Future<Map<String, dynamic>?> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kProfileKey);
      if (raw == null) return null;
      final parsed = jsonDecode(raw);
      if (parsed is! Map) return null;
      return Map<String, dynamic>.from(parsed);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(Map<String, dynamic> json) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kProfileKey, jsonEncode(json));
    } catch (_) {
      // Quota / access denied — the in-memory profile is still correct for
      // this session; mirror the Outbox store's tolerant behaviour.
    }
  }
}
