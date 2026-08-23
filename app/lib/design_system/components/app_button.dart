import 'package:flutter/material.dart';

import '../colors.dart';
import '../shape.dart';
import '../spacing.dart';

/// Button style helpers that encode the app's **action hierarchy**.
///
/// The rule (see the 2026-08-23 visual review): each screen shows **one**
/// solid-orange *primary* action — the theme's default [FilledButton] — and
/// everything else uses a calmer *secondary* treatment. Stacking multiple
/// solid-orange fills (which happened wherever several [InsightCard]s appeared)
/// reads loud and dilutes the "one clear next step" hierarchy premium apps use.
///
/// [secondaryTonal] is that quieter action: a soft primary-tint fill with
/// [AppColors.primaryStrong] text — same family as the primary, a step down in
/// weight. It also sidesteps the on-orange contrast question entirely (the
/// label sits on a pale tint, not the fill), so it renders identically-legible
/// in both Creamsicle and Obsidian.
class AppButtons {
  const AppButtons._();

  /// A soft, tonal secondary action for in-card / non-hero buttons.
  ///
  /// [onDark] nudges the tint a little stronger on Obsidian so the fill stays
  /// visible against the darker surface.
  static ButtonStyle secondaryTonal(
    AppColors colors,
    TextTheme text, {
    required bool onDark,
  }) {
    final fill = colors.primary.withValues(alpha: onDark ? 0.22 : 0.14);
    return FilledButton.styleFrom(
      backgroundColor: fill,
      foregroundColor: colors.primaryStrong,
      shape: AppShape.buttonBorder,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
      textStyle: text.labelLarge,
      elevation: 0,
    ).copyWith(
      overlayColor: WidgetStatePropertyAll(
        colors.primaryStrong.withValues(alpha: 0.10),
      ),
    );
  }
}
