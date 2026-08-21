import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/spacing.dart';
import '../offline/outbox.dart';

/// A calm, honest sync-state chip shown app-wide (above the nav bar).
///
/// It reflects the REAL Outbox state via [syncStatusProvider] and NEVER fakes a
/// "synced" line:
///  * [SyncStatus.synced]  → renders nothing (an empty box). No "all good"
///    reassurance is shown — silence is the honest signal that there's nothing
///    to say.
///  * [SyncStatus.pending] → a quiet "Syncing…" line (writes are queued).
///  * [SyncStatus.failed]  → a warning "Some changes couldn't sync" line, with a
///    "Try again" affordance that requeues the failed writes.
///
/// Design-system styled (warm surface + hairline, no glow). Deliberately NOT
/// animated (no spinner) so widget-test `pumpAndSettle` always settles.
class SyncStatusBanner extends ConsumerWidget {
  const SyncStatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(syncStatusProvider);
    // Before the first snapshot resolves, and on any error, show nothing —
    // never a fabricated status.
    final snapshot = async.valueOrNull;
    if (snapshot == null) return const SizedBox.shrink();

    switch (snapshot.status) {
      case SyncStatus.synced:
        // Honest silence — nothing queued, nothing failed.
        return const SizedBox.shrink();
      case SyncStatus.pending:
        return _PendingBar(count: snapshot.pendingCount);
      case SyncStatus.failed:
        return _FailedBar(
          count: snapshot.failedCount,
          onRetry: () => ref.read(outboxProvider).retryFailed(),
        );
    }
  }
}

class _PendingBar extends StatelessWidget {
  const _PendingBar({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    return Container(
      key: const Key('sync-status-pending'),
      width: double.infinity,
      color: colors.surfaceWarm,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.gutter,
        vertical: AppSpacing.space2,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_upload_outlined,
              size: 16, color: colors.textSecondary),
          AppSpacing.gapH2,
          Flexible(
            child: Text(
              count == 1
                  ? 'Syncing… 1 change queued'
                  : 'Syncing… $count changes queued',
              style: text.bodySmall?.copyWith(color: colors.textSecondary),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _FailedBar extends StatelessWidget {
  const _FailedBar({required this.count, required this.onRetry});

  final int count;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    return Container(
      key: const Key('sync-status-failed'),
      width: double.infinity,
      color: colors.surfaceWarm,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.gutter,
        vertical: AppSpacing.space2,
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 16, color: colors.primaryStrong),
          AppSpacing.gapH2,
          Expanded(
            child: Text(
              count == 1
                  ? "Some changes couldn't sync (1)"
                  : "Some changes couldn't sync ($count)",
              style: text.bodySmall?.copyWith(color: colors.primaryStrong),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          TextButton(
            key: const Key('sync-status-retry'),
            onPressed: onRetry,
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}
