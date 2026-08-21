// Model tests for WeighIn — nullable-honest weight, mandatory anchored `at`,
// omit-null round-trip, WeighIn.now id/anchor, copyWith.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/metrics/weigh_in.dart';

void main() {
  test('toJson always carries id + at; omits a null weight', () {
    final w = WeighIn(id: 'weigh-1', at: DateTime(2026, 8, 21, 8));
    final json = w.toJson();
    expect(json['id'], 'weigh-1');
    expect(json['at'], DateTime(2026, 8, 21, 8).toIso8601String());
    // A null weight is absent — never a fabricated 0.
    expect(json.containsKey('weightKg'), isFalse);
  });

  test('a real weight round-trips faithfully', () {
    final w = WeighIn(id: 'weigh-1', at: DateTime(2026, 8, 21), weightKg: 62.5);
    final back = WeighIn.fromJson(w.toJson());
    expect(back.id, 'weigh-1');
    expect(back.weightKg, 62.5);
    expect(back.at, DateTime(2026, 8, 21));
  });

  test('WeighIn.now mints a weigh-<micros> id anchored to at', () {
    final at = DateTime(2026, 8, 21, 9, 30);
    final w = WeighIn.now(weightKg: 63, at: at);
    expect(w.at, at);
    expect(w.id, 'weigh-${at.microsecondsSinceEpoch}');
    expect(w.weightKg, 63);
  });

  test('WeighIn.now with no weight stores null (honest, not 0)', () {
    final w = WeighIn.now(at: DateTime(2026, 8, 21));
    expect(w.weightKg, isNull);
    expect(w.toJson().containsKey('weightKg'), isFalse);
  });

  test('copyWith overrides only the given field', () {
    final w = WeighIn(id: 'weigh-1', at: DateTime(2026, 8, 21), weightKg: 62);
    final w2 = w.copyWith(weightKg: 61);
    expect(w2.id, 'weigh-1');
    expect(w2.weightKg, 61);
    expect(w2.at, DateTime(2026, 8, 21));
  });
}
