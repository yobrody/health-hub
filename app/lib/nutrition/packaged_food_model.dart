/// A packaged product resolved from a food database (Open Food Facts), keyed by
/// barcode. This is the HONEST intermediary between a barcode scan and a
/// [FoodLogEntry]: it holds a product's per-100g nutrition exactly as the
/// database supplies it, and knows its serving size, but does NOT scale until a
/// caller asks — so the "500 g pot logged as the per-100g number" bug can't
/// happen and a value the database never gave us stays `null`, never `0`.
///
/// **Honesty rules baked in:**
///  - Every nutrient is nullable + per-100g. Absent in the database → `null`.
///  - [servingGrams] is parsed from OFF's `serving_size` via [parseServingGrams]
///    (grams authoritative, ml ~1 g/ml fallback); an unparseable/absent serving
///    stays `null` rather than defaulting to a guessed 100 g.
///  - [microsPer100g] holds ONLY the micros actually present (sugars, fibre,
///    saturated fat, sodium). An absent micro is simply not a key — never `0`.
///  - [toServing]/[atServing] scale via [scalePer100gToServing], so a `null`
///    per-100g stays `null` after scaling and can't be rounded up to `0`.
library;

import 'packaged_food.dart';

/// An immutable packaged-food record from a barcode lookup.
class PackagedFood {
  const PackagedFood({
    required this.barcode,
    this.name,
    this.brand,
    this.servingGrams,
    this.kcalPer100g,
    this.proteinPer100g,
    this.carbsPer100g,
    this.fatPer100g,
    this.microsPer100g,
  });

  /// The scanned barcode (EAN/UPC) this product was resolved from.
  final String barcode;

  /// Product name as the database reports it (e.g. "Coca-Cola"). `null` if the
  /// database has no name — the caller/UI should then let the user confirm.
  final String? name;

  /// Brand/manufacturer as reported. `null` when the database has none.
  final String? brand;

  /// Serving size in grams, parsed from OFF's `serving_size`. `null` when the
  /// serving is absent or in a non-gram/ml unit we can't honestly convert.
  final double? servingGrams;

  /// Energy per 100 g (kcal). `null` when the database omits it — never `0`.
  final double? kcalPer100g;

  /// Protein per 100 g (g). `null` when absent.
  final double? proteinPer100g;

  /// Carbohydrate per 100 g (g). `null` when absent.
  final double? carbsPer100g;

  /// Fat per 100 g (g). `null` when absent.
  final double? fatPer100g;

  /// Micronutrients per 100 g, keyed by name (`sugars_g`, `fiber_g`,
  /// `saturated_fat_g`, `sodium_mg`). ONLY present micros are keys; an absent
  /// micro is not in the map (→ `—` in UI), never `0`. `null`/empty means none
  /// were supplied at all.
  final Map<String, double>? microsPer100g;

  /// Scale every nutrient to [grams], reusing [scalePer100gToServing] so a
  /// missing per-100g value stays `null` (never `0`, never the raw per-100g).
  ///
  /// Returns a map with keys `kcal`, `proteinG`, `carbsG`, `fatG`, plus each
  /// micro's own key (e.g. `sugars_g`). Values are `double?` — `null` when the
  /// underlying per-100g was `null`. The caller (capture UI, next task) maps
  /// these onto a [FoodLogEntry].
  Map<String, double?> toServing(double grams) {
    final out = <String, double?>{
      'kcal': scalePer100gToServing(kcalPer100g, grams),
      'proteinG': scalePer100gToServing(proteinPer100g, grams),
      'carbsG': scalePer100gToServing(carbsPer100g, grams),
      'fatG': scalePer100gToServing(fatPer100g, grams),
    };
    final micros = microsPer100g;
    if (micros != null) {
      micros.forEach((k, v) {
        out[k] = scalePer100gToServing(v, grams);
      });
    }
    return out;
  }

  /// Scale to this product's own parsed [servingGrams]. When [servingGrams] is
  /// `null` (no honest serving size) EVERY value is `null` — we never invent a
  /// portion. The caller can fall back to per-100g or ask the user for grams.
  Map<String, double?> atServing() {
    final grams = servingGrams;
    if (grams == null) {
      final out = <String, double?>{
        'kcal': null,
        'proteinG': null,
        'carbsG': null,
        'fatG': null,
      };
      microsPer100g?.forEach((k, _) => out[k] = null);
      return out;
    }
    return toServing(grams);
  }
}
