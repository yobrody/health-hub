/// The AI nutrition-estimate client seam (P1 capture).
///
/// Turns a meal photo OR a text description into a [NutritionEstimate] the
/// user confirms before logging.
///
/// Two implementations:
///  • [SupabaseNutritionEstimateClient] — the REAL one. base64-encodes the
///    photo (or forwards the text) and calls the `estimate-nutrition` Edge
///    Function, parsing its JSON. On ANY error/empty response it returns `null`
///    — it NEVER throws to the UI and NEVER fabricates an estimate. The caller
///    falls back to the manual form on `null`.
///  • [FakeNutritionEstimateClient] — for tests. Returns a canned estimate (or
///    null) with no network.
///
/// [nutritionEstimateClientProvider] is overridable in tests via
/// `ProviderScope(overrides: [...])`, so the real Supabase client is NEVER
/// instantiated in a test path.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'nutrition_estimate.dart';

/// The name of the Supabase Edge Function this client calls.
const String kEstimateNutritionFunction = 'estimate-nutrition';

/// The estimate seam. Implementations turn a photo/text into an estimate.
abstract class NutritionEstimateClient {
  /// Estimate the nutrition of a meal from a photo's bytes.
  ///
  /// Returns a [NutritionEstimate] on success, or `null` on any failure/empty
  /// result. NEVER throws — the caller falls back to the manual form on `null`.
  Future<NutritionEstimate?> estimateFromPhoto(Uint8List image);

  /// Estimate the nutrition of a meal from a text description.
  ///
  /// Returns a [NutritionEstimate] on success, or `null` on any failure/empty
  /// result. NEVER throws.
  Future<NutritionEstimate?> estimateFromText(String description);
}

/// The REAL client — calls the `estimate-nutrition` Edge Function.
class SupabaseNutritionEstimateClient implements NutritionEstimateClient {
  SupabaseNutritionEstimateClient(this._client);

  final SupabaseClient _client;

  @override
  Future<NutritionEstimate?> estimateFromPhoto(Uint8List image) {
    if (image.isEmpty) return Future.value(null);
    return _invoke({'image': base64Encode(image)});
  }

  @override
  Future<NutritionEstimate?> estimateFromText(String description) {
    final text = description.trim();
    if (text.isEmpty) return Future.value(null);
    return _invoke({'text': text});
  }

  /// Invoke the function and parse the result. Any error/empty → `null`; never
  /// throws, never fabricates an estimate.
  Future<NutritionEstimate?> _invoke(Map<String, dynamic> body) async {
    final FunctionResponse response;
    try {
      response = await _client.functions.invoke(
        kEstimateNutritionFunction,
        body: body,
      );
    } catch (_) {
      // Unreachable / auth / function error — honest null, fall back to manual.
      return null;
    }

    if (response.status < 200 || response.status >= 300) return null;

    final data = response.data;
    if (data is! Map) return null;

    try {
      final map = Map<String, dynamic>.from(data);
      // An honest "I couldn't estimate anything" (no name, no macros) is still
      // a null-result → manual fallback, not a fabricated empty estimate.
      final estimate = NutritionEstimate.fromJson(map);
      if (estimate.name == null && !estimate.hasAnyMacro) return null;
      return estimate;
    } catch (_) {
      return null;
    }
  }
}

/// A test/offline client — returns a canned [result] (or `null`) with no
/// network. Records the last inputs so a test can assert the seam forwarded
/// bytes/text.
class FakeNutritionEstimateClient implements NutritionEstimateClient {
  FakeNutritionEstimateClient({this.result});

  /// The canned estimate to return, or `null` to drive the fallback path.
  final NutritionEstimate? result;

  /// The image last passed to [estimateFromPhoto].
  Uint8List? lastImage;

  /// The text last passed to [estimateFromText].
  String? lastText;

  @override
  Future<NutritionEstimate?> estimateFromPhoto(Uint8List image) async {
    lastImage = image;
    return result;
  }

  @override
  Future<NutritionEstimate?> estimateFromText(String description) async {
    lastText = description;
    return result;
  }
}

/// The estimate client provider.
///
/// Defaults to the REAL [SupabaseNutritionEstimateClient]. Tests ALWAYS
/// override this with a [FakeNutritionEstimateClient], so the real client is
/// never built under test.
final nutritionEstimateClientProvider =
    Provider<NutritionEstimateClient>((ref) {
  return SupabaseNutritionEstimateClient(Supabase.instance.client);
});
