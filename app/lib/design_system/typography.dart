import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Typography for the Health Hub luxury design system.
///
/// Two families, each with a job:
///  * **Fraunces** — a warm, high-contrast serif "display" for hero numbers and
///    headers. It gives weights/metrics an *editorial* feel (a soft-serif that
///    reads expensive rather than clinical). Used for display + headline roles.
///  * **Inter** — a clean geometric sans for everything the user reads or taps:
///    titles, body, labels. Neutral, legible, calm.
///
/// The scale is confident at the top (big hero numbers) and comfortable in the
/// middle (generous line-height for body). Loaded via `google_fonts`, so no
/// bundled font assets are needed.
///
/// One-way dependency: this file imports only Flutter + google_fonts, never
/// feature code.
class AppTypography {
  const AppTypography._();

  /// Slightly negative tracking on the big serif sizes reads more refined;
  /// body sits at neutral tracking.
  static const double _displayTracking = -0.5;
  static const double _headlineTracking = -0.25;

  /// Build the full [TextTheme] for a given text colour.
  ///
  /// [primary] paints display/headline/title/most-body; [secondary] paints the
  /// quieter supporting roles (bodySmall, labelSmall) so hierarchy is baked
  /// into the type theme, not left to every call site.
  static TextTheme textTheme({
    required Color primary,
    required Color secondary,
  }) {
    // Fraunces — editorial serif for the hero tier.
    final display = GoogleFonts.frauncesTextTheme();
    // Inter — geometric sans for UI/body.
    final sans = GoogleFonts.interTextTheme();

    return TextTheme(
      // ── Display: hero numbers & big statements ───────────────────────────
      displayLarge: display.displayLarge?.copyWith(
        fontSize: 57,
        height: 1.05,
        fontWeight: FontWeight.w600,
        letterSpacing: _displayTracking,
        color: primary,
      ),
      displayMedium: display.displayMedium?.copyWith(
        fontSize: 45,
        height: 1.08,
        fontWeight: FontWeight.w600,
        letterSpacing: _displayTracking,
        color: primary,
      ),
      displaySmall: display.displaySmall?.copyWith(
        fontSize: 36,
        height: 1.12,
        fontWeight: FontWeight.w600,
        letterSpacing: _headlineTracking,
        color: primary,
      ),
      // ── Headline: section heroes (still serif for warmth) ────────────────
      headlineLarge: display.headlineLarge?.copyWith(
        fontSize: 32,
        height: 1.15,
        fontWeight: FontWeight.w600,
        letterSpacing: _headlineTracking,
        color: primary,
      ),
      headlineMedium: display.headlineMedium?.copyWith(
        fontSize: 28,
        height: 1.2,
        fontWeight: FontWeight.w600,
        letterSpacing: _headlineTracking,
        color: primary,
      ),
      headlineSmall: display.headlineSmall?.copyWith(
        fontSize: 24,
        height: 1.25,
        fontWeight: FontWeight.w600,
        color: primary,
      ),
      // ── Title: card headers, list section titles (sans) ──────────────────
      titleLarge: sans.titleLarge?.copyWith(
        fontSize: 22,
        height: 1.27,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: primary,
      ),
      titleMedium: sans.titleMedium?.copyWith(
        fontSize: 16,
        height: 1.5,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: primary,
      ),
      titleSmall: sans.titleSmall?.copyWith(
        fontSize: 14,
        height: 1.43,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.1,
        color: primary,
      ),
      // ── Body: reading text (sans, generous line-height) ──────────────────
      bodyLarge: sans.bodyLarge?.copyWith(
        fontSize: 16,
        height: 1.55,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.1,
        color: primary,
      ),
      bodyMedium: sans.bodyMedium?.copyWith(
        fontSize: 14,
        height: 1.55,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.15,
        color: primary,
      ),
      bodySmall: sans.bodySmall?.copyWith(
        fontSize: 12,
        height: 1.5,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.2,
        color: secondary,
      ),
      // ── Label: buttons, chips, captions (sans) ───────────────────────────
      labelLarge: sans.labelLarge?.copyWith(
        fontSize: 14,
        height: 1.43,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.3,
        color: primary,
      ),
      labelMedium: sans.labelMedium?.copyWith(
        fontSize: 12,
        height: 1.33,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.4,
        color: primary,
      ),
      labelSmall: sans.labelSmall?.copyWith(
        fontSize: 11,
        height: 1.45,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
        color: secondary,
      ),
    );
  }

  /// The serif display style, handy for one-off hero numbers that want the
  /// editorial treatment without pulling a full [TextTheme] role. Callers pass
  /// the colour so it stays theme-agnostic.
  static TextStyle heroNumber({
    required Color color,
    double fontSize = 64,
  }) {
    return GoogleFonts.fraunces(
      fontSize: fontSize,
      height: 1.0,
      fontWeight: FontWeight.w600,
      letterSpacing: _displayTracking,
      color: color,
    );
  }
}
