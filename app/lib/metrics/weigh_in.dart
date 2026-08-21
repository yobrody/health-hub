/// A single weigh-in — one dated body-weight reading.
///
/// **Honesty:** [weightKg] is nullable. A reading with no recorded weight
/// (imported/placeholder) stores `null`, never a fabricated `0`. A genuine `0`
/// would be nonsensical for weight, so a null truly means "not recorded". The
/// [at] timestamp is mandatory — every reading is anchored to a real moment.
///
/// The `toJson` keys (`weightKg`, `at`) match the [SupabaseSyncSender]'s
/// `weigh_ins` flat-column lift, so `weight_kg`/`at` populate on sync.
library;

class WeighIn {
  const WeighIn({
    required this.id,
    required this.at,
    this.weightKg,
  });

  /// Stable client-generated identifier (`weigh-<micros>`). Used in the API
  /// path + Outbox dedupe key and as the Supabase row PK.
  final String id;

  /// When the reading was taken (local time). Persisted as ISO-8601.
  final DateTime at;

  /// Body weight in kg. `null` when not recorded — never a fabricated `0`.
  final double? weightKg;

  /// Mint a new weigh-in with a client-generated id anchored to [at]
  /// (defaults to now).
  factory WeighIn.now({double? weightKg, DateTime? at}) {
    final when = at ?? DateTime.now();
    return WeighIn(
      id: 'weigh-${when.microsecondsSinceEpoch}',
      at: when,
      weightKg: weightKg,
    );
  }

  /// Serialise to JSON. `at` is always emitted (a real anchor); the weight is
  /// omitted when null — never a stand-in `0`.
  Map<String, dynamic> toJson() => {
        'id': id,
        'at': at.toIso8601String(),
        if (weightKg != null) 'weightKg': weightKg,
      };

  factory WeighIn.fromJson(Map<String, dynamic> json) => WeighIn(
        id: json['id'] as String,
        at: DateTime.parse(json['at'] as String),
        weightKg: (json['weightKg'] as num?)?.toDouble(),
      );

  /// Return a copy with the given fields overridden. Omitted args keep the
  /// existing value (cannot set a field back to null).
  WeighIn copyWith({
    String? id,
    DateTime? at,
    double? weightKg,
  }) =>
      WeighIn(
        id: id ?? this.id,
        at: at ?? this.at,
        weightKg: weightKg ?? this.weightKg,
      );
}
