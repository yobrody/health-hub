import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../auth/auth_service.dart';
import '../core/secrets.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../health/health_service.dart';
import '../health/health_types.dart';
import '../onboarding/onboarding_flow.dart';
import '../profile/profile_repo.dart';
import 'goal_reset_controller.dart';
import 'quiet_hours.dart';
import 'theme_mode_controller.dart';

/// The Settings hub — a scaffold of 8 sections, wired where cheap and stubbed
/// (with a "coming soon" subtitle) for later phases.
///
/// Real sections (callable without a device):
///   • Health key — enter + save the `X-Health-Key` via [Secrets].
///   • Goal reset — nulls `goalDirection`/`targetWeightKg` via [ProfileRepo].
///   • Health connections — calls [HealthService.requestPermissions()] (no-ops
///     without a real HealthKit / Health Connect device; safe to tap in tests).
///
/// Placeholder sections (tappable, show a "coming soon" snackbar):
///   • Budget, Units, Gyms, Notifications, Privacy.
///
/// [repo], [secrets], and [healthService] are optional overrides so tests can
/// inject fakes without a ProviderScope. In the running app [repo]/[secrets]
/// come from the composition root ([profileRepoProvider] / [secretsProvider]),
/// so the real [ApiClient] + shared [Outbox] are used.
class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({
    super.key,
    this.repo,
    this.secrets,
    this.healthService,
    this.authService,
  });

  final ProfileRepo? repo;
  final Secrets? secrets;
  final HealthService? healthService;
  final AuthService? authService;

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  // Overrides win; otherwise read the shared composition-root providers.
  late final ProfileRepo _repo;
  late final Secrets _secrets;
  late final HealthService _healthService;
  late final AuthService _authService;
  late final GoalResetController _goalReset;

  @override
  void initState() {
    super.initState();
    _repo = widget.repo ?? ref.read(profileRepoProvider);
    _secrets = widget.secrets ?? ref.read(secretsProvider);
    _healthService = widget.healthService ?? _NoopHealthService();
    _authService = widget.authService ?? ref.read(authServiceProvider);
    _goalReset = GoalResetController(repo: _repo);
  }

  // ── State ────────────────────────────────────────────────────────────────────

  bool _goalResetting = false;
  bool _requestingPermissions = false;
  bool _signingOut = false;
  bool _deletingAccount = false;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  void _showComingSoon(String feature) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$feature — coming soon')),
    );
  }

  Future<void> _onHealthConnections() async {
    if (_requestingPermissions) return;
    setState(() => _requestingPermissions = true);
    try {
      await _healthService.requestPermissions();
    } finally {
      if (mounted) setState(() => _requestingPermissions = false);
    }
  }

  Future<void> _onHealthKey() async {
    final controller = TextEditingController();
    // Pre-fill with the stored key (if any).
    final existing = await _secrets.getHealthKey();
    if (!mounted) return;
    controller.text = existing ?? '';

    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Health key'),
        content: TextField(
          key: const Key('settings-health-key-field'),
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'X-Health-Key',
            hintText: 'Paste your key here',
          ),
          obscureText: true,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(null),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (saved != null && saved.isNotEmpty) {
      await _secrets.setHealthKey(saved);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Health key saved')),
        );
      }
    }
  }

  /// Re-open the onboarding flow so the user can revisit / complete their
  /// profile even after a partial first run. Every field stays skippable and a
  /// skipped field remains null — no value is ever fabricated on re-entry.
  Future<void> _openOnboarding() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OnboardingFlow(
          repo: _repo,
          onDone: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }

  /// Sign out. The auth stream then drives the gate back to the auth screen —
  /// this method doesn't navigate. Errors surface honestly as a snackbar.
  Future<void> _onSignOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'You\'ll need to sign in again to sync. Your data stays on this '
          'device.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (_signingOut) return;

    setState(() => _signingOut = true);
    try {
      await _authService.signOut();
    } on AuthFailure catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  /// Permanently delete the account + ALL server data (GDPR erasure + Apple
  /// requirement). On success the auth stream emits null and the gate routes
  /// back to sign-in. Strongly confirmed because it's irreversible.
  Future<void> _onDeleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text(
          'This permanently erases your account and ALL your data — profile, '
          'goals, weigh-ins, food log, workouts, pantry and lists. It cannot be '
          'undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete forever'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (_deletingAccount) return;

    setState(() => _deletingAccount = true);
    try {
      await _authService.deleteAccount();
      // Success → the auth stream drives the gate back to the auth screen.
    } on AuthFailure catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _deletingAccount = false);
    }
  }

  Future<void> _onGoalReset() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset goal?'),
        content: const Text(
          'This will clear your goal direction and target weight. '
          'Your logged data (weight, sleep, steps) is not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Reset'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    if (_goalResetting) return;

    setState(() => _goalResetting = true);
    try {
      await _goalReset.reset();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Goal cleared')),
        );
      }
    } finally {
      if (mounted) setState(() => _goalResetting = false);
    }
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      key: const Key('settings-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: const Text('Settings'),
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: AppSpacing.pagePadding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Data & Connections ─────────────────────────────────────────
            const SectionHeader(title: 'DATA & CONNECTIONS'),
            StatCard(
              child: Column(
                children: [
                  _SettingsTile(
                    tileKey: const Key('settings-health-connections'),
                    icon: Icons.health_and_safety_outlined,
                    title: 'Health connections',
                    subtitle: 'Connect to HealthKit / Health Connect',
                    trailing: _requestingPermissions
                        ? _spinner()
                        : const Icon(Icons.chevron_right),
                    onTap: _onHealthConnections,
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-health-key'),
                    icon: Icons.key_outlined,
                    title: 'Health key',
                    subtitle: 'X-Health-Key for the backend API',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _onHealthKey,
                  ),
                ],
              ),
            ),

            AppSpacing.gapV8,

            // ── Preferences ───────────────────────────────────────────────
            const SectionHeader(title: 'PREFERENCES'),
            StatCard(
              child: Column(
                children: [
                  _SettingsTile(
                    tileKey: const Key('settings-dark-mode'),
                    icon: Icons.dark_mode_outlined,
                    title: 'Dark mode',
                    subtitle: 'The premium Obsidian dark theme',
                    trailing: Switch(
                      value: ref.watch(themeModeProvider) == ThemeMode.dark,
                      onChanged: (on) => ref
                          .read(themeModeProvider.notifier)
                          .set(on ? ThemeMode.dark : ThemeMode.light),
                    ),
                    onTap: () => ref.read(themeModeProvider.notifier).set(
                          ref.read(themeModeProvider) == ThemeMode.dark
                              ? ThemeMode.light
                              : ThemeMode.dark,
                        ),
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-budget'),
                    icon: Icons.wallet_outlined,
                    title: 'Budget',
                    subtitle: 'Monthly food budget — coming soon',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _showComingSoon('Budget'),
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-units'),
                    icon: Icons.straighten_outlined,
                    title: 'Units',
                    subtitle: 'Metric / GBP — coming soon',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _showComingSoon('Units'),
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-gyms'),
                    icon: Icons.fitness_center_outlined,
                    title: 'Gyms',
                    subtitle: 'Manage gyms — coming soon',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _showComingSoon('Gyms'),
                  ),
                ],
              ),
            ),

            AppSpacing.gapV8,

            // ── Profile & Goals ───────────────────────────────────────────
            const SectionHeader(title: 'PROFILE & GOALS'),
            StatCard(
              child: Column(
                children: [
                  _SettingsTile(
                    tileKey: const Key('settings-goal-reset'),
                    icon: Icons.restart_alt_outlined,
                    title: 'Goal reset',
                    subtitle: 'Clear your current goal and target weight',
                    trailing: _goalResetting
                        ? _spinner()
                        : const Icon(Icons.chevron_right),
                    onTap: _onGoalReset,
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-edit-profile'),
                    icon: Icons.person_outline,
                    title: 'Edit profile',
                    subtitle: 'Revisit your height, weight, goal and gym',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _openOnboarding,
                  ),
                ],
              ),
            ),

            AppSpacing.gapV8,

            // ── Notifications & Privacy ────────────────────────────────────
            const SectionHeader(title: 'NOTIFICATIONS & PRIVACY'),
            StatCard(
              child: Column(
                children: [
                  _SettingsTile(
                    tileKey: const Key('settings-notifications'),
                    icon: Icons.notifications_outlined,
                    title: 'Notifications',
                    subtitle:
                        'Quiet hours: ${_defaultQuietHours.startHour}:00 – '
                        '${_defaultQuietHours.endHour}:00 — coming soon',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _showComingSoon('Notifications + quiet hours'),
                  ),
                  _tileDivider(colors),
                  _SettingsTile(
                    tileKey: const Key('settings-privacy'),
                    icon: Icons.lock_outline,
                    title: 'Privacy',
                    subtitle: 'Data retention + export — coming soon',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _showComingSoon('Privacy'),
                  ),
                ],
              ),
            ),

            AppSpacing.gapV8,

            // ── Account ───────────────────────────────────────────────────
            const SectionHeader(title: 'ACCOUNT'),
            StatCard(
              child: _SettingsTile(
                tileKey: const Key('settings-sign-out'),
                icon: Icons.logout_outlined,
                title: 'Sign out',
                subtitle: 'End your session on this device',
                trailing: _signingOut
                    ? _spinner()
                    : const Icon(Icons.chevron_right),
                onTap: _onSignOut,
                destructive: true,
              ),
            ),
            const SizedBox(height: 10),
            StatCard(
              child: _SettingsTile(
                tileKey: const Key('settings-delete-account'),
                icon: Icons.delete_forever_outlined,
                title: 'Delete account',
                subtitle: 'Permanently erase your account and all data',
                trailing: _deletingAccount
                    ? _spinner()
                    : const Icon(Icons.chevron_right),
                onTap: _onDeleteAccount,
                destructive: true,
              ),
            ),

            AppSpacing.gapV8,
          ],
        ),
      ),
    );
  }

  Widget _spinner() => const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );

  Widget _tileDivider(AppColors colors) => Divider(
        height: 1,
        thickness: 1,
        color: colors.hairline,
      );
}

