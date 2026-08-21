import 'package:flutter/animation.dart';

/// Motion tokens — durations + curves for the buttery, restrained feel.
///
/// The rule: fast for micro-feedback (taps, toggles), base for most transitions
/// (page/element enter-exit), slow for large or "look at me" moments. Curves
/// favour gentle deceleration (things arrive softly) with an optional subtle
/// spring for playful emphasis — never bouncy or loud.
class AppMotion {
  const AppMotion._();

  // ── Durations ────────────────────────────────────────────────────────────
  /// Micro-feedback: button press, switch, ripple settle.
  static const Duration fast = Duration(milliseconds: 150);

  /// The default: element/page transitions, expand/collapse.
  static const Duration base = Duration(milliseconds: 250);

  /// Deliberate, large moments: sheets, hero reveals, celebratory beats.
  static const Duration slow = Duration(milliseconds: 400);

  // ── Curves ───────────────────────────────────────────────────────────────
  /// Standard easing — quick to leave, soft to arrive. The workhorse.
  static const Curve standard = Curves.easeOutCubic;

  /// Enter: content arriving on screen (emphasised deceleration).
  static const Curve enter = Curves.easeOutCubic;

  /// Exit: content leaving (accelerate away).
  static const Curve exit = Curves.easeInCubic;

  /// A gentle spring for emphasis (a metric ticking up, a card settling). Has
  /// the faintest overshoot — premium, not cartoonish.
  static const Curve spring = Curves.easeOutBack;

  /// Fully symmetric ease for cross-fades / colour lerps.
  static const Curve smooth = Curves.easeInOut;
}
