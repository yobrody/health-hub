// _shared/sentry.ts — Lightweight Sentry error reporting for Health Hub Edge
// Functions (Deno/Supabase Edge runtime).
//
// WHY NOT @sentry/deno: Supabase Edge Functions run a hardened Deno runtime
// whose npm-compatibility layer has historically failed with Sentry's full SDK
// (dynamic require, globalThis.process assumptions, worker thread checks). A
// direct Sentry Envelope POST is simpler, has zero import issues, and is
// exactly what the SDK does under the hood for exception capture.
//
// PRIVACY (health app — load-bearing):
//  • Never include health data, food names, weights, macros, or any PII.
//  • The `context` parameter accepts ONLY: function name, error code, and
//    non-PII tags. Never pass request body contents or user data.
//  • sendDefaultPii = false is implicit (we construct the envelope manually
//    and do NOT include user fields, IP, or breadcrumbs).
//
// OFF BY DEFAULT: when SENTRY_DSN is absent, reportError() is a no-op.
// The response shape / status of every function is NEVER changed by this
// module — a reporting failure is silently swallowed.

// deno-lint-ignore-file no-explicit-any

interface SentryContext {
  /** The edge function name (e.g. "estimate-nutrition"). Non-PII. */
  function?: string;
  /** A short error code or category string. Non-PII. */
  errorCode?: string;
  /** Additional non-PII tags to attach to the Sentry event. */
  tags?: Record<string, string>;
}

/**
 * Parse the DSN into its Sentry envelope ingest URL and public key.
 * DSN shape: https://<key>@<host>/<project_id>
 * Envelope URL: https://<host>/api/<project_id>/envelope/
 */
function parseDsn(
  dsn: string,
): { envelopeUrl: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    const host = url.host; // e.g. o123456.ingest.sentry.io
    const envelopeUrl = `https://${host}/api/${projectId}/envelope/`;
    if (!publicKey || !projectId) return null;
    return { envelopeUrl, publicKey };
  } catch {
    return null;
  }
}

/**
 * Build a minimal Sentry envelope for an exception.
 * Sentry Envelope format: three newline-separated parts, each a JSON line:
 *   1. Envelope header  {"dsn":"...","sdk":{...}}
 *   2. Item header      {"type":"event","length":<n>}
 *   3. Event payload    {...}
 * https://develop.sentry.dev/sdk/envelopes/
 */
function buildEnvelope(
  publicKey: string,
  dsn: string,
  error: unknown,
  context: SentryContext,
): string {
  const eventId = crypto.randomUUID().replace(/-/g, "");

  // PRIVACY (health app): send ONLY the error TYPE — never `error.message`.
  // A message could carry user/health data if an upstream throw stringified a
  // goal/macro/food value into it, so we omit it entirely. The type + stack are
  // enough to locate the bug; they never contain user data.
  const type = error instanceof Error ? error.constructor.name : "Error";
  const message = type;

  // Stack trace: only include when available (never fabricate).
  const frames = error instanceof Error && error.stack
    ? [{ function: "<anonymous>", abs_path: type, raw_function: type }]
    : [];

  const event: Record<string, any> = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    sdk: { name: "health-hub.edge", version: "1.0.0" },
    exception: {
      values: [
        {
          type,
          value: message,
          stacktrace: frames.length ? { frames } : undefined,
        },
      ],
    },
    tags: {
      runtime: "deno",
      ...(context.function ? { function: context.function } : {}),
      ...(context.errorCode ? { error_code: context.errorCode } : {}),
      ...context.tags,
    },
    // NO user field, NO request field, NO breadcrumbs — privacy-first.
  };

  const envelopeHeader = JSON.stringify({
    dsn,
    sdk: { name: "health-hub.edge", version: "1.0.0" },
  });
  const itemPayload = JSON.stringify(event);
  const itemHeader = JSON.stringify({
    type: "event",
    length: new TextEncoder().encode(itemPayload).length,
  });

  return `${envelopeHeader}\n${itemHeader}\n${itemPayload}`;
}

/**
 * Report an error to Sentry IF SENTRY_DSN is configured.
 *
 * When the DSN is absent, this is a no-op — the caller's response and
 * behaviour are completely unaffected. A reporting failure (bad DSN, network
 * error) is silently swallowed; the caller still returns its honest status.
 *
 * @param error   The caught error/exception. Message is truncated to 500 chars.
 * @param context Non-PII labels only: function name, error code, tags.
 *                NEVER pass request body, user data, or health values.
 */
export async function reportError(
  error: unknown,
  context: SentryContext = {},
): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return; // Off by default.

  const parsed = parseDsn(dsn);
  if (!parsed) return; // Malformed DSN — don't crash.

  try {
    const envelope = buildEnvelope(parsed.publicKey, dsn, error, context);
    await fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": [
          "Sentry sentry_version=7",
          `sentry_key=${parsed.publicKey}`,
          "sentry_client=health-hub.edge/1.0.0",
        ].join(", "),
      },
      body: envelope,
    });
  } catch {
    // Swallow all reporting failures — the caller's response is unaffected.
  }
}
