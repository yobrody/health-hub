import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:posthog_flutter/posthog_flutter.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialise Supabase ONLY when config is actually present (injected via
  // `--dart-define-from-file=env.local.json`). This guard means a build/run
  // without the dart-defines — including a plain `flutter test` — never tries
  // to reach the network; the app then runs in a clearly-degraded LOCAL mode
  // (see `authServiceProvider`, which falls back to a FakeAuthService) rather
  // than crashing. Nothing here fabricates a working auth backend.
  if (Config.supabaseConfigured) {
    await Supabase.initialize(
      url: Config.supabaseUrl,
      // A publishable (client) key — the current API; safe to ship in a build.
      publishableKey: Config.supabasePublishableKey,
    );
  }

  // Initialise PostHog ONLY when a key is compiled in via
  // `--dart-define=POSTHOG_KEY=phc_...`. No key → no init, no events, no error.
  // The key is a client-safe public ingestion key (not a secret).
  const posthogKey = String.fromEnvironment('POSTHOG_KEY');
  if (posthogKey.isNotEmpty) {
    const posthogHost = String.fromEnvironment(
      'POSTHOG_HOST',
      defaultValue: 'https://eu.i.posthog.com',
    );
    final config = PostHogConfig(posthogKey);
    config.host = posthogHost;
    // Session replay is intentionally OFF — it would capture health UI.
    config.sessionReplay = false;
    await Posthog().setup(config);
  }

  // Initialise Sentry ONLY when a DSN is compiled in via
  // `--dart-define=SENTRY_DSN=https://...@sentry.io/...`. No DSN → boot
  // exactly as without this block (no Sentry SDK, no network, no overhead).
  //
  // Privacy rules (health app — load-bearing):
  //  • sendDefaultPii = false: no device IDs, no IP, no user email.
  //  • tracesSampleRate = 0.0: ERRORS ONLY, no performance tracing. Perf tracing
  //    auto-wraps the HTTP client, which could surface request URLs (Supabase
  //    query params) in traces — a health app doesn't want that. Errors are
  //    captured regardless of the trace sample rate.
  //  • Session replay is not enabled (would capture health UI).
  //  • FlutterError.onError and runZonedGuarded catch uncaught errors so they
  //    are reported automatically without callers having to instrument them.
  const sentryDsn = String.fromEnvironment('SENTRY_DSN');
  if (sentryDsn.isNotEmpty) {
    await SentryFlutter.init(
      (options) {
        options.dsn = sentryDsn;
        options.sendDefaultPii = false;
        options.tracesSampleRate = 0.0;
        // Add the release so events are bucketed by version in Sentry.
        options.release = 'health_hub@1.0.0';
        // Only these tags are allowed — no health values, no PII.
        options.environment =
            const String.fromEnvironment('APP_ENV', defaultValue: 'production');
      },
      appRunner: () => runApp(const ProviderScope(child: HealthHubApp())),
    );
  } else {
    runApp(const ProviderScope(child: HealthHubApp()));
  }
}
