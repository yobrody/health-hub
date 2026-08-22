/// The user's **kitchen appliance layout** preference — a purely COSMETIC
/// display config for the interactive kitchen (R-3).
///
/// It records whether the user wants their **fridge / pantry / freezer** drawn
/// as a *single* unit or a *double* (a larger / second appliance). This changes
/// only how the kitchen LOOKS — it never touches item data, never invents slots,
/// and never implies phantom stock. An item's real [PantryZone] and the real
/// counts/freshness are always the source of truth; the layout just decides how
/// much appliance to draw around them.
///
/// Mirrors the repo/store pattern used by [PantryRepo] / [ProfileRepo]: a pure
/// [KitchenLayoutStore] interface plus a thin [SharedPrefsKitchenLayoutStore]
/// real adapter. Tests inject an in-memory fake.
///
/// Spices (condiments) has no single/double toggle — it's always a single
/// spice rack — so the layout only tracks the three larger appliances.
library;

import 'package:shared_preferences/shared_preferences.dart';

/// How many units of an appliance to draw. Cosmetic only.
enum ApplianceSize {
  /// One unit (the default).
  single,

  /// A larger / second unit — more visual capacity, same real data.
  double_;

  bool get isDouble => this == ApplianceSize.double_;
}

/// The three appliances that support a single/double toggle. Spices are
/// deliberately excluded (always a single rack).
enum ToggleableAppliance { fridge, pantry, freezer }

/// The kitchen layout preference — the single/double state of each toggleable
/// appliance. Immutable; [withSize] returns a copy. Unknown/absent persisted
/// values default to [ApplianceSize.single] (honest, minimal default).
class KitchenLayout {
  const KitchenLayout({
    this.fridge = ApplianceSize.single,
    this.pantry = ApplianceSize.single,
    this.freezer = ApplianceSize.single,
  });

  final ApplianceSize fridge;
  final ApplianceSize pantry;
  final ApplianceSize freezer;

  /// The default all-single layout.
  static const KitchenLayout initial = KitchenLayout();

  ApplianceSize sizeOf(ToggleableAppliance appliance) {
    switch (appliance) {
      case ToggleableAppliance.fridge:
        return fridge;
      case ToggleableAppliance.pantry:
        return pantry;
      case ToggleableAppliance.freezer:
        return freezer;
    }
  }

  /// Return a copy with [appliance] set to [size].
  KitchenLayout withSize(ToggleableAppliance appliance, ApplianceSize size) {
    switch (appliance) {
      case ToggleableAppliance.fridge:
        return KitchenLayout(fridge: size, pantry: pantry, freezer: freezer);
      case ToggleableAppliance.pantry:
        return KitchenLayout(fridge: fridge, pantry: size, freezer: freezer);
      case ToggleableAppliance.freezer:
        return KitchenLayout(fridge: fridge, pantry: pantry, freezer: size);
    }
  }

  /// Return a copy with [appliance] flipped single⇄double.
  KitchenLayout toggled(ToggleableAppliance appliance) => withSize(
        appliance,
        sizeOf(appliance).isDouble
            ? ApplianceSize.single
            : ApplianceSize.double_,
      );

  Map<String, dynamic> toJson() => {
        'fridge': fridge.name,
        'pantry': pantry.name,
        'freezer': freezer.name,
      };

  factory KitchenLayout.fromJson(Map<String, dynamic> json) => KitchenLayout(
        fridge: _sizeFromString(json['fridge']),
        pantry: _sizeFromString(json['pantry']),
        freezer: _sizeFromString(json['freezer']),
      );

  static ApplianceSize _sizeFromString(Object? raw) {
    for (final s in ApplianceSize.values) {
      if (s.name == raw) return s;
    }
    return ApplianceSize.single; // unknown/absent → the minimal default
  }

  @override
  bool operator ==(Object other) =>
      other is KitchenLayout &&
      other.fridge == fridge &&
      other.pantry == pantry &&
      other.freezer == freezer;

  @override
  int get hashCode => Object.hash(fridge, pantry, freezer);
}

/// Local persistence for the kitchen layout. Same interface/fake pattern as
/// [PantryStore] / [ProfileStore]: the platform impl
/// ([SharedPrefsKitchenLayoutStore]) is not unit-tested; tests inject a fake.
abstract class KitchenLayoutStore {
  Future<KitchenLayout> load();
  Future<void> save(KitchenLayout layout);
}

/// Loads + persists the [KitchenLayout]. A tiny store — no Outbox/sync: this is
/// a device-local *display* preference, not user data worth syncing (mirrors the
/// local-only [GroceryListRepo] decision).
class KitchenLayoutRepo {
  KitchenLayoutRepo({required this._store});

  final KitchenLayoutStore _store;

  Future<KitchenLayout> load() => _store.load();

  /// Toggle one appliance single⇄double and persist. Returns the new layout.
  Future<KitchenLayout> toggle(ToggleableAppliance appliance) async {
    final current = await _store.load();
    final next = current.toggled(appliance);
    await _store.save(next);
    return next;
  }
}

// ── SharedPreferences-backed real store ──────────────────────────────────────

const _kKitchenLayoutKey = 'hh_kitchen_layout_v1';

/// Production [KitchenLayoutStore] backed by [SharedPreferences]. Not
/// unit-tested (platform channel); the interface is what makes the repo testable.
/// A corrupt/absent value → the honest all-single default, never a crash.
class SharedPrefsKitchenLayoutStore implements KitchenLayoutStore {
  const SharedPrefsKitchenLayoutStore();

  @override
  Future<KitchenLayout> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKitchenLayoutKey);
      if (raw == null) return KitchenLayout.initial;
      final parsed = _decode(raw);
      if (parsed == null) return KitchenLayout.initial;
      return KitchenLayout.fromJson(parsed);
    } catch (_) {
      return KitchenLayout.initial;
    }
  }

  @override
  Future<void> save(KitchenLayout layout) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kKitchenLayoutKey, _encode(layout.toJson()));
    } catch (_) {
      // Quota / access denied — the in-memory state is still correct for this
      // session; mirror the pantry/profile stores' tolerant behaviour.
    }
  }
}

// Small JSON helpers kept local so this file has no import beyond prefs.
String _encode(Map<String, dynamic> m) =>
    m.entries.map((e) => '${e.key}=${e.value}').join(';');

Map<String, dynamic>? _decode(String raw) {
  if (raw.isEmpty) return null;
  final out = <String, dynamic>{};
  for (final pair in raw.split(';')) {
    final i = pair.indexOf('=');
    if (i <= 0) continue;
    out[pair.substring(0, i)] = pair.substring(i + 1);
  }
  return out.isEmpty ? null : out;
}
