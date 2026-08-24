import 'package:flutter/material.dart';

import '../analytics/analytics.dart';
import '../design_system/colors.dart';
import '../design_system/spacing.dart';
import '../metrics/weigh_in.dart';
import '../metrics/weigh_in_repo.dart';

/// A quick "log weight" sheet — one number, one tap.
///
/// **Honesty:** a blank/unparseable field logs nothing (the Save button stays
/// disabled), so a weigh-in never carries a fabricated `0`. Every logged reading
/// is anchored to now via [WeighIn.now].
///
/// Returns `true` via [showLogWeightSheet] when a weigh-in was logged (so the
/// caller can refresh its trend), else `false`/`null`.
class LogWeightSheet extends StatefulWidget {
  const LogWeightSheet({
    super.key,
    required this.repo,
    this.analytics = const NoopAnalytics(),
  });

  final WeighInRepo repo;

  /// Analytics seam — [NoopAnalytics] by default so tests are unaffected.
  final Analytics analytics;

  @override
  State<LogWeightSheet> createState() => _LogWeightSheetState();
}

class _LogWeightSheetState extends State<LogWeightSheet> {
  final _ctrl = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  /// The parsed weight, or `null` when the field is blank/non-numeric.
  double? get _weight {
    final t = _ctrl.text.trim();
    if (t.isEmpty) return null;
    return double.tryParse(t);
  }

  Future<void> _save() async {
    final w = _weight;
    if (w == null) return; // never log a fabricated weight.
    setState(() => _saving = true);
    await widget.repo.add(WeighIn.now(weightKg: w));
    // Analytics: event name only — the weight value is never sent.
    widget.analytics.capture(kEvtWeighInLogged);
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final canSave = !_saving && _weight != null;

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.gutter,
        right: AppSpacing.gutter,
        top: AppSpacing.space5,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.space6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Log weight', style: text.titleLarge),
          AppSpacing.gapV1,
          Text(
            'Two or more readings unlock your real trend.',
            style: text.bodySmall?.copyWith(color: colors.textSecondary),
          ),
          AppSpacing.gapV5,
          TextField(
            key: const Key('log-weight-field'),
            controller: _ctrl,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Weight',
              suffixText: 'kg',
              border: OutlineInputBorder(),
            ),
          ),
          AppSpacing.gapV6,
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed:
                      _saving ? null : () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
              ),
              AppSpacing.gapH3,
              Expanded(
                child: FilledButton(
                  key: const Key('log-weight-save'),
                  onPressed: canSave ? _save : null,
                  child: const Text('Log'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Present [LogWeightSheet] as a modal bottom sheet. Resolves to `true` when a
/// weigh-in was logged (so the caller can refresh), else `false`/`null`.
///
/// Pass [analytics] from [analyticsProvider] to instrument the weigh_in_logged
/// event; omit it (defaults to [NoopAnalytics]) in tests.
Future<bool?> showLogWeightSheet(
  BuildContext context, {
  required WeighInRepo repo,
  Analytics analytics = const NoopAnalytics(),
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => LogWeightSheet(repo: repo, analytics: analytics),
  );
}
