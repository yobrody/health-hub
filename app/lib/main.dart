import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:posthog_flutter/posthog_flutter.dart';
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

  runApp(const ProviderScope(child: HealthHubApp()));
}
