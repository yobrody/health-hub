/// Open Food Facts barcode-lookup client.
///
/// Resolves a scanned barcode to a real [PackagedFood] via the PUBLIC Open Food
/// Facts v2 API — no auth, and NOT the Health Hub backend (a different host), so
/// it takes its own [Dio], not the authed [ApiClient]'s.
///
/// **Honesty contract (the whole reason this exists):**
///  - A non-numeric / wrong-length barcode → `null` and NO request (garbage in
///    never becomes a fabricated product).
///  - `status != 1` / missing product / not-found → `null` (a clean "no result").
///  - Any [DioException] or parse failure → `null`, never thrown to the caller.
///  - A nutrient the database omits → `null` on the model, never `0`. Sodium is
///    derived from salt (via [sodiumMgFromSalt]) ONLY when OFF gives salt but no
///    sodium.
library;

import 'package:dio/dio.dart';

import 'packaged_food.dart';
import 'packaged_food_model.dart';

/// Looks up a barcode against the public Open Food Facts v2 API.
class OffClient {
  OffClient(this._dio);

  final Dio _dio;

  /// OFF asks API clients to identify themselves with a descriptive User-Agent
  /// (app name + contact). This is a courtesy their docs require.
  static const String _userAgent =
      'Health-Hub/1.0 (https://health-hub-dwz.pages.dev)';

  static const String _base = 'https://world.openfoodfacts.org/api/v2/product';

  /// Only the fields we actually map — keeps the response small.
  static const String _fields = 'product_name,brands,serving_size,nutriments';

  /// A typical retail barcode is 8–14 digits (EAN-8 … GTIN-14). Anything else
  /// (letters, empty, wrong length) is not a barcode we should query.
  static final RegExp _barcodeRe = RegExp(r'^\d{8,14}$');

  /// Resolve [code] to a [PackagedFood], or `null` for any no-result/error.
  Future<PackagedFood?> lookupBarcode(String code) async {
    // Validate BEFORE any network I/O — garbage never hits the API.
    if (!_barcodeRe.hasMatch(code)) return null;

    final Response<dynamic> response;
    try {
      response = await _dio.get<dynamic>(
        '$_base/$code.json?fields=$_fields',
        options: Options(headers: const {'User-Agent': _userAgent}),
      );
    } on DioException {
      // Network / server / bad-response — honest "no result", never a throw.
      return null;
    }

    try {
      final data = response.data;
      if (data is! Map) return null;

      // OFF signals a found product with status == 1 (int) or "1"/"success".
      final status = data['status'];
      final found = status == 1 || status == '1' || status == 'success';
      if (!found) return null;

      final product = data['product'];
      if (product is! Map) return null;

      final nutriments = product['nutriments'];
      final n = nutriments is Map ? nutriments : const <dynamic, dynamic>{};

      return PackagedFood(
        barcode: code,
        name: _str(product['product_name']),
        brand: _str(product['brands']),
        servingGrams: parseServingGrams(_str(product['serving_size'])),
        kcalPer100g: _num(n['energy-kcal_100g']),
        proteinPer100g: _num(n['proteins_100g']),
        carbsPer100g: _num(n['carbohydrates_100g']),
        fatPer100g: _num(n['fat_100g']),
        microsPer100g: _micros(n),
      );
    } catch (_) {
      // Any unexpected shape in the body — treat as no result, never crash.
      return null;
    }
  }

  /// Build the micros map from a nutriments block. ONLY present values become
  /// keys — an absent nutrient is never a `0`-valued key. Returns `null` when
  /// nothing was supplied.
  static Map<String, double>? _micros(Map<dynamic, dynamic> n) {
    final out = <String, double>{};

    final sugars = _num(n['sugars_100g']);
    if (sugars != null) out['sugars_g'] = sugars;

    final fiber = _num(n['fiber_100g']);
    if (fiber != null) out['fiber_g'] = fiber;

    final satFat = _num(n['saturated-fat_100g']);
    if (satFat != null) out['saturated_fat_g'] = satFat;

    // Sodium: prefer OFF's own sodium (grams → mg). Only when it's absent do we
    // derive it from salt — never both, never a fabricated 0.
    final sodiumG = _num(n['sodium_100g']);
    if (sodiumG != null) {
      out['sodium_mg'] = sodiumG * 1000.0;
    } else {
      final sodiumFromSalt = sodiumMgFromSalt(_num(n['salt_100g']));
      if (sodiumFromSalt != null) out['sodium_mg'] = sodiumFromSalt;
    }

    return out.isEmpty ? null : out;
  }

  /// Coerce a JSON number to a `double?`. Absent/non-numeric → `null` (OFF
  /// sometimes sends a numeric string). Never fabricates a value.
  static double? _num(Object? v) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v.trim());
    return null;
  }

  /// Trim a string field to `null` when empty/absent (OFF uses "" for unknown).
  static String? _str(Object? v) {
    if (v is! String) return null;
    final t = v.trim();
    return t.isEmpty ? null : t;
  }
}
