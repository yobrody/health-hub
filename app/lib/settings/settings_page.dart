import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../core/secrets.dart';
import '../health/health_service.dart';
import '../health/health_types.dart';
import '../onboarding/onboarding_flow.dart';
import '../profile/profile_repo.dart';
import 'goal_reset_controller.dart';
import 'quiet_hours.dart';

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
  });

  final ProfileRepo? repo;
  final Secrets? secrets;
  final HealthService? healthService;

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  // Overrides win; otherwise read the shared composition-root providers.
  late final ProfileRepo _repo;
  late final Secrets _secrets;
  late final HealthService _healthService;
  late final GoalResetController _goalReset;

  @override
  void initState() {
    super.initState();
    _repo = widget.repo ?? ref.read(profileRepoProvider);
    _secrets = widget.secrets ?? ref.read(secretsProvider);
    _healthService = widget.healthService ?? _NoopHealthService();
    _goalReset = GoalResetController(repo: _repo);
  }

  // ── State ────────────────────────────────────────────────────────────────────

  bool _goalResetting = false;
  bool _requestingPermissions = false;

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
    return Scaffold(
      key: const Key('settings-page'),
      appBar: AppBar(title: const Text('Settings')),
      body: SingleChildScrollView(
        child: Column(
          children: [
          // 1. Health connections — wired to HealthService.requestPermissions()
          ListTile(
            key: const Key('settings-health-connections'),
            leading: const Icon(Icons.health_and_safety),
            title: const Text('Health connections'),
            subtitle: const Text('Connect to HealthKit / Health Connect'),
            trailing: _requestingPermissions
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.chevron_right),
            onTap: _onHealthConnections,
          ),

          // 2. Health key — wired: enters + saves via Secrets
          ListTile(
            key: const Key('settings-health-key'),
            leading: const Icon(Icons.key),
            title: const Text('Health key'),
            subtitle: const Text('X-Health-Key for the backend API'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _onHealthKey,
          ),

          const Divider(),

          // 3. Budget — placeholder
          ListTile(
            key: const Key('settings-budget'),
            leading: const Icon(Icons.wallet),
            title: const Text('Budget'),
            subtitle: const Text('Monthly food budget — coming soon'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showComingSoon('Budget'),
          ),

          // 4. Units — placeholder
          ListTile(
            key: const Key('settings-units'),
            leading: const Icon(Icons.straighten),
            title: const Text('Units'),
            subtitle: const Text('Metric / GBP — coming soon'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showComingSoon('Units'),
          ),

          // 5. Gyms — placeholder
          ListTile(
            key: const Key('settings-gyms'),
            leading: const Icon(Icons.fitness_center),
            title: const Text('Gyms'),
            subtitle: const Text('Manage gyms — coming soon'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showComingSoon('Gyms'),
          ),

          const Divider(),

          // 6. Goal reset — wired: nulls goalDirection + targetWeightKg
          ListTile(
            key: const Key('settings-goal-reset'),
            leading: const Icon(Icons.restart_alt),
            title: const Text('Goal reset'),
            subtitle: const Text('Clear your current goal and target weight'),
            trailing: _goalResetting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.chevron_right),
            onTap: _onGoalReset,
          ),

          // Edit profile — reopens the onboarding flow (re-entry even after a
          // partial first run). Every field stays optional; nothing defaulted.
          ListTile(
            key: const Key('settings-edit-profile'),
            leading: const Icon(Icons.person),
            title: const Text('Edit profile'),
            subtitle: const Text('Revisit your height, weight, goal and gym'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openOnboarding,
          ),

          const Divider(),

          // 7. Notifications — placeholder (quiet-hours model defined in
          //    quiet_hours.dart; the isWithinQuietHours logic is tested)
          ListTile(
            key: const Key('settings-notifications'),
            leading: const Icon(Icons.notifications),
            title: const Text('Notifications'),
            subtitle: Text(
              'Quiet hours: ${_defaultQuietHours.startHour}:00 – '
              '${_defaultQuietHours.endHour}:00 — coming soon',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showComingSoon('Notifications + quiet hours'),
          ),

          // 8. Privacy — placeholder
          ListTile(
            key: const Key('settings-privacy'),
            leading: const Icon(Icons.lock),
            title: const Text('Privacy'),
            subtitle: const Text('Data retention + export — coming soon'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showComingSoon('Privacy'),
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
