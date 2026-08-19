/// Pure, testable permission-state coordinator.
///
/// Mapping from the platform's raw permission status to an app-facing state
/// and the logic that drives UI decisions are kept entirely free of plugin
/// calls so they can be exhaustively unit-tested.
///
/// The real [permission_handler] `PermissionStatus` values are mapped to
/// [RawPermStatus] at the boundary (in the thin wrapper classes that hold
/// plugin references); all coordinator logic operates on [RawPermStatus] /
/// [PermState] only.
library;

// ── Boundary type (pure enum, no plugin import) ──────────────────────────────

/// A plugin-free mirror of `permission_handler`'s `PermissionStatus`.
///
/// Translating at the boundary keeps this file free of native-plugin
/// dependencies so `flutter test` can run it without a device.
enum RawPermStatus {
  /// The user has granted this permission.
  granted,

  /// The user has denied this permission (can be asked again).
  denied,

  /// The user has permanently denied this permission (OS dialog will not show).
  /// On iOS this is equivalent to `denied` after the user tapped "Don't Allow"
  /// and never changed it in Settings; `permission_handler` surfaces it as
  /// `permanentlyDenied`.
  permanentlyDenied,

  /// The permission is restricted by the OS (e.g. parental controls on iOS).
  /// The app cannot request it; the user must change a system setting.
  restricted,
}

// ── App-facing state ─────────────────────────────────────────────────────────

/// The app-facing permission state: one value drives all UI decisions.
enum PermState {
  /// The user has granted the permission — proceed.
  granted,

  /// The user has not yet decided, or denied and can be asked again.
  denied,

  /// The user tapped "Don't Allow" and the OS won't show the dialog again.
  /// The only path forward is opening the system Settings.
  permanentlyDenied,

  /// An OS or parental-control restriction prevents granting. The only path
  /// forward is changing the system Settings.
  restricted,
}

// ── Coordinator (pure static functions, fully unit-tested) ───────────────────

/// Maps raw permission statuses to app-facing states and drives UI decisions.
///
/// All methods are pure (no I/O, no state, no plugin calls) so they can be
/// exhaustively tested under `flutter test`.
abstract final class PermissionCoordinator {
  /// Map a [RawPermStatus] (recorded at the plugin boundary) to a [PermState].
  static PermState fromStatus(RawPermStatus raw) {
    return switch (raw) {
      RawPermStatus.granted => PermState.granted,
      RawPermStatus.denied => PermState.denied,
      RawPermStatus.permanentlyDenied => PermState.permanentlyDenied,
      RawPermStatus.restricted => PermState.restricted,
    };
  }

  /// Whether the app can still request the permission via a system dialog.
  ///
  /// Returns `true` only for [PermState.denied] — meaning the user has not
  /// yet made a final decision or declined and can be asked again.
  /// All other states either already have access ([granted]) or are
  /// unresolvable without Settings ([permanentlyDenied] / [restricted]).
  static bool canRequest(PermState state) => state == PermState.denied;

  /// Whether the only way to gain the permission is to open system Settings.
  ///
  /// Returns `true` for [PermState.permanentlyDenied] and
  /// [PermState.restricted]. The UI should show a "Go to Settings" prompt
  /// rather than a rationale dialog in these cases.
  static bool mustOpenSettings(PermState state) =>
      state == PermState.permanentlyDenied || state == PermState.restricted;
}
