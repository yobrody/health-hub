import 'package:flutter/material.dart';

import '../colors.dart';
import '../spacing.dart';

/// A calm section header: a small title in the editorial sans, with an optional
/// quiet [trailing] affordance (a "See all" text button, a chip, an icon).
///
/// Part of the app's shared luxury vocabulary — used above the dashboard cards
/// and reusable by every feature page. One-way dependency: this widget reads
/// design tokens only, never feature code.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    this.trailing,
  });

  /// The section label, e.g. "Weight" / "Nutrition" / "Training".
  final String title;

  /// An optional quiet trailing widget, right-aligned.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.space3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: text.labelMedium?.copyWith(
                color: colors.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}
