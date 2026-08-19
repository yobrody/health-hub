/// The nutrition food-log model — one logged food/drink item.
///
/// **Honesty is the whole point.** Macros AND micronutrients are nullable; a
/// value the user (or a scan/AI) has not measured is `null`, persists as `null`,
/// and is OMITTED from the serialised map — never fabricated as `0`. A genuine
/// `0` (e.g. 0 kcal diet cola) is a REAL value and is preserved. This mirrors
/// [PantryItem]/[Profile]'s honesty rule.
///
/// Every entry also carries an [AccuracyTier]: a weighed/barcode log is
/// [AccuracyTier.exact]; a guessed/AI-estimated log is [AccuracyTier.estimate]
/// (the UI shows `~`). An estimate is NEVER presented as exact — so when the
/// stored tier is absent/unknown we fall back to [AccuracyTier.estimate], not
/// [AccuracyTier.exact].
library;

/// How trustworthy an entry's numbers are.
///
///  • [exact] — weighed, barcode-matched, or otherwise measured.
///  • [estimate] — guessed or AI-estimated; the UI surfaces this with a `~`.
///
/// Never present an [estimate] as [exact].
enum AccuracyTier { exact, estimate }

/// Parse a stored tier string. Unknown/absent → [AccuracyTier.estimate] — an
/// entry with no recorded provenance must NOT claim exactness.
AccuracyTier _tierFromString(String? raw) {
  for (final t in AccuracyTier.values) {
    if (t.name == raw) return t;
  }
  return AccuracyTier.estimate;
}

class FoodLogEntry {
  const FoodLogEntry({
    required this.id,
    required this.name,
    required this.at,
    this.kcal,
    this.proteinG,
    this.carbsG,
    this.fatG,
    this.micros,
    this.grams,
    required this.tier,
    this.ateOut = false,
    this.restaurant,
    this.spendGbp,
    this.barcode,
    required this.source,
    this.ownerId,
    this.shared = false,
  });

  /// Stable identifier (used in the API path + Outbox dedupe key).
  final String id;

  /// Human-readable name, e.g. "Chicken breast".
  final String name;

  /// When it was eaten (local time). Persisted as ISO-8601, used for the
  /// LOCAL-date day filter (`logsForDay`).
  final DateTime at;

  /// Energy in kcal. `null` when unknown — NEVER a fabricated `0`. A genuine
  /// `0` (a zero-calorie item) is a real value and preserved.
  final double? kcal;

  /// Protein in grams. `null` when unmeasured.
  final double? proteinG;

  /// Carbohydrate in grams. `null` when unmeasured.
  final double? carbsG;

  /// Fat in grams. `null` when unmeasured.
  final double? fatG;

  /// Micronutrients, keyed by name (e.g. `sodium_mg`, `iron_mg`). ONLY present
  /// when actually measured — an absent key means "not measured" (→ `—` in UI),
  /// never `0`. A `null` (or empty) map means no micros were measured at all.
  final Map<String, double>? micros;

  /// Portion weight in grams. `null` when unknown.
  final double? grams;

  /// How trustworthy the numbers are (weighed/barcode vs guessed).
  final AccuracyTier tier;

  /// Whether this was eaten out. An eating-out entry records [spendGbp] and does
  /// NOT deduct from the pantry — that distinction is carried here; the repo is
  /// pantry-agnostic and never touches pantry logic.
  final bool ateOut;

  /// Where it was eaten out (free text). `null` if not applicable/unknown.
  final String? restaurant;

  /// Spend in GBP for an eating-out entry. `null` when not applicable/unknown.
  final double? spendGbp;

  /// Scanned barcode (EAN/UPC) when logged from a package. `null` otherwise.
  final String? barcode;

  /// Provenance of the record: e.g. "manual", "barcode", "ai", "off".
  final String source;

  /// The social seam — owner of this entry. `null` = personal/unscoped.
  final String? ownerId;

