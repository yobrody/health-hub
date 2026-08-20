import 'package:flutter/material.dart';

/// Semantic colour tokens for the Health Hub luxury design system.
///
/// Two intentional moods:
///  * **Creamsicle** (light) — a soft creamsicle-orange hero on a warm-white
///    canvas. Never bright or loud; warmth comes from the paper-warm neutrals.
///  * **Obsidian** (dark) — deep matte, layered near-blacks with a faint warm
///    undertone. Depth is built from *tonal elevation* (surfaces get subtly
///    lighter as they rise) and soft shadow — never glow. The orange reads
///    desaturated and burnt, used sparingly.
///
/// Exposed as a [ThemeExtension] so any widget can read the full, strongly
/// typed palette via `Theme.of(context).extension<AppColors>()!` — richer than
/// the flat Material [ColorScheme], which only carries the M3 roles.
///
/// This file must never import from feature code (pages/, gym/, nutrition/…):
/// the design system is a one-way dependency the features build on top of.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.canvas,
    required this.surface,
    required this.surfaceWarm,
    required this.primary,
    required this.primaryStrong,
    required this.accent,
    required this.textPrimary,
    required this.textSecondary,
    required this.hairline,
  });

  /// The app background — the "paper" the whole UI sits on.
  final Color canvas;

  /// Default raised surface (cards, sheets, list backgrounds).
  final Color surface;

  /// A warmer surface variant for hero tiles / emphasis regions. In dark this
  /// doubles as the second elevation tier (tonal elevation, not shadow).
  final Color surfaceWarm;

  /// The creamsicle orange. Soft/muted in light, desaturated & matte in dark.
  /// Used sparingly as the hero accent — fills, key actions, active states.
  final Color primary;

  /// A stronger orange for text-on-light / emphasis where [primary] would fail
  /// contrast (labels, small text, outlines). Also the pressed/hover partner.
  final Color primaryStrong;

  /// A muted leaf-green secondary — success, "on track", positive deltas.
  final Color accent;

  /// Primary text — warm charcoal (light) / warm off-white (dark).
  final Color textPrimary;

  /// Secondary/supporting text — warm greys.
  final Color textSecondary;

  /// Hairline dividers & subtle borders. Low-contrast by design.
  final Color hairline;

  /// **Creamsicle** — the light mode palette.
  ///
  /// Seed values per the brand spec. Two deliberate accessibility tweaks so
  /// text-on-canvas / text-on-primary clears WCAG AA:
  ///  * The soft [primary] `#EDA774` is a *fill* colour only — text and icons
  ///    that sit ON the canvas use [primaryStrong] `#D97A45`, and
  ///    on-primary content uses [textPrimary] (warm charcoal), which is what
  ///    the theme wires as `onPrimary` (dark-on-soft-orange reads clean and
  ///    matches the "never loud" brief better than white).
  static const AppColors light = AppColors(
    canvas: Color(0xFFFBF7F1),
    surface: Color(0xFFFFFDFB),
    surfaceWarm: Color(0xFFFFF6EC),
    primary: Color(0xFFEDA774),
    primaryStrong: Color(0xFFD97A45),
    accent: Color(0xFF7C9A6D),
    textPrimary: Color(0xFF2B2622),
    textSecondary: Color(0xFF6B635B),
    hairline: Color(0xFFEDE4D8),
  );

  /// **Obsidian** — the dark mode palette.
  ///
  /// [canvas] → [surface] → [surfaceWarm] climb in luminance to give elevation
  /// through tone, not glow. The burnt [primary] `#C67A4E` is matte; on a dark
  /// surface it clears AA for large text, and [primaryStrong] `#D98A55` is the
  /// on-primary / small-text partner. The warm off-white [textPrimary]
  /// `#F2EBE1` keeps the whole surface from feeling clinical-blue.
  static const AppColors dark = AppColors(
    canvas: Color(0xFF14110E),
    surface: Color(0xFF1C1815),
    surfaceWarm: Color(0xFF241F1B),
    primary: Color(0xFFC67A4E),
    primaryStrong: Color(0xFFD98A55),
    accent: Color(0xFF8AA678),
    textPrimary: Color(0xFFF2EBE1),
    textSecondary: Color(0xFFA89E92),
    hairline: Color(0xFF2E2823),
  );

  @override
  AppColors copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceWarm,
    Color? primary,
    Color? primaryStrong,
    Color? accent,
    Color? textPrimary,
    Color? textSecondary,
    Color? hairline,
  }) {
    return AppColors(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceWarm: surfaceWarm ?? this.surfaceWarm,
      primary: primary ?? this.primary,
      primaryStrong: primaryStrong ?? this.primaryStrong,
      accent: accent ?? this.accent,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      hairline: hairline ?? this.hairline,
    );
  }

  @override
  AppColors lerp(covariant ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceWarm: Color.lerp(surfaceWarm, other.surfaceWarm, t)!,
      primary: Color.lerp(primary, other.primary, t)!,
      primaryStrong: Color.lerp(primaryStrong, other.primaryStrong, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      hairline: Color.lerp(hairline, other.hairline, t)!,
    );
  }
}

/// Convenience accessor: `context.appColors`. Falls back to the light palette
/// if — for any reason — the extension isn't attached (it always is, via the
/// themes in `app_theme.dart`).
extension AppColorsX on BuildContext {
  AppColors get appColors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.light;
}
