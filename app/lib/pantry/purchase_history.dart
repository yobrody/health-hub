/// The honest reorder-cadence learner's data layer + PURE cadence maths.
///
/// The whole point is **honesty**: a reorder cadence is only ever derived from
/// the user's REAL repeat-purchase history. We never guess a cadence. Concretely:
///  • We record a purchase timestamp ONLY on a genuine real-world acquisition
///    signal (a real add / re-buy — see [AcquisitionService]). An edit, a qty
///    tweak, or a view is NOT an acquisition and is never recorded.
///  • A cadence is computed ONLY with ≥2 real acquisitions ([computeCadenceDays]);
///    with fewer we return `null` — an honest "insufficient data", never a guess.
///    A `null` cadence means [PantryItem.reorderCadenceDays] stays `null`, so the
///    "reorder-due" restock signal never fires from fabricated urgency.
///
/// **Identity rule (documented + conservative).** Purchases are keyed by a
/// NORMALIZED item name ([normalizePurchaseKey]) — trimmed, lower-cased, inner
/// whitespace collapsed. Two buys count as the "same item" only when their names
/// normalize equal. This is deliberately conservative: if two acquisitions don't
/// clearly refer to the same item by name, we'd rather NOT match them (leaving
/// the cadence unlearned) than fabricate a wrong match that would invent urgency
/// later. Limitation: genuinely-different products with the same name collide,
/// and the same product spelled differently ("Semi-skimmed milk" vs "Milk") does
/// NOT — both are accepted honesty trade-offs (never a false cadence from a wrong
/// merge; at worst a cadence simply goes unlearned).
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Normalize an item name into a stable purchase-history key.
///
/// Trimmed, lower-cased, with inner runs of whitespace collapsed to one space.
/// Returns `null` for a blank/whitespace-only name — such a name is not a usable
/// identity, so it is never recorded (we never key history on nothing).
String? normalizePurchaseKey(String name) {
  final collapsed = name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
  return collapsed.isEmpty ? null : collapsed;
}

/// The minimum number of REAL acquisitions before a cadence can be computed.
/// Below this, [computeCadenceDays] returns `null` (honest insufficient data).
const int kMinPurchasesForCadence = 2;

/// Compute an item's reorder cadence in days from its REAL purchase history.
///
/// Honest rules:
///  • With fewer than [kMinPurchasesForCadence] purchases → `null` (no honest
///    cadence exists yet). A single buy → `null`.
///  • Otherwise: sort the timestamps ascending, take the gap (in whole days)
///    between each consecutive pair, and return the **median** gap. The median
///    is more robust than the mean to a one-off irregular interval (e.g. a
///    holiday), so a stray long/short gap can't skew the learned cadence.
///  • **Zero-day / same-day gaps are ignored** — a duplicate buy logged the same
///    day (or twice within 24h) is not a genuine reorder interval, so counting it
///    as a 0-day cadence would fabricate constant urgency. If, after dropping
///    zero-day gaps, no real (≥1 day) interval remains, the cadence is `null`.
///  • The result is always ≥1 (a real interval is at least a day) — an honest,
///    positive cadence or nothing.
///
/// PURE: [purchases] is not mutated; no `DateTime.now()` — the caller supplies
/// the real timestamps.
int? computeCadenceDays(List<DateTime> purchases) {
  if (purchases.length < kMinPurchasesForCadence) return null;

  final sorted = [...purchases]..sort();

  final gaps = <int>[];
  for (var i = 1; i < sorted.length; i++) {
    // Whole-day gap between consecutive buys. Using calendar-agnostic elapsed
    // days (difference in duration) keeps this deterministic and tz-free.
    final gapDays = sorted[i].difference(sorted[i - 1]).inDays;
    // Ignore zero-day / same-day gaps (duplicate same-day logs) — not a real
    // reorder interval; counting them would fabricate a 0-day cadence.
    if (gapDays >= 1) gaps.add(gapDays);
  }

  if (gaps.isEmpty) return null; // no real interval — honest "unlearned"

  gaps.sort();
  final mid = gaps.length ~/ 2;
  if (gaps.length.isOdd) return gaps[mid];
  // Even count → mean of the two middle gaps, rounded to the nearest whole day.
  return ((gaps[mid - 1] + gaps[mid]) / 2).round();
}

/// The append-only purchase history for ONE item identity (a normalized key).
///
/// [timestamps] are the REAL acquisition times, kept in insertion order. This is
/// user data: it exists only because a genuine acquisition was recorded. An empty
/// history is genuinely empty (no cadence), never seeded.
class PurchaseHistory {
  const PurchaseHistory({required this.key, required this.timestamps});

  /// The normalized item-name key (see [normalizePurchaseKey]).
  final String key;

  /// The real acquisition timestamps, oldest-first by insertion.
  final List<DateTime> timestamps;

  /// The most recent acquisition, or `null` when the history is empty. This is
  /// the honest `lastBought` for the item.
  DateTime? get lastBought =>
      timestamps.isEmpty ? null : timestamps.reduce((a, b) => a.isAfter(b) ? a : b);

  /// The learned cadence in days from this real history, or `null` when there
  /// aren't ≥2 genuine acquisitions (honest insufficient data).
  int? get cadenceDays => computeCadenceDays(timestamps);

