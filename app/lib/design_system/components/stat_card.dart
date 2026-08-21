import 'package:flutter/material.dart';

import '../colors.dart';
import '../shape.dart';
import '../spacing.dart';

/// A calm luxury surface card — the base container for every dashboard tile.
///
/// It paints the design system's surface colour, generous rounding and a soft
/// *warm* shadow (light) / hairline + tonal elevation (dark), and gives its
/// child roomy inner padding. If [onTap] is supplied the whole card becomes a
/// gentle tappable surface (depth is one tap away).
///
/// This is deliberately unopinionated about content — a [StatCard] just frames;
/// callers compose hero numbers, rings, rows inside. One-way dependency: reads
/// design tokens only, never feature code.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = AppSpacing.cardInsets,
    this.warm = false,
  });

  /// The card's content.
  final Widget child;

  /// Optional tap handler — makes the whole card an affordance (depth on tap).
  final VoidCallback? onTap;

  /// Inner padding. Defaults to the luxury-roomy card inset.
  final EdgeInsetsGeometry padding;

  /// When true, uses the warmer emphasis surface (the hero-tile variant).
  final bool warm;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final surface = warm ? colors.surfaceWarm : colors.surface;

    final decoration = BoxDecoration(
      color: surface,
      borderRadius: AppShape.card,
      // Dark leans on tonal elevation + a hairline; light on the warm shadow.
      border: isDark ? Border.all(color: colors.hairline) : null,
      boxShadow: AppShape.cardShadow(brightness),
    );

    return DecoratedBox(
      decoration: decoration,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: AppShape.card,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppShape.card,
          splashColor: colors.primary.withValues(alpha: 0.08),
          highlightColor: colors.primary.withValues(alpha: 0.05),
          child: Padding(
            padding: padding,
            child: child,
          ),
        ),
      ),
    );
  }
}
