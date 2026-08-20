import 'package:flutter/widgets.dart';

/// 4-pt spacing scale + semantic gaps for the Health Hub design system.
///
/// A single base rhythm keeps whitespace generous and consistent. Reach for the
/// numbered steps ([space1]…[space12]) for raw values, or the semantic aliases
/// ([gutter], [sectionGap], …) to express intent. Ready-made [SizedBox] gaps
/// ([gapV2] etc.) save boilerplate in column/row layouts.
class AppSpacing {
  const AppSpacing._();

  // ── Base 4-pt scale ────────────────────────────────────────────────────
  static const double space1 = 4;
  static const double space2 = 8;
  static const double space3 = 12;
  static const double space4 = 16;
  static const double space5 = 20;
  static const double space6 = 24;
  static const double space7 = 28;
  static const double space8 = 32;
  static const double space9 = 36;
  static const double space10 = 40;
  static const double space11 = 44;
  static const double space12 = 48;

  // ── Semantic aliases ─────────────────────────────────────────────────────
  /// Standard screen edge / horizontal page padding.
  static const double gutter = space5; // 20

  /// Inner padding for cards & sheets — luxury = roomy.
  static const double cardPadding = space5; // 20

  /// Vertical gap between distinct sections on a page.
  static const double sectionGap = space8; // 32

  /// Gap between related items in a list/stack.
  static const double itemGap = space3; // 12

  /// Tight gap between a label and its value.
  static const double tightGap = space1; // 4

  // ── Ready-made gaps (vertical) ───────────────────────────────────────────
  static const SizedBox gapV1 = SizedBox(height: space1);
  static const SizedBox gapV2 = SizedBox(height: space2);
  static const SizedBox gapV3 = SizedBox(height: space3);
  static const SizedBox gapV4 = SizedBox(height: space4);
  static const SizedBox gapV5 = SizedBox(height: space5);
  static const SizedBox gapV6 = SizedBox(height: space6);
  static const SizedBox gapV8 = SizedBox(height: space8);

  // ── Ready-made gaps (horizontal) ─────────────────────────────────────────
  static const SizedBox gapH1 = SizedBox(width: space1);
  static const SizedBox gapH2 = SizedBox(width: space2);
  static const SizedBox gapH3 = SizedBox(width: space3);
  static const SizedBox gapH4 = SizedBox(width: space4);
  static const SizedBox gapH6 = SizedBox(width: space6);

  /// Standard page padding — horizontal gutter, comfortable top/bottom.
  static const EdgeInsets pagePadding =
      EdgeInsets.symmetric(horizontal: gutter, vertical: space6);

  /// All-round card inner padding.
  static const EdgeInsets cardInsets = EdgeInsets.all(cardPadding);
}
