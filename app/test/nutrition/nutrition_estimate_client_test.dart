// Unit tests for the FakeNutritionEstimateClient seam.
//
// The REAL SupabaseNutritionEstimateClient is never built in tests (it needs a
// live Supabase client); it's covered by the widget tests via the fake override.
// Here we assert the fake forwards inputs and returns the canned result — the
// same contract the UI relies on.

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/estimate/nutrition_estimate.dart';
import 'package:health_hub/nutrition/estimate/nutrition_estimate_client.dart';

void main() {
  test('estimateFromPhoto forwards bytes and returns the canned result',
      () async {
    const canned = NutritionEstimate(name: 'Salad', kcal: 200, confidence: 0.6);
    final client = FakeNutritionEstimateClient(result: canned);
    final bytes = Uint8List.fromList([1, 2, 3]);

    final result = await client.estimateFromPhoto(bytes);

    expect(result, same(canned));
    expect(client.lastImage, bytes);
  });

  test('estimateFromText forwards text and returns the canned result',
      () async {
    const canned = NutritionEstimate(name: 'Curry', kcal: 600, confidence: 0.5);
    final client = FakeNutritionEstimateClient(result: canned);

    final result = await client.estimateFromText('chicken curry');

    expect(result, same(canned));
    expect(client.lastText, 'chicken curry');
  });

  test('a null-result fake returns null (drives the manual fallback)', () async {
    final client = FakeNutritionEstimateClient(result: null);
    expect(await client.estimateFromText('anything'), isNull);
    expect(await client.estimateFromPhoto(Uint8List.fromList([9])), isNull);
  });
}
