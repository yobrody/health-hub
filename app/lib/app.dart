import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
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
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const _FirstRunGate(),
    );
  }
}

/// Decides the first screen: onboarding on a fresh install (no profile ever
/// saved), else the main app. Driven by [hasProfileProvider] so tests — and the
/// existing nav test — can override it to resolve deterministically instead of
/// hitting a real store.
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
