import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../colors.dart';
import '../motion.dart';
import '../typography.dart';

/// A restrained, animated progress ring — the app's core "how am I doing"
/// glyph, reused by the nutrition macros and anywhere a value-against-a-goal
/// wants a calm circular read.
///
/// **Honesty is built in.** A ring is only ever "filled" against a REAL goal:
///  * [value] and [goal] both non-null with `goal > 0` → the arc fills to
///    `value / goal` (clamped 0..1) and [centerLabel] shows the value.
///  * otherwise (no goal, or nothing logged) → NO arc is drawn; the ring shows
///    a quiet empty track and an em-dash. It never fabricates a 0/100 %.
///
/// The fill animates in gently (a spring-eased grow) — earned delight, not
/// noise. One-way dependency: reads design tokens only, never feature code.
class ProgressRing extends StatelessWidget {
  const ProgressRing({
    super.key,
    required this.value,
    required this.goal,
    required this.label,
    this.centerLabel,
    this.unit,
    this.size = 84,
    this.strokeWidth = 8,
    this.color,
  });

  /// The current amount (e.g. today's protein in grams). `null` = not logged.
  final double? value;

  /// The target amount. `null` (or `<= 0`) = no honest goal to measure against
  /// → the ring shows its empty state, never a fabricated full/empty arc.
  final double? goal;

  /// The macro/metric name shown under the ring (e.g. "Protein").
  final String label;

  /// Optional override for the big center text. When omitted the ring derives
  /// it: the rounded [value] when real, else `'—'`.
  final String? centerLabel;

  /// Optional unit suffix under the center number (e.g. "g", "kcal").
  final String? unit;

  /// Outer diameter of the ring.
  final double size;

  /// Ring thickness.
  final double strokeWidth;

  /// Arc colour. Defaults to the palette primary.
  final Color? color;

  /// Whether there's a real goal to fill against.
  bool get _hasGoal => goal != null && goal! > 0;

  /// The fraction filled, clamped 0..1 — only meaningful when [_hasGoal].
  double get _fraction {
    if (!_hasGoal || value == null) return 0;
    return (value! / goal!).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final arcColor = color ?? colors.primary;

    // The honest center read: the real value, else an em-dash.
    final center = centerLabel ??
        (value != null ? _formatNum(value!) : '—');
    final isDash = center == '—';

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: size,
          height: size,
          child: TweenAnimationBuilder<double>(
            // Animate to the true fraction; the empty state animates to 0 (no
            // arc), which reads as a calm bare track — never a fake fill.
            tween: Tween(begin: 0, end: _fraction),
            duration: AppMotion.slow,
            curve: AppMotion.spring,
            builder: (context, t, _) {
              return CustomPaint(
                painter: _RingPainter(
                  fraction: _hasGoal ? t : 0,
                  arcColor: arcColor,
                  trackColor: colors.hairline,
                  strokeWidth: strokeWidth,
                ),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        center,
                        style: AppTypography.heroNumber(
                          color: isDash ? colors.textSecondary : colors.textPrimary,
                          fontSize: size * 0.30,
                        ),
                      ),
                      if (unit != null && !isDash)
                        Text(
                          unit!,
                          style: text.labelSmall?.copyWith(
                            color: colors.textSecondary,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: text.labelSmall?.copyWith(color: colors.textSecondary),
        ),
      ],
    );
  }

  /// Round to a whole number for display (macros read cleaner without decimals).
  String _formatNum(double v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(0);
}

/// Paints the track + a rounded-cap arc for [fraction] of the circle, starting
/// at 12 o'clock and sweeping clockwise. A [fraction] of 0 draws only the track
/// (the honest empty state).
class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.fraction,
    required this.arcColor,
    required this.trackColor,
    required this.strokeWidth,
  });

  final double fraction;
  final Color arcColor;
  final Color trackColor;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = (size.shortestSide - strokeWidth) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..color = trackColor;
    canvas.drawCircle(center, radius, track);

    if (fraction <= 0) return;

    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = strokeWidth
      ..color = arcColor;

    const start = -math.pi / 2; // 12 o'clock
    final sweep = 2 * math.pi * fraction;
    canvas.drawArc(rect, start, sweep, false, arc);
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.fraction != fraction ||
      old.arcColor != arcColor ||
      old.trackColor != trackColor ||
      old.strokeWidth != strokeWidth;
}