  /// A copy with [at] appended — a new real acquisition. Never mutates `this`.
  PurchaseHistory withAcquisition(DateTime at) => PurchaseHistory(
        key: key,
        timestamps: [...timestamps, at],
      );

  Map<String, dynamic> toJson() => {
        'key': key,
        'ts': timestamps.map((t) => t.toIso8601String()).toList(),
      };

  factory PurchaseHistory.fromJson(Map<String, dynamic> json) {
    final parsed = tryFromJson(json);
    if (parsed == null) {
      throw const FormatException('PurchaseHistory: missing/invalid "key"');
    }
    return parsed;
  }

  /// Lenient parse for the store: returns `null` for a corrupt/incomplete entry
  /// (missing or non-String `key`) so ONE bad row can be dropped without wiping
  /// the whole history. A lost history means no cadence (honest), never a guess.
  static PurchaseHistory? tryFromJson(Map<String, dynamic> json) {
    final key = json['key'];
    if (key is! String || key.isEmpty) return null; // corrupt entry — skip it
    final rawTs = json['ts'];
    final ts = <DateTime>[];
    if (rawTs is List) {
      for (final e in rawTs) {
        if (e is String) {
          final d = DateTime.tryParse(e);
          if (d != null) ts.add(d);
        }
      }
    }
    return PurchaseHistory(key: key, timestamps: ts);
  }
}

/// Local persistence for the whole purchase-history map (key → history). Same
/// interface/fake pattern as the other stores: the platform impl
/// ([SharedPrefsPurchaseHistoryStore]) is not unit-tested; tests inject a fake.
abstract class PurchaseHistoryStore {
  Future<List<PurchaseHistory>> load();
  Future<void> save(List<PurchaseHistory> histories);
}

/// Loads and appends per-item purchase histories.
///
/// Append-only + serialized: [recordAcquisition] reads the current map, appends
/// the real timestamp under the item's normalized key, and persists. The lock
/// makes two rapid records read+write in order so neither is lost.
class PurchaseHistoryRepo {
  PurchaseHistoryRepo({required PurchaseHistoryStore store})
      // ignore: prefer_initializing_formals
      : _store = store;

  final PurchaseHistoryStore _store;

  Future<void> _mutation = Future.value();

  Future<T> _synchronized<T>(Future<T> Function() action) {
    // Chain onto the previous mutation so records apply in order (never lost).
    final next = _mutation.then((_) => action());
    // Keep the chain alive even if a record throws.
    _mutation = next.then((_) {}, onError: (_) {});
    return next;
  }

  /// The whole history map as a list, in no particular order.
  Future<List<PurchaseHistory>> all() => _store.load();

  /// The history for a single item name (normalized), or an empty history when
  /// none exists yet / the name isn't a usable identity.
  Future<PurchaseHistory> forName(String name) async {
    final key = normalizePurchaseKey(name);
    if (key == null) return const PurchaseHistory(key: '', timestamps: []);
    final all = await _store.load();
    for (final h in all) {
      if (h.key == key) return h;
    }
    return PurchaseHistory(key: key, timestamps: const []);
  }

  /// Record a REAL acquisition of [name] at [at]. Appends [at] to the item's
  /// history (keyed by its normalized name) and returns the updated history.
  ///
  /// A blank/whitespace-only name is a no-op (never a usable identity) — it
  /// returns the empty history and records nothing. Honest: only a genuine
  /// acquisition ever calls this; this method only persists what it's given.
  Future<PurchaseHistory> recordAcquisition(String name, DateTime at) {
    return _synchronized(() async {
      final key = normalizePurchaseKey(name);
      if (key == null) {
        return const PurchaseHistory(key: '', timestamps: []);
      }
      final all = await _store.load();
      final idx = all.indexWhere((h) => h.key == key);
      final PurchaseHistory updated;
      final next = [...all];
      if (idx < 0) {
        updated = PurchaseHistory(key: key, timestamps: [at]);
        next.add(updated);
      } else {
        updated = all[idx].withAcquisition(at);
        next[idx] = updated;
      }
      await _store.save(next);
      return updated;
    });
  }
}

// ── SharedPreferences-backed real PurchaseHistoryStore ────────────────────────

const _kPurchaseHistoryKey = 'hh_purchase_history_v1';

/// Production [PurchaseHistoryStore] backed by [SharedPreferences]. Not
/// unit-tested (platform channel); the interface makes the repo testable.
class SharedPrefsPurchaseHistoryStore implements PurchaseHistoryStore {
  const SharedPrefsPurchaseHistoryStore();

  @override
  Future<List<PurchaseHistory>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kPurchaseHistoryKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<Map>()
          // Drop only corrupt rows (tryFromJson → null); valid histories survive.
          .map((m) => PurchaseHistory.tryFromJson(Map<String, dynamic>.from(m)))
          .whereType<PurchaseHistory>()
          .toList();
    } catch (_) {
      // Corrupted storage — start fresh rather than crashing.
      return [];
    }
  }

  @override
  Future<void> save(List<PurchaseHistory> histories) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _kPurchaseHistoryKey,
        jsonEncode(histories.map((h) => h.toJson()).toList()),
      );
    } catch (_) {
      // Quota / access denied — in-memory state stays correct for this session;
      // mirror the other stores' tolerant behaviour.
    }
  }
}
