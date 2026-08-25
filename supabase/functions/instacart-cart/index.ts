// instacart-cart — Supabase Edge Function (Deno).
//
// Creates an Instacart "shopping list page" pre-filled with the user's grocery
// items, via the Instacart Developer Platform (IDP) API, and returns the URL.
//
// HONESTY (load-bearing — mirrors the app's spine):
//  • We NEVER claim an order was placed or is in progress. This endpoint only
//    returns a URL that opens Instacart with items pre-loaded; the user checks
//    out there.
//  • On any upstream error, missing config, or bad input, we return an honest
//    error status so the Flutter client can fall back to the search deep-link.
//    We NEVER return a fabricated URL.
//  • The items list sent is the user's REAL grocery list — passed verbatim from
//    the client, nothing added or substituted.
//
// Auth: per-user action. Supabase Edge runtime enforces JWT verification when
// the function is deployed without --no-verify-jwt (the default). We also
// assert the Authorization header defensively.
//
// NOT DEPLOYED YET. See README.md for deploy instructions + secret setup.

// deno-lint-ignore-file no-explicit-any

import { reportError } from "../_shared/sentry.ts";

// Instacart Developer Platform endpoints.
// Use the dev server for testing; switch to prod when deploying live.
const IDP_PROD_URL =
  "https://connect.instacart.com/idp/v1/products/products_link";

// If an env var INSTACART_ENV=dev is set, use the dev server.
function instacartEndpoint(): string {
  return Deno.env.get("INSTACART_ENV") === "dev"
    ? "https://connect.dev.instacart.tools/idp/v1/products/products_link"
    : IDP_PROD_URL;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Handle CORS pre-flight.
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    // Per-user action: require the caller's JWT.
    // (The Edge runtime already enforces this; we assert defensively.)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    // Require the Instacart API key; fail honestly if not configured.
    // This drives the Flutter client's fallback to the search deep-link.
    const apiKey = Deno.env.get("INSTACART_API_KEY");
    if (!apiKey) {
      return jsonResponse(
        {
          error: "instacart_not_configured",
          detail:
            "INSTACART_API_KEY is not set. Deploy the secret to enable pre-filled cart.",
        },
        503,
      );
    }

    // Parse and validate the request body.
    let items: string[];
    try {
      const body = await req.json();
      items = Array.isArray(body?.items) ? body.items : [];
    } catch {
      return jsonResponse({ error: "bad_request", detail: "Invalid JSON" }, 400);
    }

    // Filter to non-empty strings — we never pass blank items to Instacart.
    items = items
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (items.length === 0) {
      return jsonResponse(
        { error: "bad_request", detail: "items must be a non-empty array of strings" },
        400,
      );
    }

    // Build the Instacart "Create shopping list page" request.
    // Docs: POST https://connect.instacart.com/idp/v1/products/products_link
    // Body: { line_items: [{ name: string }, ...] }
    // Returns: { products_link_url: string }
    //
    // Assumption (per spec): each line_item needs at minimum a `name` field.
    // UPC is optional and not available from the grocery list, so we omit it.
    const lineItems = items.map((name) => ({ name }));

    let idpRes: Response;
    try {
      idpRes = await fetch(instacartEndpoint(), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Instacart docs also require a Content-Type of application/json.
        },
        body: JSON.stringify({ line_items: lineItems }),
      });
    } catch (e) {
      // Network unreachable / DNS failure.
      return jsonResponse(
        { error: "upstream_unreachable", detail: String(e) },
        502,
      );
    }

    if (!idpRes.ok) {
      // Honest upstream failure — no fabricated URL.
      let detail: unknown;
      try {
        detail = await idpRes.json();
      } catch {
        detail = await idpRes.text().catch(() => "(no body)");
      }
      return jsonResponse(
        {
          error: "upstream_error",
          status: idpRes.status,
          detail,
        },
        502,
      );
    }

    let payload: any;
    try {
      payload = await idpRes.json();
    } catch {
      return jsonResponse({ error: "upstream_bad_json" }, 502);
    }

    const productsLinkUrl = payload?.products_link_url;
    if (typeof productsLinkUrl !== "string" || !productsLinkUrl) {
      // Unexpected shape from Instacart — honest error, no fabricated URL.
      return jsonResponse(
        {
          error: "unexpected_response",
          detail: "products_link_url missing or empty in Instacart response",
        },
        502,
      );
    }

    // Success — return the pre-filled cart URL.
    // The client opens this URL; it is NOT a checkout confirmation.
    return jsonResponse({ products_link_url: productsLinkUrl }, 200);
  } catch (err) {
    // Unexpected throw — report to Sentry (no-op when DSN absent) and return an
    // honest 500. Response shape and status are NOT changed for handled errors above.
    await reportError(err, { function: "instacart-cart" });
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
