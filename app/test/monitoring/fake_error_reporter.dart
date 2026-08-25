// Shared fake error reporter for widget tests.

import 'package:health_hub/monitoring/error_reporter.dart';

/// Records every [captureException] call so tests can assert which errors were
/// reported. Never touches Sentry or the network.
class FakeErrorReporter implements ErrorReporter {
  final List<({Object error, StackTrace? stack})> captured = [];

  @override
  Future<void> captureException(Object error, {StackTrace? stack}) async {
    captured.add((error: error, stack: stack));
  }
}
