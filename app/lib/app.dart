import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'analytics/analytics.dart';
import 'app_providers.dart';
import 'auth/auth_screen.dart';
import 'auth/auth_service.dart';
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
///
/// On a transition INTO a signed-in user, the gate hydrates the local stores
/// from Supabase ONCE per user id (see [_hydrateOnSignIn]), so a returning user
/// / fresh device sees their own data. Hydration is fire-and-forget and best
/// effort: a failed pull leaves local cache intact (the hydrator never wipes).
class _AuthGate extends ConsumerStatefulWidget {
  const _AuthGate();

  @override
  ConsumerState<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends ConsumerState<_AuthGate> {
  /// The user id we've already hydrated for, so a token refresh (which re-emits
  /// the same user) doesn't re-pull, and a sign-out→sign-in as a DIFFERENT user
  /// does. Null until the first sign-in.
  String? _hydratedUserId;

  void _hydrateOnSignIn(AuthUser? user) {
    if (user == null) {
      // Signed out — reset so the next sign-in (even the same user) re-hydrates.
      _hydratedUserId = null;
      // Reset analytics distinct-id on sign-out (fire-and-forget).
      ref.read(analyticsProvider).reset();
      return;
    }
    if (user.id == _hydratedUserId) return; // already hydrated this user.
    _hydratedUserId = user.id;

    // Analytics: identify + fire signed_in (fire-and-forget, never block UI).
    // We send ONLY the stable Supabase user-id — never email or any health value.
    final analytics = ref.read(analyticsProvider);
    analytics.identify(user.id);
    analytics.capture(kEvtSignedIn);

    final hydrator = ref.read(supabaseHydratorProvider);
    // Null when Supabase isn't configured (degraded local mode) — nothing to
    // pull. Fire-and-forget; the app reads local regardless of the outcome.
    // Once the pull lands, invalidate the reactive grocery list so the Cart page
    // + nav badge re-render from THIS user's pulled list (the hydrator wrote it
    // into the local store; the provider still holds the pre-pull snapshot).
    // A failed pull leaves local intact, so a refresh then is harmless.
    hydrator?.hydrate(user.id).whenComplete(() {
      if (!mounted) return;
      ref.invalidate(groceryListProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    // React to auth-state transitions to trigger one-shot hydration on sign-in.
    ref.listen<AsyncValue<AuthUser?>>(authStateProvider, (prev, next) {
      next.whenData(_hydrateOnSignIn);
    });

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
        // Also drive hydration from the FIRST resolved value: `ref.listen` only
        // fires on subsequent CHANGES, so a session restored before this widget
        // mounted (the returning-user case) would otherwise never hydrate. The
        // call is idempotent (guarded by `_hydratedUserId`), so triggering it
        // here and from the listener is safe.
        _hydrateOnSignIn(user);
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
