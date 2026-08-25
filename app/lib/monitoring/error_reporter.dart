// Error-reporting seam — the only file that knows about Sentry.
//
// Rules:
//  • Privacy is load-bearing (health app). Reports carry ONLY: error type,
//    message, stack trace, screen/route name, and non-PII tags (platform,
//    release). NEVER attach food names, weights, calorie/macro values, pantry
//    contents, health metrics, or user email/PII.
//  • Off by default. No SENTRY_DSN compiled in → [NoopErrorReporter] does
//    nothing (tests + CI + privacy-conscious builds are unaffected).
//  • The DSN comes from --dart-define=SENTRY_DSN=https://...
//  • All Sentry calls are individually try/caught — error reporting must never
//    crash the app.

import 'package:sentry_flutter/sentry_flutter.dart';

// ── Abstract seam ─────────────────────────────────────────────────────────────

abstract class ErrorReporter {
  /// Capture an exception with an optional stack trace.
  ///
  /// Implementations MUST NOT attach any health, food, weight, or user PII to
  /// the event — only the error type, message, and stack.
  Future<void> captureException(Object error, {StackTrace? stack});
}

// ── Sentry implementation ─────────────────────────────────────────────────────

/// The real implementation. Wraps [Sentry] from sentry_flutter.
///
/// Only constructed when a SENTRY_DSN dart-define is compiled in.
/// `SentryFlutter.init` must be called in `main()` before this class is used.
class SentryErrorReporter implements ErrorReporter {
  const SentryErrorReporter();

  @override
  Future<void> captureException(Object error, {StackTrace? stack}) async {
    try {
      await Sentry.captureException(error, stackTrace: stack);
    } catch (_) {
      // Error reporting must never crash the app.
    }
  }
}

// ── Noop implementation ───────────────────────────────────────────────────────

/// All methods are no-ops. Used when no SENTRY_DSN is compiled in (tests, CI,
/// privacy-conscious builds). This is the DEFAULT.
class NoopErrorReporter implements ErrorReporter {
  const NoopErrorReporter();

  @override
  Future<void> captureException(Object error, {StackTrace? stack}) async {}
}
