import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The user's chosen app theme, persisted across launches.
///
/// **Default is LIGHT.** The user can switch to the premium dark "Obsidian"
/// theme in Settings → Appearance; the choice is saved and survives restart.
/// (Both palettes live in `design_system/`; this only picks which one is shown.)
class ThemeModeController extends Notifier<ThemeMode> {
  static const _key = 'theme_mode';

  @override
  ThemeMode build() {
    // Load the saved choice asynchronously; until it resolves, default to light.
    _load();
    return ThemeMode.light;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_key);
    if (saved == 'dark') {
      state = ThemeMode.dark;
    } else if (saved == 'light') {
      state = ThemeMode.light;
    }
    // No stored value → keep the light default.
  }

  /// Set + persist the theme. Light and dark are the two offered options.
  Future<void> set(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, mode == ThemeMode.dark ? 'dark' : 'light');
  }

  bool get isDark => state == ThemeMode.dark;
}

final themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);
