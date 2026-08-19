// Config.baseUrl default is intentionally EMPTY.
//
// The retired PWA URL (health-hub-dwz.pages.dev) is NOT the native backend, and
// a wrong default silently mis-targets requests. Empty makes requests honestly
// fail → queue in the Outbox until a real base is supplied via
// `--dart-define=HEALTH_HUB_API_BASE=...`. This is the honest choice.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/core/config.dart';

void main() {
  test('baseUrl defaults to empty (no fabricated / stale endpoint)', () {
    // Run without a --dart-define override → the compiled-in default applies.
    expect(Config.baseUrl, isEmpty);
  });

  test('baseUrl never points at the retired PWA host', () {
    expect(Config.baseUrl, isNot(contains('pages.dev')));
  });
}
