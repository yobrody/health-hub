import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../design_system/components/insight_card.dart';
import '../design_system/components/section_header.dart';
import '../design_system/spacing.dart';
import 'brain_providers.dart';
import 'insight.dart';

/// A ready-made "insights" section for a screen — the shared weaving widget.
///
/// It watches [insightsForScreen] for the given [screen] and renders each real
/// [Insight] as an [InsightCard]. When there are NO insights for the screen it
/// renders nothing (`SizedBox.shrink`) — the honest "show nothing we can't
/// ground" rule; the caller can therefore drop the whole section without a
/// special case.
///
/// Actions are dispatched to [onAction], which each screen wires to the real
/// flow (add to the grocery list + jump to Cart, start a workout, etc.). The
/// section itself performs no navigation — that's the screen's job, so the
/// cross-screen flow stays explicit and testable.
class BrainSection extends ConsumerWidget {
  const BrainSection({
    super.key,
    required this.screen,
    required this.title,
    required this.onAction,
    this.sectionKey,
    this.trailingGap = false,
  });

  /// Which screen's slice to show (drives the kind filter).
  final BrainScreen screen;

  /// The section header label, e.g. "FOR YOU", "WHAT TO EAT".
  final String title;

  /// The real action dispatcher for this screen.
  final void Function(InsightAction action) onAction;

  /// Optional key placed on the outer section [Column] (e.g. `home-brain`) so
  /// tests can assert the whole section is present / absent.
  final Key? sectionKey;

  /// When true, appends a section-sized gap AFTER the cards — but ONLY when the
  /// section actually renders. When there are no insights the whole widget
  /// (including this gap) collapses to nothing, so the caller never leaves a
  /// stray gap for an omitted section.
  final bool trailingGap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final insights = insightsForScreen(ref, screen);
    if (insights.isEmpty) return const SizedBox.shrink();

    return Column(
      key: sectionKey,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: title),
        for (var i = 0; i < insights.length; i++) ...[
          if (i > 0) AppSpacing.gapV3,
          InsightCard(insight: insights[i], onAction: onAction),
        ],
        if (trailingGap) AppSpacing.gapV8,
      ],
    );
  }
}
