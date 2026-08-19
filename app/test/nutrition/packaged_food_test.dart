import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/packaged_food.dart';

void main() {
  group('parseServingGrams', () {
    test('reads a gram serving size', () {
      expect(parseServingGrams('30 g'), 30);
      expect(parseServingGrams('250g'), 250);
      expect(parseServingGrams('serving 45.5 g'), 45.5);
    });

    test('reads an ml serving size (liquids ~1 g/ml) so drinks scale too', () {
      // OFF often gives a drink's serving as "1 portion (330 ml)". Treat ml as
      // grams-equivalent (water density) rather than falling back to per-100g.
      expect(parseServingGrams('330 ml'), 330);
      expect(parseServingGrams('1 portion (330 ml)'), 330);
      expect(parseServingGrams('250ml'), 250);
    });

    test('prefers a gram value when both are present', () {
      expect(parseServingGrams('30 g (30 ml)'), 30);
    });

    test('returns null for missing/implausible/non-volumetric values', () {
      expect(parseServingGrams(null), isNull);
      expect(parseServingGrams(''), isNull);
      expect(parseServingGrams('1 cup'), isNull);
      expect(parseServingGrams('0 g'), isNull);
      expect(parseServingGrams('5000 g'), isNull); // implausible portion
      expect(parseServingGrams('5000 ml'), isNull); // implausible portion
    });
  });

  group('scalePer100gToServing', () {
    test('scales a per-100g value to a 500 g pot (NOT the per-100g number)', () {
      // The old bug: a 500 g pot logging as the per-100g figure. 59 kcal/100g
      // over 500 g is 295 kcal, not 59.
      expect(scalePer100gToServing(59, 500), 295);
      expect(scalePer100gToServing(12, 30), closeTo(3.6, 1e-9));
    });

    test('a 330 ml serving scales per-100g by 3.3', () {
      final grams = parseServingGrams('330 ml');
      expect(scalePer100gToServing(42, grams), closeTo(138.6, 1e-9));
    });

    test('null value in -> null out (never 0)', () {
      expect(scalePer100gToServing(null, 500), isNull);
    });

    test('null serving-grams in -> null out (no guess)', () {
      expect(scalePer100gToServing(59, null), isNull);
    });

    test('a genuine 0 per-100g stays 0 (a real value)', () {
      // 0 kcal diet cola is a REAL measured value, not missing data.
      expect(scalePer100gToServing(0, 330), 0);
    });
  });

  group('sodiumMgFromSalt', () {
    test('derives sodium (mg) from salt (g) using the 400 factor', () {
      // Standard: sodium = salt / 2.5, i.e. 1 g salt -> 400 mg sodium.
      expect(sodiumMgFromSalt(1), closeTo(400, 1e-9));
      expect(sodiumMgFromSalt(2.5), closeTo(1000, 1e-9));
      expect(sodiumMgFromSalt(0), 0);
    });

    test('null salt -> null (missing, not 0)', () {
      expect(sodiumMgFromSalt(null), isNull);
    });
  });

  group('isRelevantMatch', () {
    test('accepts a match sharing a real keyword (>=4 letters)', () {
      expect(
        isRelevantMatch('Grilled chicken breast', 'Chicken Breast Fillet', 'Tesco'),
        isTrue,
      );
    });

    test('accepts a match sharing a known short brand the keyword filter would drop', () {
      expect(isRelevantMatch('Pret tuna baguette', 'Tuna Nicoise', 'Pret'), isTrue);
    });

    test('rejects an unrelated product with no shared keyword or brand', () {
      // The subtle dishonesty: "Tesco chicken club" adopting some unrelated
      // "chicken soup" product's real-but-wrong numbers.
      expect(isRelevantMatch('Banana', 'Chocolate Digestives', 'McVities'), isFalse);
    });
  });

  group('isLikelyPackaged', () {
    test('flags the Tesco Chicken Club box (the real front-of-pack bug)', () {
      expect(
        isLikelyPackaged('Tesco The Chicken Club Beechwood Smoked Bacon'),
        isTrue,
      );
    });

    test('flags well-known packaged brands even without a retailer name', () {
      expect(isLikelyPackaged('For Goodness Shakes Protein Chocolate'), isTrue);
      expect(isLikelyPackaged('Grenade Carb Killa Caramel'), isTrue);
      expect(isLikelyPackaged('Graham’s The Family Dairy Quark'), isTrue);
    });

    test('flags other UK supermarket own-brands', () {
      expect(isLikelyPackaged('Aldi Brooklea Greek Yogurt'), isTrue);
      expect(isLikelyPackaged("Sainsbury's Basmati Rice"), isTrue);
      expect(isLikelyPackaged('M&S Chicken Tikka'), isTrue);
    });

    test('does NOT flag genuinely generic plated / whole foods', () {
      expect(isLikelyPackaged('chicken breast'), isFalse);
      expect(isLikelyPackaged('banana'), isFalse);
      expect(isLikelyPackaged('bread roll'), isFalse);
      expect(isLikelyPackaged('ketchup'), isFalse);
      expect(isLikelyPackaged('brown rice'), isFalse);
      expect(isLikelyPackaged('scrambled eggs'), isFalse);
    });

    test('is case-insensitive and tolerant of whitespace', () {
      expect(isLikelyPackaged('  TESCO the chicken club  '), isTrue);
      expect(isLikelyPackaged('tesco'), isTrue);
    });

    test('matches retailer tokens only as whole words (no false substring hits)', () {
      expect(isLikelyPackaged('chicken coop eggs'), isFalse);
      expect(isLikelyPackaged('aldente pasta'), isFalse); // not "Aldi"
    });

    test('handles empty / null input safely', () {
      expect(isLikelyPackaged(''), isFalse);
      expect(isLikelyPackaged(null), isFalse);
    });
  });

  group('sharedBrandToken', () {
    test('confirms a short-brand match the keyword check would miss', () {
      expect(
        sharedBrandToken('M&S Chicken Tikka', 'Chicken Tikka Masala — M&S'),
        isTrue,
      );
      expect(sharedBrandToken('Co-op Meal Deal Wrap', 'Co-op Chicken Wrap'), isTrue);
    });

    test('is false when the two strings share no known brand', () {
      expect(
        sharedBrandToken('Tesco Chicken Club', 'Sainsbury’s Chicken Salad'),
        isFalse,
      );
      expect(sharedBrandToken('banana', 'apple'), isFalse);
    });

    test('is false when neither string carries a brand at all', () {
      expect(sharedBrandToken('chicken breast', 'grilled chicken'), isFalse);
    });
  });
}
