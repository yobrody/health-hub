/// Packaged-food honesty helpers — the accuracy backbone for barcode/label
/// nutrition logging. Pure functions only (no IO).
///
/// **Why this exists:** the photo scanner once confidently guessed macros for a
/// Tesco "The Chicken Club" box it could only see from the front (no readable
/// label) — 200 kcal / 5 g carbs for a bread sandwich, which is impossible. For
/// packaged products the honest move is NOT to guess: look the branded name up
/// in a real food database (Open Food Facts), scale its per-100g figures to the
/// ACTUAL serving/pack size, and reject a hit that isn't really the same
/// product. Missing data stays `null` — never a fabricated `0` or a guess.
///
/// Ported for parity with the legacy `src/lib/packaged-food.ts`.
library;

// UK grocery retailers + their own-brand sub-brands, and well-known packaged
// food/drink brands. Whole-word matched, case-insensitive.
const List<String> _brandTokens = <String>[
  // Supermarkets / retailers
  'tesco', 'sainsbury', "sainsbury's", 'sainsburys', 'asda', 'morrisons',
  'waitrose', 'aldi', 'lidl', 'iceland', 'ocado', 'co-op', 'co op',
  'marks & spencer', 'm&s', 'boots', 'greggs', 'pret', 'nisa', 'spar',
  // Supermarket own-brand ranges
  'brooklea', 'hearty food', 'by sainsbury', 'nutmeg', 'the collection',
  // Packaged food / drink / supplement brands
  'for goodness shakes', 'grenade', 'carb killa', 'huel', 'myprotein',
  'optimum nutrition', 'quest', 'weetabix', 'kelloggs', "kellogg's",
  'graham', "graham's", 'alpro', 'yeo valley', 'muller', 'müller', 'arla',
  'walkers', 'cadbury', 'nakd', 'trek', 'eat natural', 'belvita', 'warburtons',
  'hovis', 'kingsmill', 'heinz', 'birds eye', 'quorn', 'linda mccartney',
];

/// Escape a token for use in a RegExp.
String _esc(String s) => s.replaceAllMapped(
      RegExp(r'[.*+?^${}()|[\]\\]'),
      (m) => '\\${m[0]}',
    );

// One alternation regex with word-ish boundaries. We can't use plain \b on
// tokens containing spaces / punctuation (& , - '), so we anchor on a
// non-letter (or string edge) either side of the token.
final RegExp _tokenRe = RegExp(
  '(^|[^a-z])(${_brandTokens.map(_esc).join('|')})([^a-z]|\$)',
  caseSensitive: false,
);

/// Does this food name look like a *packaged, branded* supermarket product
/// rather than a generic plated/whole food? Deliberately conservative: only
/// confident brand/retailer tokens as whole words, never loose substrings.
bool isLikelyPackaged(String? name) {
  if (name == null) return false;
  final n = name.trim().toLowerCase();
  if (n.isEmpty) return false;
  return _tokenRe.hasMatch(n);
}

/// Which known brand/retailer tokens appear (as whole words) in a string.
List<String> brandTokensIn(String? name) {
  if (name == null) return const <String>[];
  final n = name.trim().toLowerCase();
  if (n.isEmpty) return const <String>[];
  return _brandTokens
      .where((tok) => RegExp(
            '(^|[^a-z])(${_esc(tok)})([^a-z]|\$)',
            caseSensitive: false,
          ).hasMatch(n))
      .toList();
}

/// Parse a gram weight out of an Open Food Facts serving/quantity string
/// ("30 g", "250g", "serving 45.5 g"). Grams are authoritative; ml is only a
/// fallback for liquids (treated as ~1 g/ml). Returns `null` for non-gram/ml
/// units ("1 cup") or implausible portions (0 or ≥2000), so callers fall back
/// honestly rather than scaling by a bogus number — never a guess.
double? parseServingGrams(String? serving) {
  if (serving == null || serving.isEmpty) return null;
  // Grams first (authoritative). A digit then optional space then "g"/"grams"
  // not immediately followed by another letter, so "30 g" matches but the "g"
  // inside a word doesn't. Handles "30 g", "250g", "serving 45.5 g".
  final gm = RegExp(r'(\d+(?:\.\d+)?)\s*g(?:rams?)?\b', caseSensitive: false)
      .firstMatch(serving);
  if (gm != null) {
    final g = double.parse(gm.group(1)!);
    return g > 0 && g < 2000 ? g : null;
  }
  // Fall back to ml for liquids (a 330 ml can). Treat ml as grams-equivalent
  // (water density ~1 g/ml) so drinks scale to their serving instead of the
  // disclosed per-100g. Good enough for logging; exact density is rarely known.
  final mm =
      RegExp(r'(\d+(?:\.\d+)?)\s*ml\b', caseSensitive: false).firstMatch(serving);
  if (mm != null) {
    final ml = double.parse(mm.group(1)!);
    return ml > 0 && ml < 2000 ? ml : null;
  }
  return null;
}

/// Scale a per-100g nutrient value to the actual serving/pack size.
///
/// **Honesty:** if the per-100g value is missing (`null`) OR the serving-grams
/// is unknown (`null`), we return `null` — never `0` and never the raw per-100g
/// figure. A genuine `0` per-100g (e.g. 0 kcal diet cola) is a REAL value and is
/// preserved. This is the fix for the "500 g pot logged as the per-100g number"
/// bug.
double? scalePer100gToServing(double? per100g, double? servingGrams) {
  if (per100g == null || servingGrams == null) return null;
  return per100g * servingGrams / 100.0;
}

/// Derive sodium (mg) from an Open Food Facts salt figure (g), for when OFF
/// only supplies salt. Standard nutrition factor: sodium = salt / 2.5, i.e.
/// 1 g salt → 400 mg sodium. Returns `null` when salt is missing (not `0`).
double? sodiumMgFromSalt(double? saltG) {
  if (saltG == null) return null;
  return saltG / 2.5 * 1000.0;
}

/// A database hit only counts if it plausibly IS the queried product — the query
/// and the matched product must share a real word (≥4 letters) or a known brand.
/// Without this, "Tesco chicken club" could silently adopt some unrelated
/// "chicken" product's real-but-wrong numbers — a subtler dishonesty than an
/// open guess. The brand check rescues short brands ("Pret", "M&S", "Co-op")
/// the ≥4-letter keyword filter drops.
bool isRelevantMatch(String query, String name, String brand) {
  final hay = '$name $brand'.toLowerCase();
  final words = RegExp(r'[a-z]{4,}')
      .allMatches(query.toLowerCase())
      .map((m) => m.group(0)!)
      .toList();
  if (words.any(hay.contains)) return true;
  return sharedBrandToken(query, '$name $brand');
}

/// Do two strings share a known brand/retailer? Used to confirm a database match
/// really is the SAME product for short brands ("Pret", "M&S", "Co-op") that the
/// generic ≥4-letter keyword check would drop.
bool sharedBrandToken(String? a, String? b) {
  final ta = brandTokensIn(a);
  if (ta.isEmpty) return false;
  final tb = brandTokensIn(b).toSet();
  return ta.any(tb.contains);
}
