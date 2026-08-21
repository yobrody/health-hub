import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
import 'auth/auth_screen.dart';
import 'design_system/app_theme.dart';
import 'nav/root_scaffold.dart';
import 'onboarding/onboarding_flow.dart';

/// Root application widget.
class HealthHubApp extends ConsumerWidget {
  const HealthHubApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Start the outbox-flush driver once, at app root. It listens for
    // connectivity and replays queued mutations when the network returns.
    ref.watch(syncServiceProvider).start();

    return MaterialApp(
      title: 'Health Hub',
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: ThemeMode.system,
      home: const _AuthGate(),
    );
  }
}

/// The auth + first-run gate. Precedence:
///   1. **Not authenticated** → [AuthScreen] (the first screen a new user sees).
///   2. **Authenticated, no profile** → onboarding (existing [hasProfileProvider]
///      logic drives the profile step).
///   3. **Authenticated, has profile** → the app ([RootScaffold]).
///
/// Driven by [authStateProvider] + [hasProfileProvider] so tests can override
/// both and resolve deterministically. Loading states use a non-animating
/// placeholder so widget-test `pumpAndSettle` settles.
class _AuthGate extends ConsumerWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      // While the session is restored, show a non-animating placeholder (an
      // animated spinner would keep pumpAndSettle from ever settling).
      loading: () => const Scaffold(
        key: Key('auth-loading'),
        body: SizedBox.shrink(),
      ),
      // If the auth stream errors, fail SAFE to the auth screen — never fail
      // open into the app with no session.
      error: (_, _) => AuthScreen(service: ref.read(authServiceProvider)),
      data: (user) {
        if (user == null) {
          // Not authenticated → the auth screen.
          return AuthScreen(service: ref.read(authServiceProvider));
        }
        // Authenticated → decide onboarding vs the app on profile presence.
        return const _FirstRunGate();
      },
    );
  }
}

/// Decides, for an AUTHENTICATED user, whether to show onboarding (no profile
/// saved yet) or the main app. Driven by [hasProfileProvider] so tests — and
/// the existing nav test — can override it to resolve deterministically instead
/// of hitting a real store.
class _FirstRunGate extends ConsumerWidget {
  const _FirstRunGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasProfile = ref.watch(hasProfileProvider);
    return hasProfile.when(
      // While the (fast, local) check resolves, show a non-animating placeholder
      // — an animated spinner would keep widget-test `pumpAndSettle` from ever
      // settling.
      loading: () => const Scaffold(
        key: Key('first-run-loading'),
        body: SizedBox.shrink(),
      ),
      // On the (unlikely) chance the store read throws, fail open to the app
      // rather than trapping the user on a blank screen.
      error: (_, _) => const RootScaffold(),
      data: (has) {
        if (has) return const RootScaffold();
        return OnboardingFlow(
          repo: ref.read(profileRepoProvider),
          // After onboarding finishes, invalidate the gate so it re-reads
          // hasProfile() (now true) and swaps in the main app.
          onDone: () => ref.invalidate(hasProfileProvider),
        );
      },
    );
  }
}
