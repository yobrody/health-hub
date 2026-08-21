/// AI photo → pantry recognition models (R-2).
///
/// A [RecognizedItem] is a **suggestion**, not a saved pantry fact. It carries
/// an honest [confidence] (0..1) and best-guess fields. Honesty rules mirror
/// [PantryItem]:
///  • [qtyGuess] / [unitGuess] stay `null` unless the amount was CLEARLY visible
///    — never fabricate a quantity we did not actually see.
///  • NOTHING here is written to the pantry. The confirm screen turns a
///    (possibly edited) [RecognizedItem] into a real [PantryItem] only on the
///    user's explicit confirm.
library;

import '../pantry_item.dart';

/// Parse a zone string from the recognizer back to the enum. Unknown/absent →
/// `pantry` (a safe, visible default — pantry is the least-perishable guess, so
/// a mis-zoned item never fabricates a fridge/freezer urgency it can't back up;
/// the user can re-zone before confirming anyway).
PantryZone recognizedZoneFromString(String? raw) {
  for (final z in PantryZone.values) {
    if (z.name == raw) return z;
  }
  return PantryZone.pantry;
}

/// A single item the vision model claims to see, with an honest confidence.
class RecognizedItem {
  const RecognizedItem({
    required this.name,
    required this.zoneGuess,
    required this.confidence,
    this.qtyGuess,
    this.unitGuess,
  });

  /// Human-readable name the model recognized, e.g. "Milk".
  final String name;

  /// Best-guess storage zone. Editable by the user before confirming.
  final PantryZone zoneGuess;

  /// Model confidence in [0.0, 1.0]. Shown honestly in the UI (low-confidence
  /// items are flagged, never hidden). Clamped into range on construction from
  /// JSON so a malformed value can't render a >100% / negative confidence.
  final double confidence;

  /// Best-guess quantity, or `null` when the amount was not clearly visible.
  /// NEVER fabricated — a null here is an honest "amount unknown".
  final double? qtyGuess;

  /// Unit for [qtyGuess] (e.g. "g", "ml", "pack"), or `null` when unknown.
  final String? unitGuess;

  Map<String, dynamic> toJson() => {
        'name': name,
        'zoneGuess': zoneGuess.name,
        'confidence': confidence,
        if (qtyGuess != null) 'qtyGuess': qtyGuess,
        if (unitGuess != null) 'unitGuess': unitGuess,
      };

  factory RecognizedItem.fromJson(Map<String, dynamic> json) {
    final rawConf = (json['confidence'] as num?)?.toDouble() ?? 0.0;
    final conf = rawConf.isNaN
        ? 0.0
        : rawConf.clamp(0.0, 1.0).toDouble();
    return RecognizedItem(
      name: (json['name'] as String? ?? '').trim(),
      zoneGuess: recognizedZoneFromString(json['zoneGuess'] as String?),
      confidence: conf,
      qtyGuess: (json['qtyGuess'] as num?)?.toDouble(),
      unitGuess: (json['unitGuess'] as String?)?.trim().isEmpty ?? true
          ? null
          : (json['unitGuess'] as String).trim(),
    );
  }

  RecognizedItem copyWith({
    String? name,
    PantryZone? zoneGuess,
    double? confidence,
    double? qtyGuess,
    String? unitGuess,
  }) =>
      RecognizedItem(
        name: name ?? this.name,
        zoneGuess: zoneGuess ?? this.zoneGuess,
        confidence: confidence ?? this.confidence,
        qtyGuess: qtyGuess ?? this.qtyGuess,
        unitGuess: unitGuess ?? this.unitGuess,
      );
}

/// The result of a recognition pass — a (possibly empty) list of suggestions.
///
/// An **empty** [items] is an honest "couldn't identify anything", NOT an error
/// and NOT an excuse to invent items. The UI shows a manual-add fallback.
class RecognitionResult {
  const RecognitionResult({required this.items});

  final List<RecognizedItem> items;

  /// An empty result — the honest "nothing recognized" state.
  static const RecognitionResult empty = RecognitionResult(items: []);

  Map<String, dynamic> toJson() =>
      {'items': items.map((i) => i.toJson()).toList()};

  factory RecognitionResult.fromJson(Map<String, dynamic> json) {
    final raw = json['items'];
    if (raw is! List) return RecognitionResult.empty;
    return RecognitionResult(
      items: raw
          .whereType<Map<String, dynamic>>()
          .map(RecognizedItem.fromJson)
          // Drop nameless rows defensively — an item with no name is not a
          // real suggestion the user could confirm.
          .where((i) => i.name.isNotEmpty)
          .toList(),
    );
  }
}
