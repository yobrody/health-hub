import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../onboarding/onboarding_flow.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';

/// Today's overview.
///
/// This page carries the **honest empty-state demonstration** for Task 8: any
/// profile value the user has not yet provided renders as `—` (via
/// [showOrDash]) — NEVER a fabricated 80 kg / 72 kg — with a gentle "set this
/// up" affordance that opens onboarding. Later phases fill in the real
/// day-summary content; the pattern established here is what they must follow.
///
/// The [ProfileRepo] comes from [profileRepoProvider] (the composition root),
/// which is wired to the REAL [ApiClient] + shared [Outbox]. [repo] is an
/// optional override so tests can inject a fake without a ProviderScope.
class TodayPage extends ConsumerStatefulWidget {
  const TodayPage({super.key, this.repo});

  final ProfileRepo? repo;

  @override
  ConsumerState<TodayPage> createState() => _TodayPageState();
}

class _TodayPageState extends ConsumerState<TodayPage> {
  late final ProfileRepo _repo = widget.repo ?? ref.read(profileRepoProvider);

  Profile _profile = const Profile();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final p = await _repo.load();
    if (!mounted) return;
    setState(() {
      _profile = p;
      _loading = false;
    });
  }

  /// Render `value unit` when the value is real, else a bare `—` (no dangling
  /// unit on a missing value — an honest empty state shows just the dash).
  static String _withUnit(Object? value, String unit) =>
      value == null ? '—' : '${showOrDash(value)} $unit';

  Future<void> _openOnboarding() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OnboardingFlow(
          repo: _repo,
          onDone: () => Navigator.of(context).pop(),
        ),
      ),
    );
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      // A non-animating placeholder (not a spinner): the profile load resolves
      // almost immediately, and an animated indicator would keep widget-test
      // `pumpAndSettle` from ever settling.
      return const Scaffold(
        key: Key('today-page'),
        body: SizedBox.shrink(),
      );
    }

    return Scaffold(
      key: const Key('today-page'),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Today', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            _StatRow(
              label: 'Current weight',
              value: _withUnit(_profile.weightKg, 'kg'),
            ),
            _StatRow(
              label: 'Goal weight',
              value: _withUnit(_profile.targetWeightKg, 'kg'),
            ),
            _StatRow(
              label: 'Goal',
              value: showOrDash(_profile.goalDirection),
            ),
            _StatRow(
              label: 'Primary gym',
              value: showOrDash(_profile.primaryGym),
            ),
            const SizedBox(height: 24),
            if (_profile.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Finish setting up your profile',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'We show “—” for anything you haven\'t entered — never a '
                        'guessed number. Add your details to see real targets.',
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        key: const Key('today-setup-profile'),
                        onPressed: _openOnboarding,
                        child: const Text('Set up profile'),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A single label/value row. When [value] is `—` it is rendered in a muted
/// tone so an honest empty state reads as "not set", not as data.
class _StatRow extends StatelessWidget {
  const _StatRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final isDash = value == '—';
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: theme.textTheme.bodyLarge),
          Text(
            value,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: isDash ? theme.disabledColor : null,
              fontWeight: isDash ? FontWeight.normal : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
