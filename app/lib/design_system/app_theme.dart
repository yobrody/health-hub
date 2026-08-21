import 'package:flutter/material.dart';

import 'colors.dart';
import 'motion.dart';
import 'shape.dart';
import 'spacing.dart';
import 'typography.dart';

/// Assembles the light (**Creamsicle**) and dark (**Obsidian**) [ThemeData] for
/// Health Hub from the design tokens.
///
/// Both are Material 3, carry the [AppColors] extension, share the same
/// [TextTheme] shape (recoloured per mode), and theme every common component so
/// the whole app inherits the luxury system for free. Import this file to get
/// [AppTheme.light] / [AppTheme.dark].
///
/// One-way dependency: imports only Flutter + sibling token files.
class AppTheme {
  const AppTheme._();

  static ThemeData get light => _build(AppColors.light, Brightness.light);
  static ThemeData get dark => _build(AppColors.dark, Brightness.dark);

  static ThemeData _build(AppColors c, Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    // In light mode, on-primary content is the warm charcoal (dark-on-soft-
    // orange) — cleaner and quieter than white on a pale fill, and it clears
    // AA. In dark, the burnt orange takes white-warm text.
    final Color onPrimary = isDark ? const Color(0xFF1A120C) : c.textPrimary;

    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: c.primary,
      onPrimary: onPrimary,
      primaryContainer: c.surfaceWarm,
      onPrimaryContainer: c.textPrimary,
      secondary: c.accent,
      onSecondary: isDark ? const Color(0xFF11150E) : const Color(0xFFFDFEFB),
      secondaryContainer: c.surfaceWarm,
      onSecondaryContainer: c.textPrimary,
      tertiary: c.primaryStrong,
      onTertiary: isDark ? const Color(0xFF1A120C) : const Color(0xFFFFFDFB),
      // Warm, muted error — a clay-red that lives in the same family rather
      // than a loud pure red.
      error: isDark ? const Color(0xFFE0857A) : const Color(0xFFB4402E),
      onError: isDark ? const Color(0xFF1A0E0B) : const Color(0xFFFFFDFB),
      surface: c.surface,
      onSurface: c.textPrimary,
      onSurfaceVariant: c.textSecondary,
      outline: c.hairline,
      outlineVariant: c.hairline,
      // Tonal elevation source for M3 surface tints — kept warm & subtle.
      surfaceTint: c.primary,
      shadow: AppShape.warmShadowColor,
      scrim: const Color(0x99000000),
      inverseSurface: isDark ? c.textPrimary : c.textPrimary,
      onInverseSurface: isDark ? c.canvas : c.surface,
      inversePrimary: c.primaryStrong,
    );

    final textTheme = AppTypography.textTheme(
      primary: c.textPrimary,
      secondary: c.textSecondary,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: c.canvas,
      canvasColor: c.canvas,
      textTheme: textTheme,
      // Keep our authored surface colours — don't let M3 auto-tint surfaces
      // with the primary at every elevation (we control elevation via tokens).
      applyElevationOverlayColor: false,
      splashFactory: InkRipple.splashFactory,
      extensions: <ThemeExtension<dynamic>>[c],

      // ── AppBar ─────────────────────────────────────────────────────────
      appBarTheme: AppBarTheme(
        backgroundColor: c.canvas,
        foregroundColor: c.textPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
        iconTheme: IconThemeData(color: c.textPrimary),
      ),

      // ── Cards ──────────────────────────────────────────────────────────
      cardTheme: CardThemeData(
        color: c.surface,
        surfaceTintColor: Colors.transparent,
        // In dark, elevation reads from the lighter surface tone (see
        // surfaceWarm) + a soft shadow — never glow.
        shadowColor: isDark ? Colors.black : AppShape.warmShadowColor,
        elevation: isDark ? 0 : 1,
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: AppShape.card,
          side: isDark
              ? BorderSide(color: c.hairline, width: 1)
              : BorderSide.none,
        ),
      ),

