import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/profile/profile_model.dart';

void main() {
  group('formatKg', () {
    test('whole numbers drop the decimal', () {
      expect(formatKg(62), '62');
      expect(formatKg(62.0), '62');
      expect(formatKg(0), '0');
    });

    test('one-decimal weights render cleanly', () {
      expect(formatKg(62.5), '62.5');
      expect(formatKg(61.4), '61.4');
      expect(formatKg(2.5), '2.5');
    });

    test('floating-point subtraction noise is rounded away', () {
      // 62.3 - 61.0 in IEEE-754 is 1.2999999999999972 — the delta shown as
      // "kg since first" on the Weight screen. It must read as 1.3, not a
      // 16-digit float (a real bug caught by the visual golden review).
      expect(formatKg(62.3 - 61.0), '1.3');
      expect(formatKg(0.1 + 0.2), '0.3');
    });

    test('sub-0.1 precision (micro-plates) is preserved to 2dp', () {
      expect(formatKg(1.25), '1.25');
      expect(formatKg(2.75), '2.75');
    });
  });
}