// ── _SettingsTile ─────────────────────────────────────────────────────────────

/// A single settings row — luxury version of [ListTile].
///
/// Uses design-system tokens for icon colour, text styles, and divider colour.
/// The [tileKey] is forwarded to the inner [InkWell] so test finders by Key
/// continue to resolve (same Keys as before; no contract change).
class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.tileKey,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.trailing,
    required this.onTap,
    this.destructive = false,
  });

  final Key tileKey;
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget trailing;
  final VoidCallback onTap;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final iconColor =
        destructive ? Colors.red.shade400 : colors.primaryStrong;
    final titleColor = destructive ? Colors.red.shade600 : colors.textPrimary;

    return InkWell(
      key: tileKey,
      onTap: onTap,
      borderRadius: BorderRadius.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.cardPadding,
          vertical: AppSpacing.space4,
        ),
        child: Row(
          children: [
            Icon(icon, color: iconColor, size: 22),
            AppSpacing.gapH4,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: text.bodyLarge?.copyWith(
                      color: titleColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  AppSpacing.gapV1,
                  Text(
                    subtitle,
                    style: text.bodySmall?.copyWith(
                      color: colors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            AppSpacing.gapH2,
            IconTheme(
              data: IconThemeData(color: colors.textSecondary, size: 20),
              child: trailing,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Default quiet-hours stub (shown in the notifications tile) ────────────────

const _defaultQuietHours = QuietHours(startHour: 22, endHour: 7);

// ── Default deps for the construction path ───────────────────────────────────

/// A [HealthService] whose [requestPermissions] is a no-op — used as the
/// default in the nav shell where no real HealthDataSource is wired. Returns
/// `false` (not granted) honestly rather than fabricating `true`.
class _NoopHealthService extends HealthService {
  _NoopHealthService() : super(source: _NoopHealthDataSource());
}

class _NoopHealthDataSource implements HealthDataSource {
  @override
  Future<bool> requestPermissions() async => false;

  @override
  Future<List<HealthSample>> readSamples({
    required List<HealthMetric> metrics,
    required DateTime start,
    required DateTime end,
  }) async => const [];
}
