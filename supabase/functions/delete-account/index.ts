// delete-account — permanently delete the CALLER's account + ALL their data.
//
// Why this exists: GDPR right-to-erasure + Apple App Store guideline 5.1.1(v)
// (any app with account creation must offer in-app deletion). Irreversible.
//
// SECURITY (this handles the service_role key + destructive deletes):
//  • JWT-gated: deployed with verify_jwt ON, so only an authenticated caller
//    reaches it. We ALSO verify the token and derive the uid from it — we only
//    ever delete the caller's OWN data, never an arbitrary user id from the body.
//  • Uses SUPABASE_SERVICE_ROLE_KEY (auto-injected into the edge runtime, never
//    shipped to the client) to (1) purge every row the user owns and (2) delete
//    the auth user. All user tables are `user_id ... references auth.users(id)
//    ON DELETE CASCADE`, so the auth-user delete alone cascades — the explicit
//    purge is defence-in-depth (auditable + robust if a future FK changes).
//
// Deploy:  npx supabase functions deploy delete-account --project-ref eazwtlqieizvsqvbbknj
// (No extra secret needed — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided
// by the platform.)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { reportError } from "../_shared/sentry.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every user-owned table (RLS-enabled, `user_id` FK). Kept in sync with the
// migrations; a missing table here would orphan user data (a GDPR failure), so
// the auth-user delete + ON DELETE CASCADE is the guaranteed backstop.
const USER_TABLES = [
  "food_log_entries",
  "grocery_list",
  "meal_plans",
  "nutrition_goals",
  "pantry_items",
  "profile",
  "weigh_ins",
  "workouts",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "not_configured" }, 503);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Derive the uid from the VERIFIED token — never trust a uid from the body.
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    // 1) Explicit purge (defence in depth). Report unexpected errors but keep going.
    for (const table of USER_TABLES) {
      const { error } = await admin.from(table).delete().eq("user_id", uid);
      if (error && !/does not exist/i.test(error.message)) {
        await reportError(new Error(`purge ${table}: ${error.message}`), {
          function: "delete-account",
        });
      }
    }

    // 2) Delete the auth user (point of no return; cascades any remaining rows).
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      await reportError(delErr, { function: "delete-account" });
      return json({ error: "delete_failed" }, 500);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    await reportError(err, { function: "delete-account" });
    return json({ error: "internal_error" }, 500);
  }
});
