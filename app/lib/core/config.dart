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

  /// Supabase project URL. Injected at build/run time via
  /// `--dart-define-from-file=env.local.json` (key `SUPABASE_URL`).
  ///
  /// Default is an **empty string** on purpose: no URL is baked into the repo
  /// (the real value lives in the gitignored `env.local.json`). An empty value
  /// means "auth backend not configured" — [supabaseConfigured] is then false
  /// and the app runs in a clearly-degraded local mode instead of pointing auth
  /// at a wrong/stale endpoint. Nothing here fabricates a working auth backend.
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: '',
  );

  /// Supabase publishable (anon/client) key. Injected the same way, key
  /// `SUPABASE_PUBLISHABLE_KEY`. Empty by default — never committed. This is a
  /// client-side publishable key (safe to ship in a built app), NOT a secret
  /// service key; it is still supplied per build rather than hardcoded here.
  static const String supabasePublishableKey = String.fromEnvironment(
    'SUPABASE_PUBLISHABLE_KEY',
    defaultValue: '',
  );

  /// True only when BOTH Supabase config values are present. The auth layer
  /// gates real client init on this so a build/test without the dart-define
  /// (e.g. plain `flutter test`) never tries to reach the network.
  static bool get supabaseConfigured =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;
}