      // ── Filled (primary) buttons ───────────────────────────────────────
      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return c.primary.withValues(alpha: 0.4);
            }
            if (states.contains(WidgetState.pressed)) return c.primaryStrong;
            return c.primary;
          }),
          foregroundColor: WidgetStatePropertyAll(onPrimary),
          overlayColor: WidgetStatePropertyAll(
            onPrimary.withValues(alpha: 0.08),
          ),
          textStyle: WidgetStatePropertyAll(textTheme.labelLarge),
          minimumSize: const WidgetStatePropertyAll(Size(64, 52)),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: AppSpacing.space6),
          ),
          shape: const WidgetStatePropertyAll(AppShape.buttonBorder),
          elevation: const WidgetStatePropertyAll(0),
          animationDuration: AppMotion.fast,
        ),
      ),

      // ── Outlined buttons ───────────────────────────────────────────────
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStatePropertyAll(c.primaryStrong),
          overlayColor: WidgetStatePropertyAll(
            c.primary.withValues(alpha: 0.08),
          ),
          side: WidgetStateProperty.resolveWith((states) {
            final color = states.contains(WidgetState.pressed)
                ? c.primaryStrong
                : c.hairline;
            return BorderSide(color: color, width: 1.2);
          }),
          textStyle: WidgetStatePropertyAll(textTheme.labelLarge),
          minimumSize: const WidgetStatePropertyAll(Size(64, 52)),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: AppSpacing.space6),
          ),
          shape: const WidgetStatePropertyAll(AppShape.buttonBorder),
          animationDuration: AppMotion.fast,
        ),
      ),

      // ── Text buttons ───────────────────────────────────────────────────
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStatePropertyAll(c.primaryStrong),
          overlayColor: WidgetStatePropertyAll(
            c.primary.withValues(alpha: 0.08),
          ),
          textStyle: WidgetStatePropertyAll(textTheme.labelLarge),
          shape: const WidgetStatePropertyAll(AppShape.buttonBorder),
        ),
      ),

      // ── Text fields ────────────────────────────────────────────────────
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? c.surfaceWarm : c.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space4,
          vertical: AppSpacing.space4,
        ),
        hintStyle: textTheme.bodyMedium?.copyWith(color: c.textSecondary),
        labelStyle: textTheme.bodyMedium?.copyWith(color: c.textSecondary),
        floatingLabelStyle: textTheme.bodySmall?.copyWith(
          color: c.primaryStrong,
        ),
        border: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: c.hairline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: c.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: c.primaryStrong, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colorScheme.error),
        ),
      ),

      // ── Chips ──────────────────────────────────────────────────────────
      chipTheme: ChipThemeData(
        backgroundColor: c.surfaceWarm,
        selectedColor: c.primary.withValues(alpha: isDark ? 0.28 : 0.20),
        checkmarkColor: c.primaryStrong,
        disabledColor: c.hairline,
        labelStyle: textTheme.labelMedium,
        secondaryLabelStyle: textTheme.labelMedium,
        side: BorderSide(color: c.hairline),
        shape: AppShape.chipBorder,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space3,
          vertical: AppSpacing.space2,
        ),
        showCheckmark: true,
      ),

      // ── Dividers ───────────────────────────────────────────────────────
      dividerTheme: DividerThemeData(
        color: c.hairline,
        thickness: 1,
        space: AppSpacing.space6,
      ),

      // ── Bottom nav (legacy) + NavigationBar (M3) ───────────────────────
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: c.surface,
        selectedItemColor: c.primaryStrong,
        unselectedItemColor: c.textSecondary,
        selectedLabelStyle: textTheme.labelSmall,
        unselectedLabelStyle: textTheme.labelSmall,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: c.primary.withValues(alpha: isDark ? 0.28 : 0.20),
        indicatorShape: const StadiumBorder(),
        elevation: 0,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return textTheme.labelSmall?.copyWith(
            color: selected ? c.primaryStrong : c.textSecondary,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? c.primaryStrong : c.textSecondary,
            size: 24,
          );
        }),
      ),

      // ── List tiles ─────────────────────────────────────────────────────
      listTileTheme: ListTileThemeData(
        iconColor: c.textSecondary,
        textColor: c.textPrimary,
        titleTextStyle: textTheme.titleMedium,
        subtitleTextStyle: textTheme.bodySmall,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space4,
          vertical: AppSpacing.space1,
        ),
        shape: const RoundedRectangleBorder(borderRadius: AppShape.card),
        minVerticalPadding: AppSpacing.space3,
      ),

      // ── Sheets / dialogs ───────────────────────────────────────────────
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: c.surface,
        elevation: 0,
        shape: AppShape.sheetBorder,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        elevation: isDark ? 0 : 3,
        shape: const RoundedRectangleBorder(borderRadius: AppShape.sheet),
        titleTextStyle: textTheme.headlineSmall,
        contentTextStyle: textTheme.bodyMedium,
      ),

      // ── Switches / progress / misc ─────────────────────────────────────
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return c.primary;
          return isDark ? c.textSecondary : c.surface;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return c.primary.withValues(alpha: 0.4);
          }
          return c.hairline;
        }),
        trackOutlineColor: WidgetStatePropertyAll(c.hairline),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.primary,
        linearTrackColor: c.hairline,
        circularTrackColor: c.hairline,
      ),
      iconTheme: IconThemeData(color: c.textPrimary),
      splashColor: c.primary.withValues(alpha: 0.10),
      highlightColor: c.primary.withValues(alpha: 0.06),
    );
  }
}

/// Public aliases matching the task's requested names.
ThemeData get lightTheme => AppTheme.light;
ThemeData get darkTheme => AppTheme.dark;
