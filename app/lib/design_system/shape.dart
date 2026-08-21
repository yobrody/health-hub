import 'package:flutter/material.dart';

/// Corner radii + soft warm shadows for the Health Hub design system.
///
/// Radii are generous and consistent (rounded, calm — never sharp). Shadows are
/// low-opacity and *warm* (a brown/amber tint, not neutral grey), so raised
/// surfaces feel like paper lifting off warm paper.
///
/// **Dark mode note:** in Obsidian we lean on tonal elevation (surfaces get
/// subtly lighter as they rise — see [AppColors.surface] → [surfaceWarm]) and a
/// very soft shadow. We deliberately avoid glow/coloured light bleed; depth is
/// tonal + shadow, never a lit edge.
class AppShape {
  const AppShape._();

  // ── Corner radii ─────────────────────────────────────────────────────────
  static const double radiusCard = 20;
  static const double radiusSheet = 24;
  static const double radiusButton = 14;
  static const double radiusField = 14;
  static const double radiusChip = 999; // pill / full

  static const BorderRadius card = BorderRadius.all(Radius.circular(radiusCard));
  static const BorderRadius sheet =
      BorderRadius.all(Radius.circular(radiusSheet));
  static const BorderRadius button =
      BorderRadius.all(Radius.circular(radiusButton));
  static const BorderRadius field =
      BorderRadius.all(Radius.circular(radiusField));
  static const BorderRadius chip =
      BorderRadius.all(Radius.circular(radiusChip));

  static const RoundedRectangleBorder cardBorder =
      RoundedRectangleBorder(borderRadius: card);
  static const RoundedRectangleBorder buttonBorder =
      RoundedRectangleBorder(borderRadius: button);
  static const RoundedRectangleBorder sheetBorder = RoundedRectangleBorder(
    borderRadius: BorderRadius.only(
      topLeft: Radius.circular(radiusSheet),
      topRight: Radius.circular(radiusSheet),
    ),
  );
  static const StadiumBorder chipBorder = StadiumBorder();

  // ── Warm shadows (light mode) ────────────────────────────────────────────
  /// A warm charcoal base for shadows — tinted, not neutral grey, so the whole
  /// UI stays in the warm family even in its shadows.
  static const Color _warmShadow = Color(0xFF3A2E24);

  /// Resting card elevation — soft, close, low-opacity.
  static const List<BoxShadow> cardShadowLight = [
    BoxShadow(
      color: Color(0x0F3A2E24), // ~6% warm charcoal
      blurRadius: 16,
      offset: Offset(0, 6),
      spreadRadius: -4,
    ),
    BoxShadow(
      color: Color(0x0A3A2E24), // ~4% — a second, tighter layer for realism
      blurRadius: 4,
      offset: Offset(0, 1),
    ),
  ];

  /// Raised / pressed-out elevation (sheets, menus).
  static const List<BoxShadow> raisedShadowLight = [
    BoxShadow(
      color: Color(0x1A3A2E24), // ~10%
      blurRadius: 28,
      offset: Offset(0, 12),
      spreadRadius: -6,
    ),
    BoxShadow(
      color: Color(0x0D3A2E24),
      blurRadius: 6,
      offset: Offset(0, 2),
    ),
  ];

  // ── Dark shadows (Obsidian) ──────────────────────────────────────────────
  /// In dark, shadow is near-black and *very* soft — it grounds a surface
  /// without a lit halo. Elevation reads mostly from the lighter surface tone.
  static const List<BoxShadow> cardShadowDark = [
    BoxShadow(
      color: Color(0x59000000), // 35% pure black — deep but diffuse
      blurRadius: 20,
      offset: Offset(0, 8),
      spreadRadius: -8,
    ),
  ];

  static const List<BoxShadow> raisedShadowDark = [
    BoxShadow(
      color: Color(0x73000000), // 45%
      blurRadius: 32,
      offset: Offset(0, 14),
      spreadRadius: -10,
    ),
  ];

  /// Pick the resting card shadow for the current brightness.
  static List<BoxShadow> cardShadow(Brightness brightness) =>
      brightness == Brightness.dark ? cardShadowDark : cardShadowLight;

  /// Pick the raised shadow for the current brightness.
  static List<BoxShadow> raisedShadow(Brightness brightness) =>
      brightness == Brightness.dark ? raisedShadowDark : raisedShadowLight;

  /// The base warm-shadow colour, exposed for one-off custom shadows.
  static Color get warmShadowColor => _warmShadow;
}
