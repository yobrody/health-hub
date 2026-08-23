// ignore_for_file: prefer_initializing_formals

/// AcquisitionService — the WRITE half of the honest reorder-cadence learner.
///
/// Ties [PurchaseHistoryRepo] (the append-only real-purchase log) to
/// [PantryRepo]: when the user genuinely **acquires** an item, we (1) append the
/// real timestamp to that item's purchase history, then (2) recompute its cadence
/// from that history and, when honest, stamp [PantryItem.reorderCadenceDays] +
/// [PantryItem.lastBought] onto the matching pantry item. That makes
/// `restockSoon`'s "reorder-due" signal fire ORGANICALLY from real repeat buys.
///
/// This is a thin ORCHESTRATOR only — all the maths is PURE ([computeCadenceDays],
/// via [PurchaseHistory]); `now` is passed in by the caller, never read here.
///
/// Honesty rules (load-bearing):
///  • A cadence is set ONLY when the item's real history has ≥2 acquisitions and
///    yields a genuine cadence ([computeCadenceDays] non-null). With <2 buys the
///    cadence stays `null`, so reorder-due never fires from a guess.
///  • [PantryItem.lastBought] is set to the item's REAL most-recent acquisition.
///  • Only a real acquisition signal ever calls [recordAcquisition] (a genuine
///    add / re-buy). Edits, qty tweaks, and views do NOT call it.
///  • Identity is the conservative normalized-name rule (see [normalizePurchaseKey]).
///    A blank name is a no-op — nothing is recorded, no cadence fabricated.
///  • The pantry stamp matches an EXISTING pantry item by normalized name. When
///    no such item exists (e.g. the acquisition came from a grocery check-off
///    with nothing in the pantry), the history is still recorded honestly for
///    next time, but no pantry item is fabricated.
library;

import '../offline/outbox.dart';
import 'pantry_item.dart';
import 'pantry_repo.dart';
import 'purchase_history.dart';

/// The outcome of recording an acquisition — what was learned, honestly.
class AcquisitionOutcome {
  const AcquisitionOutcome({
    required this.history,
    required this.updatedItem,
    required this.writeOutcome,
  });

  /// The item's real purchase history AFTER this acquisition (>=1 timestamp when
  /// the name was a usable identity; an empty history for a blank name no-op).
  final PurchaseHistory history;

  /// The pantry item that was updated with a learned cadence + lastBought, or
  /// `null` when nothing was stamped — either no matching pantry item exists, or
  /// there still aren't ≥2 real buys to derive an honest cadence.
  final PantryItem? updatedItem;

  /// The repo write outcome when a pantry item was stamped, else `null`. Always
  /// a SUCCESS (queued) when present — an offline stamp is never a failure.
  final WriteOutcome? writeOutcome;
}

/// Orchestrates a real acquisition: record it, learn the cadence, stamp it.
class AcquisitionService {
  const AcquisitionService({
    required PurchaseHistoryRepo historyRepo,
    required PantryRepo pantryRepo,
  })  : _historyRepo = historyRepo,
        _pantryRepo = pantryRepo;

  final PurchaseHistoryRepo _historyRepo;
  final PantryRepo _pantryRepo;

  /// Record a genuine acquisition of the item named [name] at [now].
  ///
  /// Steps: append the real timestamp to the item's history; if that history now
  /// has an honest cadence (≥2 buys), find the matching pantry item (by
  /// normalized name) and stamp its [PantryItem.reorderCadenceDays] +
  /// [PantryItem.lastBought]. Even a single buy sets nothing on the pantry item
  /// (cadence stays null) — honest until there's real repeat data.
  Future<AcquisitionOutcome> recordAcquisition(String name, DateTime now) async {
    final history = await _historyRepo.recordAcquisition(name, now);

    // A blank name → nothing usable was recorded; never fabricate anything.
    final key = normalizePurchaseKey(name);
    if (key == null) {
      return AcquisitionOutcome(
        history: history,
        updatedItem: null,
        writeOutcome: null,
      );
    }

    final cadence = history.cadenceDays; // null until ≥2 real buys
    final lastBought = history.lastBought;

    // Find the matching pantry item by the SAME conservative identity rule.
    final items = await _pantryRepo.all();
    PantryItem? match;
    for (final item in items) {
      if (normalizePurchaseKey(item.name) == key) {
        match = item;
        break;
      }
    }

    // No matching pantry item — record kept for next time, but never invent one.
    if (match == null) {
      return AcquisitionOutcome(
        history: history,
        updatedItem: null,
        writeOutcome: null,
      );
    }

    // Only stamp when there's a genuine cadence to set. With <2 buys, cadence is
    // null and reorder-due must stay dormant — so we don't write a guess.
    if (cadence == null || lastBought == null) {
      return AcquisitionOutcome(
        history: history,
        updatedItem: null,
        writeOutcome: null,
      );
    }

    // copyWith can't set fields to null, but here both values are non-null and
    // REAL — the learned cadence and the true most-recent acquisition.
    final updated = match.copyWith(
      reorderCadenceDays: cadence,
      lastBought: lastBought,
    );
    final outcome = await _pantryRepo.update(updated);

    return AcquisitionOutcome(
      history: history,
      updatedItem: updated,
      writeOutcome: outcome,
    );
  }
}
