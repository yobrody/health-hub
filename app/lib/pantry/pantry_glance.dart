/// PURE, tested selection logic for the home "pantry glance" card — what's
/// expiring soon and what's genuinely low on stock, honestly.
///
/// The whole point is honesty: this NEVER invents urgency. It surfaces an item
/// ONLY from a real signal on that item:
///  • **Expiring soon** — the item has a REAL [PantryItem.expiry] at or before
///    [expiringWithinDays] out from [now] (a disclosed product default of
///    [kExpiringSoonWindowDays], matching the pantry's own [kUseSoonWindowDays]).
///    This covers both "use soon" and already-expired items; an item with
///    `expiry == null` is simply NOT shown (never guessed).
///  • **Low stock** — the item has a genuinely KNOWN, gram-reconcilable
///    quantity (`qty != null`, and a unit we can compare) below
///    [lowStockThresholdGrams]. An item with `qty == null`, or a unit we can't
///    honestly reconcile (e.g. "unit", "pack"), is NOT shown as low — we don't
///    fabricate that it's running out.
///
/// [now] is passed in (never `DateTime.now()` inside a pure fn) so the whole
/// thing is deterministic and unit-testable.
library;

import 'pantry_item.dart';
import 'shelf_life.dart';

/// The default window, in days, for "expiring soon". A disclosed product
/// default — matches the pantry's own [kUseSoonWindowDays] so the glance agrees
/// with the fridge page's freshness dots.
const int kExpiringSoonWindowDays = kUseSoonWindowDays;

/// The default "low stock" threshold, in grams. Small and conservative: only an
/// item we KNOW has less than this (in a gram-reconcilable unit) is flagged. A
/// disclosed product default, not a promise.
const double kLowStockThresholdGrams = 100;

/// Units whose `qty` we treat as directly gram-comparable for the low-stock
/// check. Mirrors the ingredient graph's conservative reconciliation: `null`
/// (the pantry's implicit default) is handled separately in [_isLow].
const Set<String> _gramUnits = {'g', 'gram', 'grams'};

/// One entry in the glance: the item plus WHY it surfaced. Both reasons can be
/// true (expiring AND low) — the UI can show either or both honestly.
class PantryGlanceItem {
  const PantryGlanceItem({
    required this.item,
    required this.expiringSoon,
    required this.lowStock,
  });

  final PantryItem item;

  /// True when the item has a real expiry within the window (`useSoon` or
  /// `expired`). Never true for a null-expiry item.
  final bool expiringSoon;

  /// True when the item has a genuinely known, gram-reconcilable qty below the
  /// low-stock threshold. Never true for a null/unreconcilable qty.
  final bool lowStock;
}

/// The result of a glance: the items worth surfacing, split by reason. Empty
/// lists mean "nothing honestly worth flagging" — the UI shows a quiet positive
/// or omits the card, never invented urgency.
class PantryGlance {
  const PantryGlance({
    required this.expiringSoon,
    required this.lowStock,
  });

  /// Items expiring soon (real expiry within the window), earliest-expiry first.
  final List<PantryGlanceItem> expiringSoon;

  /// Items genuinely low on stock (known qty below threshold), lowest-qty first.
  final List<PantryGlanceItem> lowStock;

  /// True when there is nothing honestly worth surfacing.
  bool get isEmpty => expiringSoon.isEmpty && lowStock.isEmpty;
}

/// True when [item] has a genuinely known, gram-reconcilable qty strictly below
/// [thresholdGrams]. A `null` qty, or a unit we can't reconcile to grams, is
/// NOT low — we never fabricate that an item is running out.
///
/// A real `0` is a genuine "out of stock" value and DOES count as low.
bool _isLow(PantryItem item, double thresholdGrams) {
  final qty = item.qty;
  if (qty == null) return false; // unknown amount — never a guess
  final unit = item.unit;
  final reconcilable = unit == null || _gramUnits.contains(unit.toLowerCase());
  if (!reconcilable) return false; // non-gram unit we can't honestly compare
  return qty < thresholdGrams;
}

/// Select the pantry items worth a calm home-screen glance, honestly.
///
/// Returns items whose real [PantryItem.expiry] is at/before [expiringWithinDays]
/// out from [now] (covering use-soon and expired), and/or whose genuinely known
/// qty is below [lowStockThresholdGrams]. Items with no such real signal are
/// excluded. Never mutates its input.
PantryGlance pantryGlance(
  List<PantryItem> items,
  DateTime now, {
  int expiringWithinDays = kExpiringSoonWindowDays,
  double lowStockThresholdGrams = kLowStockThresholdGrams,
}) {
  final expiring = <PantryGlanceItem>[];
  final low = <PantryGlanceItem>[];

  final windowCutoff = now.add(Duration(days: expiringWithinDays));

  for (final item in items) {
    // Expiring soon: a REAL expiry at/before the window cutoff. This covers both
    // `useSoon` (expiry within the window) and `expired` (expiry at/before now);
    // an item with a null expiry is never flagged. Agrees with the pantry's own
    // [freshnessOf] at the default window by construction.
    final expiry = item.expiry;
    final isExpiring = expiry != null && !expiry.isAfter(windowCutoff);

    final isLow = _isLow(item, lowStockThresholdGrams);

    if (isExpiring) {
      expiring.add(PantryGlanceItem(
        item: item,
        expiringSoon: true,
        lowStock: isLow,
      ));
    }
    if (isLow) {
      low.add(PantryGlanceItem(
        item: item,
        expiringSoon: isExpiring,
        lowStock: true,
      ));
    }
  }

  // Earliest-expiry first (both have a non-null expiry by construction).
  expiring.sort((a, b) => a.item.expiry!.compareTo(b.item.expiry!));
  // Lowest-qty first (both have a non-null qty by construction).
  low.sort((a, b) => a.item.qty!.compareTo(b.item.qty!));

  return PantryGlance(expiringSoon: expiring, lowStock: low);
}