  /// The social seam — whether this entry is shared. Defaults `false`.
  final bool shared;

  // ── Serialisation (omits null/empty fields; ISO-8601 local `at`) ────────────

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'at': at.toIso8601String(),
        if (kcal != null) 'kcal': kcal,
        if (proteinG != null) 'proteinG': proteinG,
        if (carbsG != null) 'carbsG': carbsG,
        if (fatG != null) 'fatG': fatG,
        // Micros omitted when null OR empty — an empty map is "nothing measured",
        // which must serialise as absent, never `{}`.
        if (micros != null && micros!.isNotEmpty) 'micros': micros,
        if (grams != null) 'grams': grams,
        'tier': tier.name,
        // `ateOut`/`shared` are real boolean states (never "unknown"), always
        // emitted.
        'ateOut': ateOut,
        if (restaurant != null) 'restaurant': restaurant,
        if (spendGbp != null) 'spendGbp': spendGbp,
        if (barcode != null) 'barcode': barcode,
        'source': source,
        if (ownerId != null) 'ownerId': ownerId,
        'shared': shared,
      };

  factory FoodLogEntry.fromJson(Map<String, dynamic> json) => FoodLogEntry(
        id: json['id'] as String,
        name: json['name'] as String,
        at: DateTime.parse(json['at'] as String),
        kcal: (json['kcal'] as num?)?.toDouble(),
        proteinG: (json['proteinG'] as num?)?.toDouble(),
        carbsG: (json['carbsG'] as num?)?.toDouble(),
        fatG: (json['fatG'] as num?)?.toDouble(),
        micros: _microsFromJson(json['micros']),
        grams: (json['grams'] as num?)?.toDouble(),
        tier: _tierFromString(json['tier'] as String?),
        ateOut: json['ateOut'] as bool? ?? false,
        restaurant: json['restaurant'] as String?,
        spendGbp: (json['spendGbp'] as num?)?.toDouble(),
        barcode: json['barcode'] as String?,
        source: (json['source'] as String?) ?? 'manual',
        ownerId: json['ownerId'] as String?,
        shared: json['shared'] as bool? ?? false,
      );

  /// Parse the micros map. Absent/empty → `null` (not measured), never `{}`.
  static Map<String, double>? _microsFromJson(Object? raw) {
    if (raw is! Map || raw.isEmpty) return null;
    final out = <String, double>{};
    raw.forEach((k, v) {
      if (v is num) out[k.toString()] = v.toDouble();
    });
    return out.isEmpty ? null : out;
  }

  /// Return a copy with the given fields overridden. Like [PantryItem.copyWith],
  /// omitted args keep the existing value — it cannot set a field back to null.
  FoodLogEntry copyWith({
    String? id,
    String? name,
    DateTime? at,
    double? kcal,
    double? proteinG,
    double? carbsG,
    double? fatG,
    Map<String, double>? micros,
    double? grams,
    AccuracyTier? tier,
    bool? ateOut,
    String? restaurant,
    double? spendGbp,
    String? barcode,
    String? source,
    String? ownerId,
    bool? shared,
  }) =>
      FoodLogEntry(
        id: id ?? this.id,
        name: name ?? this.name,
        at: at ?? this.at,
        kcal: kcal ?? this.kcal,
        proteinG: proteinG ?? this.proteinG,
        carbsG: carbsG ?? this.carbsG,
        fatG: fatG ?? this.fatG,
        micros: micros ?? this.micros,
        grams: grams ?? this.grams,
        tier: tier ?? this.tier,
        ateOut: ateOut ?? this.ateOut,
        restaurant: restaurant ?? this.restaurant,
        spendGbp: spendGbp ?? this.spendGbp,
        barcode: barcode ?? this.barcode,
        source: source ?? this.source,
        ownerId: ownerId ?? this.ownerId,
        shared: shared ?? this.shared,
      );
}
