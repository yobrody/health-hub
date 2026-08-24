// Shared fake analytics implementation for widget tests.

import 'package:health_hub/analytics/analytics.dart';

/// Records every [capture] call so tests can assert which events fired with
/// which props. Never touches PostHog or the network.
class FakeAnalytics implements Analytics {
  final List<({String event, Map<String, Object>? props})> events = [];

  @override
  Future<void> capture(String event, {Map<String, Object>? props}) async {
    events.add((event: event, props: props));
  }

  @override
  Future<void> identify(String userId) async {
    // Not asserted in most tests; override if needed.
  }

  @override
  Future<void> reset() async {}

  /// All event names recorded so far.
  List<String> get eventNames => events.map((e) => e.event).toList();

  /// The most-recent props for [eventName], or null when the event wasn't fired.
  Map<String, Object>? propsFor(String eventName) {
    final matches = events.where((e) => e.event == eventName).toList();
    return matches.isEmpty ? null : matches.last.props;
  }
}
