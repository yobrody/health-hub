// Unit tests for the QuietHours pure value type (Task 9).
//
// The only thing tested here is the pure `isWithinQuietHours` function —
// no widgets, no platform, no I/O. Cases:
//   • A wrapping range (e.g. 22→7 means 22:00–06:59 is quiet): midnight is
//     inside; mid-morning is outside.
//   • A non-wrapping range (e.g. 0→6): hour 3 is inside, hour 8 is outside.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/settings/quiet_hours.dart';

void main() {
  group('QuietHours — wrapping range (22→7)', () {
    const qh = QuietHours(startHour: 22, endHour: 7);

    test('23:00 is quiet (before midnight)', () {
      expect(isWithinQuietHours(23, qh), isTrue);
    });

    test('0:00 (midnight) is quiet', () {
      expect(isWithinQuietHours(0, qh), isTrue);
    });

    test('6:00 is quiet (still before endHour)', () {
      expect(isWithinQuietHours(6, qh), isTrue);
    });

    test('7:00 is NOT quiet (endHour is exclusive)', () {
      expect(isWithinQuietHours(7, qh), isFalse);
    });

    test('8:00 is NOT quiet', () {
      expect(isWithinQuietHours(8, qh), isFalse);
    });

    test('21:00 is NOT quiet (one hour before start)', () {
      expect(isWithinQuietHours(21, qh), isFalse);
    });

    test('22:00 is quiet (at startHour)', () {
      expect(isWithinQuietHours(22, qh), isTrue);
    });
  });

  group('QuietHours — non-wrapping range (0→6)', () {
    const qh = QuietHours(startHour: 0, endHour: 6);

    test('0:00 is quiet', () {
      expect(isWithinQuietHours(0, qh), isTrue);
    });

    test('3:00 is quiet', () {
      expect(isWithinQuietHours(3, qh), isTrue);
    });

    test('5:00 is quiet', () {
      expect(isWithinQuietHours(5, qh), isTrue);
    });

    test('6:00 is NOT quiet (endHour is exclusive)', () {
      expect(isWithinQuietHours(6, qh), isFalse);
    });

    test('8:00 is NOT quiet', () {
      expect(isWithinQuietHours(8, qh), isFalse);
    });

    test('23:00 is NOT quiet', () {
      expect(isWithinQuietHours(23, qh), isFalse);
    });
  });
}
