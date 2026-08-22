import 'package:flutter/material.dart';

import '../../brain/insight.dart';
import '../colors.dart';
import '../motion.dart';
import '../shape.dart';
import '../spacing.dart';
import 'stat_card.dart';

/// The Brain's shared "connected card" — the one component every screen uses to
/// surface an [Insight] honestly.
///
/// A calm, premium card with:
///  • a kind chip (Eat / Buy / Train / Set up) so the card's role is legible;
///  • the title + a short detail (both real, from the engine);
///  • an expandable **`↳ why`** row that lists the [Insight.why] facts — the
///    visible trace back to the real data the insight came from;
///  • the action button (add-to-cart / start-workout / log-meal / open-goals),
///    which the parent screen wires to the real flow via [onAction].
///
/// Design tokens only (never feature colours), reduced-motion-aware, and
/// test-friendly: the expand uses a finite [AnimatedSize] (no perpetual
/// animation), so `pumpAndSettle` always completes. Keys:
///  • the card → `Key('insight-card-<id>')`
///  • the action button → `Key('insight-action-<id>')`
///  • the why toggle → `Key('insight-why-<id>')`
class InsightCard extends StatefulWidget {
  const InsightCard({
    super.key,
    required this.insight,
    this.onAction,
  });

  final Insight insight;

  /// Invoked when the action button is tapped. The parent screen routes it to
  /// the real flow (add to the grocery list + jump to Cart, start a workout,
  /// etc.). When null, the action button still renders but is inert (isolated
  /// tests). A [InsightActionKind.none] action shows no button.
  final void Function(InsightAction action)? onAction;

  @override
  State<InsightCard> createState() => _InsightCardState();
}

class _InsightCardState extends State<InsightCard> {
  bool _whyExpanded = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final insight = widget.insight;
    final action = insight.action;
    final hasAction = action != null && action.kind != InsightActionKind.none;
    final hasWhy = insight.why.isNotEmpty;

    return StatCard(
      key: Key('insight-card-${insight.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _KindChip(kind: insight.kind, colors: colors, text: text),
            ],
          ),
          AppSpacing.gapV3,
          Text(
            insight.title,
            style: text.titleMedium?.copyWith(color: colors.textPrimary),
          ),
          AppSpacing.gapV1,
          Text(
            insight.detail,
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),

          // ── Expandable "why" ────────────────────────────────────────────────
          if (hasWhy) ...[
            AppSpacing.gapV3,
            InkWell(
              key: Key('insight-why-${insight.id}'),
              onTap: () => setState(() => _whyExpanded = !_whyExpanded),
              borderRadius: AppShape.chip,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.space1),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '↳ why',
                      style: text.labelMedium
                          ?.copyWith(color: colors.primaryStrong),
                    ),
                    AppSpacing.gapH1,
                    Icon(
                      _whyExpanded ? Icons.expand_less : Icons.expand_more,
                      size: 16,
                      color: colors.primaryStrong,
                    ),
                  ],
                ),
              ),
            ),
            // Finite AnimatedSize — settles, so pumpAndSettle completes.
            AnimatedSize(
              duration: MediaQuery.of(context).disableAnimations
                  ? Duration.zero
                  : AppMotion.fast,
              curve: AppMotion.standard,
              alignment: Alignment.topCenter,
              child: _whyExpanded
                  ? Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.space2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final fact in insight.why)
                            Padding(
                              padding: const EdgeInsets.only(
                                  bottom: AppSpacing.space1),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      fact.label,
                                      style: text.bodySmall?.copyWith(
                                          color: colors.textSecondary),
                                    ),
                                  ),
                                  Text(
                                    fact.value,
                                    style: text.bodySmall?.copyWith(
                                      color: colors.textPrimary,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ],

          // ── Action ──────────────────────────────────────────────────────────
          if (hasAction) ...[
            AppSpacing.gapV4,
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                key: Key('insight-action-${insight.id}'),
                onPressed: widget.onAction == null
                    ? null
                    : () => widget.onAction!(action),
                style: FilledButton.styleFrom(
                  backgroundColor: colors.primary,
                  foregroundColor: colors.textPrimary,
                  shape: AppShape.buttonBorder,
                  padding:
                      const EdgeInsets.symmetric(vertical: AppSpacing.space3),
                  textStyle: text.labelLarge,
                ),
                child: Text(action.label),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Kind chip ─────────────────────────────────────────────────────────────────

/// A small pill labelling the insight's kind, in the design-system palette.
class _KindChip extends StatelessWidget {
  const _KindChip({
    required this.kind,
    required this.colors,
    required this.text,
  });

  final InsightKind kind;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    final (String label, IconData icon) = switch (kind) {
      InsightKind.eat => ('Eat', Icons.restaurant_menu),
      InsightKind.buy => ('Buy', Icons.shopping_basket_outlined),
      InsightKind.train => ('Train', Icons.fitness_center),
      InsightKind.setup => ('Set up', Icons.tips_and_updates_outlined),
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.space3,
        vertical: AppSpacing.space1,
      ),
      decoration: BoxDecoration(
        color: colors.primary.withValues(alpha: 0.14),
        borderRadius: AppShape.chip,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: colors.primaryStrong),
          AppSpacing.gapH1,
          Text(
            label.toUpperCase(),
            style: text.labelSmall?.copyWith(
              color: colors.primaryStrong,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}
