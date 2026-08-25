// Unit tests for the error-reporting seam.
//
// Verifies:
//  1. NoopErrorReporter is a genuine no-op (no throw, no side-effect).
//  2. FakeErrorReporter records exceptions correctly for use in widget tests.
//  3. The seam is stable: captureException accepts any Object + optional stack.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/monitoring/error_reporter.dart';

import 'fake_error_reporter.dart';

void main() {
  group('NoopErrorReporter', () {
    final noop = const NoopErrorReporter();

    test('captureException does not throw', () async {
      await expectLater(
        noop.captureException(Exception('boom')),
        completes,
      );
    });

    test('captureException with stack does not throw', () async {
      final stack = StackTrace.current;
      await expectLater(
        noop.captureException(Exception('boom'), stack: stack),
        completes,
      );
    });

    test('captureException with arbitrary object does not throw', () async {
      await expectLater(
        noop.captureException('a plain string error'),
        completes,
      );
    });
  });

  group('FakeErrorReporter', () {
    test('records a captured exception', () async {
      final fake = FakeErrorReporter();
      final err = Exception('test error');
      await fake.captureException(err);
      expect(fake.captured, hasLength(1));
      expect(fake.captured.first.error, err);
      expect(fake.captured.first.stack, isNull);
    });

    test('records the stack trace when provided', () async {
      final fake = FakeErrorReporter();
      final err = Exception('with stack');
      final stack = StackTrace.current;
      await fake.captureException(err, stack: stack);
      expect(fake.captured.first.stack, same(stack));
    });

    test('records multiple exceptions in order', () async {
      final fake = FakeErrorReporter();
      final e1 = Exception('first');
      final e2 = StateError('second');
      await fake.captureException(e1);
      await fake.captureException(e2);
      expect(fake.captured, hasLength(2));
      expect(fake.captured[0].error, e1);
      expect(fake.captured[1].error, e2);
    });

    test('isEmpty when nothing captured', () {
      final fake = FakeErrorReporter();
      expect(fake.captured, isEmpty);
    });
  });
}
