/// Build-time configuration.
///
/// [baseUrl] is injected at build time via `--dart-define=HEALTH_HUB_API_BASE=...`.
///
/// The default is intentionally an **empty string**. There is no confirmed
/// native-app backend URL yet, and the retired PWA host
/// (`health-hub-dwz.pages.dev`) is NOT it — baking a wrong default in would
/// silently mis-target every request at a stale endpoint. An empty base makes
/// requests honestly fail (and therefore queue in the Outbox) until a real base
/// is supplied per build. Nothing here fabricates a "working" endpoint.
///
/// Supply the real backend per build, e.g.:
///   flutter build ... --dart-define=HEALTH_HUB_API_BASE=https://api.example.com
class Config {
  const Config();

  /// Base URL of the Health Hub backend API. Empty until supplied via
  /// `--dart-define=HEALTH_HUB_API_BASE=...`.
  static const String baseUrl = String.fromEnvironment(
    'HEALTH_HUB_API_BASE',
    defaultValue: '',
  );
}
