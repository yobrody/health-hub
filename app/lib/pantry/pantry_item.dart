/// The Pantry inventory model — the keystone that later powers meal
/// suggestions, eating-in deduction, spend, and reorder.
///
/// **Every non-identity field is nullable.** A field the user (or a scan) has
/// not provided is `null`, persists as `null`, and is OMITTED from the
/// serialised map — never fabricated as `0`/`""`/a stand-in date. This mirrors
/// [Profile]'s honesty rule.
library;

/// Where an item physically lives — drives shelf-life estimation and the
/// (later) Fridge UI grouping.
enum PantryZone { fridge, pantry, freezer, condiments }

/// Parse a stored zone string back to the enum. Unknown/absent → `fridge`
/// (a safe, visible default rather than a crash — the zone is always required
/// on write, so this only guards corrupted/foreign JSON).
PantryZone _zoneFromString(String? raw) {
  for (final z in PantryZone.values) {
    if (z.name == raw) return z;
  }
  return PantryZone.fridge;
}

class PantryItem {
  const PantryItem({
    required this.id,
    required this.name,
    required this.zone,
    this.qty,
    this.unit,
    this.expiry,
    this.priceGbp,
    this.store,
    this.purchasedAt,
    this.reorderCadenceDays,
    this.lastBought,
    required this.source,
    this.ownerId,
    this.shared = false,
  });

  /// Stable identifier (used in the API path + Outbox dedupe key).
  final String id;

  /// Human-readable name, e.g. "Chicken breast".
  final String name;

  /// Physical zone (fridge/pantry/freezer/condiments).
  final PantryZone zone;

  /// Quantity on hand. `null` when unknown — never a fabricated `0`.
  /// A genuine `0` is a REAL value (out of stock) and is preserved.
  final double? qty;

  /// Unit for [qty], e.g. "g", "ml", "unit" (free string). `null` if unknown.
  final String? unit;

  /// Best-before / use-by date. `null` when unknown — drives [Freshness].
  final DateTime? expiry;

  /// Purchase price in GBP. `null` when unknown (powers spend later).
  final double? priceGbp;

  /// Where it was bought (free text). `null` if unknown.
  final String? store;

  /// When it was purchased. `null` if unknown — used to estimate expiry.
  final DateTime? purchasedAt;

  /// Learned reorder cadence in days (avg gap between buys). `null` until we
  /// have >=2 purchases — an honest "insufficient data", never a guess.
  final int? reorderCadenceDays;

  /// The most recent purchase date. `null` if unknown.
  final DateTime? lastBought;

  /// Provenance of the record: e.g. "manual", "scan", "receipt".
  final String source;

  /// The social seam — owner of this item. `null` = personal/unscoped.
  final String? ownerId;

  /// The social seam — whether this item is shared. Defaults `false`.
  final bool shared;

  // ── Serialisation (omits null fields; ISO-8601 dates) ──────────────────────

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'zone': zone.name,
        if (qty != null) 'qty': qty,
        if (unit != null) 'unit': unit,
        if (expiry != null) 'expiry': expiry!.toIso8601String(),
        if (priceGbp != null) 'priceGbp': priceGbp,
        if (store != null) 'store': store,
        if (purchasedAt != null) 'purchasedAt': purchasedAt!.toIso8601String(),
        if (reorderCadenceDays != null) 'reorderCadenceDays': reorderCadenceDays,
        if (lastBought != null) 'lastBought': lastBought!.toIso8601String(),
        'source': source,
        if (ownerId != null) 'ownerId': ownerId,
        // `shared` is a real boolean state (never "unknown"), always emitted.
        'shared': shared,
      };

  factory PantryItem.fromJson(Map<String, dynamic> json) => PantryItem(
        id: json['id'] as String,
        name: json['name'] as String,
        zone: _zoneFromString(json['zone'] as String?),
        qty: (json['qty'] as num?)?.toDouble(),
        unit: json['unit'] as String?,
        expiry: _parseDate(json['expiry']),
        priceGbp: (json['priceGbp'] as num?)?.toDouble(),
        store: json['store'] as String?,
        purchasedAt: _parseDate(json['purchasedAt']),
        reorderCadenceDays: (json['reorderCadenceDays'] as num?)?.toInt(),
        lastBought: _parseDate(json['lastBought']),
        source: (json['source'] as String?) ?? 'manual',
        ownerId: json['ownerId'] as String?,
        shared: json['shared'] as bool? ?? false,
      );

  static DateTime? _parseDate(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }

  /// Return a copy with the given fields overridden. Like [Profile.copyWith],
  /// omitted args keep the existing value — it cannot set a field back to null.
  /// (The repo builds items directly when it needs an explicit value, e.g. a
  /// clamped qty.)
  PantryItem copyWith({
    String? id,
    String? name,
    PantryZone? zone,
    double? qty,
    String? unit,
    DateTime? expiry,
    double? priceGbp,
    String? store,
    DateTime? purchasedAt,
    int? reorderCadenceDays,
    DateTime? lastBought,
    String? source,
    String? ownerId,
    bool? shared,
  }) =>
      PantryItem(
        id: id ?? this.id,
        name: name ?? this.name,
        zone: zone ?? this.zone,
        qty: qty ?? this.qty,
        unit: unit ?? this.unit,
        expiry: expiry ?? this.expiry,
        priceGbp: priceGbp ?? this.priceGbp,
        store: store ?? this.store,
        purchasedAt: purchasedAt ?? this.purchasedAt,
        reorderCadenceDays: reorderCadenceDays ?? this.reorderCadenceDays,
        lastBought: lastBought ?? this.lastBought,
        source: source ?? this.source,
        ownerId: ownerId ?? this.ownerId,
        shared: shared ?? this.shared,
      );
}
