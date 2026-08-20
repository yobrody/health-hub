import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/design_system/colors.dart';

void main() {
  // GoogleFonts tries to fetch fonts over HTTP at runtime; in tests we forbid
  // that so a missing network never fails or hangs the suite (the Fraunces/Inter
  // metrics still resolve; only the glyph download is skipped).
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('lightTheme (Creamsicle)', () {
    final theme = lightTheme;

    test('builds a Material 3 light theme', () {
      expect(theme.useMaterial3, isTrue);
      expect(theme.brightness, Brightness.light);
    });

    test('exposes the AppColors extension with the Creamsicle key colours', () {
      final c = theme.extension<AppColors>();
      expect(c, isNotNull);
      expect(c!.canvas, const Color(0xFFFBF7F1));
      expect(c.primary, const Color(0xFFEDA774));
      expect(c.primaryStrong, const Color(0xFFD97A45));
      expect(c.accent, const Color(0xFF7C9A6D));
      expect(c.textPrimary, const Color(0xFF2B2622));
      expect(c.hairline, const Color(0xFFEDE4D8));
    });

    test('ColorScheme + scaffold are wired to the palette', () {
      expect(theme.colorScheme.primary, const Color(0xFFEDA774));
      expect(theme.scaffoldBackgroundColor, const Color(0xFFFBF7F1));
      // The old teal seed must be gone.
      expect(theme.colorScheme.primary, isNot(Colors.teal));
    });

    test('TextTheme has display + body styles set', () {
      expect(theme.textTheme.displayLarge, isNotNull);
      expect(theme.textTheme.displayLarge!.fontSize, greaterThan(40));
      expect(theme.textTheme.bodyMedium, isNotNull);
      expect(theme.textTheme.labelSmall, isNotNull);
      // Generous body line-height (the "comfortable reading" intent).
      expect(theme.textTheme.bodyMedium!.height, greaterThanOrEqualTo(1.4));
    });
  });

  group('darkTheme (Obsidian)', () {
    final theme = darkTheme;

    test('builds a Material 3 dark theme', () {
      expect(theme.useMaterial3, isTrue);
      expect(theme.brightness, Brightness.dark);
    });

    test('exposes the AppColors extension with the Obsidian key colours', () {
      final c = theme.extension<AppColors>();
      expect(c, isNotNull);
      expect(c!.canvas, const Color(0xFF14110E));
      expect(c.surface, const Color(0xFF1C1815));
      expect(c.surfaceWarm, const Color(0xFF241F1B));
      expect(c.primary, const Color(0xFFC67A4E));
      expect(c.textPrimary, const Color(0xFFF2EBE1));
    });

    test('depth is tonal: canvas < surface < surfaceWarm in luminance', () {
      final c = theme.extension<AppColors>()!;
      expect(c.canvas.computeLuminance(), lessThan(c.surface.computeLuminance()));
      expect(
        c.surface.computeLuminance(),
        lessThan(c.surfaceWarm.computeLuminance()),
      );
    });

    test('cards use no elevation-tint glow (transparent surfaceTint)', () {
      expect(theme.cardTheme.surfaceTintColor, Colors.transparent);
      expect(theme.cardTheme.elevation, 0);
    });
  });

  test('AppColors.lerp interpolates between light and dark', () {
    final mid = AppColors.light.lerp(AppColors.dark, 0.5);
    expect(mid, isA<AppColors>());
    expect(mid.canvas, isNot(AppColors.light.canvas));
    expect(mid.canvas, isNot(AppColors.dark.canvas));
  });
}
