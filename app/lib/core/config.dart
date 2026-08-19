/// Build-time configuration.
///
/// [baseUrl] is injected at build time via `--dart-define=HEALTH_HUB_API_BASE=...`.
/// The default is a placeholder for dev; the real value is supplied per build
/// (different for dev vs prod).
class Config {
  const Config();

  /// Base URL of the Health Hub backend API.
  static const String baseUrl = String.fromEnvironment(
    'HEALTH_HUB_API_BASE',
    defaultValue: 'https://health-hub-dwz.pages.dev',
  );
}
