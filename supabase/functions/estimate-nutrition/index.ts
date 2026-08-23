// estimate-nutrition — Supabase Edge Function (Deno).
//
// AI nutrition estimate (P1 capture). Accepts EITHER a base64 photo of a meal
// OR a short text description, asks Gemini to ESTIMATE the meal's macros, and
// returns a single honest estimate with a confidence.
//
// HONESTY (load-bearing — mirrors the app's spine):
//  • The result is always an ESTIMATE, never a measured value. The prompt says
//    so explicitly and forbids precise guessing when unsure.
//  • Any macro the model cannot see/estimate is returned as null — NEVER a
//    fabricated 0 or an invented precise number.
//  • On any upstream/parse error we return an honest error status and NO
//    estimate; we never fabricate a fallback. The app then falls back to the
//    manual form.
//  • This function only ESTIMATES. The client prefills the capture form as an
//    estimate and the user confirms/edits before anything is logged.
//
// Auth: per-user action, so the caller's JWT is required. Supabase's Edge
// runtime already rejects unauthenticated calls when deployed WITHOUT
// `--no-verify-jwt` (the default). We additionally assert an Authorization
// header as a defensive check.
//
// NOT DEPLOYED YET. See README.md for how to deploy (GEMINI_API_KEY is already
// set as a function secret on the Health Hub project).

// deno-lint-ignore-file no-explicit-any

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface NutritionEstimate {
  name: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  confidence: number;
  note: string | null;
}

const PROMPT = `
You are a nutrition estimator. You are given EITHER one photo of a meal OR a
short text description of a meal. Produce a SINGLE best ESTIMATE of the meal's
nutrition for the portion shown/described.

These are ESTIMATES, not measurements. Follow these rules exactly:
- Return "name": a short human name for the meal (e.g. "Chicken salad"), or null
  if you genuinely cannot tell what it is.
- Return "kcal", "protein_g", "carbs_g", "fat_g": your best ESTIMATE in the
  stated unit (kcal; grams for the macros) for the WHOLE portion.
  - If you cannot reasonably estimate a value, return null for THAT value. Do
    NOT guess a precise number you have no basis for. A null is the honest
    answer — never fabricate a 0 to fill a gap.
  - Be conservative: prefer null over a confident-looking but baseless number.
- Return "confidence": your overall confidence in the estimate, 0 to 1.
- Return "note": one short sentence of context (e.g. "Assumed a standard bowl
  portion."), or null.
- Do NOT return ranges, units inside the numbers, or extra fields.

Respond with STRICT JSON ONLY, no markdown, in exactly this shape:
{"name":"...","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":0.0,"note":null}
`.trim();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** A macro is a number ONLY when finite and >= 0; otherwise honest null. */
function macro(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeEstimate(raw: any): NutritionEstimate {
  const rec = (raw && typeof raw === "object") ? raw : {};
  return {
    name: nonEmptyString(rec.name),
    kcal: macro(rec.kcal),
    protein_g: macro(rec.protein_g),
    carbs_g: macro(rec.carbs_g),
    fat_g: macro(rec.fat_g),
    confidence: clampConfidence(rec.confidence),
    note: nonEmptyString(rec.note),
  };
}

/** Extract the model's text and parse the JSON object it was asked to emit. */
function parseGeminiJson(payload: any): NutritionEstimate | null {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (!text) return null;

  // Strip a possible ```json fence, then parse the first {...} object.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: any;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  return normalizeEstimate(obj);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Per-user action: require the caller's JWT. (The Edge runtime already
  // enforces this when deployed with JWT verification on; assert defensively.)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    // Honest config error — NOT an empty success, and definitely no fake macros.
    return jsonResponse({ error: "estimator_not_configured" }, 503);
  }

  let image: string | null = null;
  let textInput: string | null = null;
  try {
    const body = await req.json();
    image = typeof body?.image === "string" && body.image.length > 0
      ? body.image
      : null;
    textInput = typeof body?.text === "string" && body.text.trim()
      ? body.text.trim()
      : null;
  } catch {
    return jsonResponse({ error: "bad_request" }, 400);
  }

  if (!image && !textInput) {
    // Exactly one of image/text is required.
    return jsonResponse({ error: "no_input" }, 400);
  }

  // Build the Gemini request: the prompt + the image OR the description text.
  const parts: any[] = [{ text: PROMPT }];
  if (image) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
  }
  if (textInput) {
    parts.push({ text: `Meal description: ${textInput}` });
  }

  let geminiRes: Response;
  try {
    geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (e) {
    return jsonResponse(
      { error: "upstream_unreachable", detail: String(e) },
      502,
    );
  }

  if (!geminiRes.ok) {
    // Honest upstream failure — no fabricated estimate.
    return jsonResponse({ error: "upstream_error", status: geminiRes.status }, 502);
  }

  let payload: any;
  try {
    payload = await geminiRes.json();
  } catch {
    return jsonResponse({ error: "upstream_bad_json" }, 502);
  }

  const estimate = parseGeminiJson(payload);
  if (!estimate) {
    // Couldn't read an estimate out of the model — honest failure, not a
    // fabricated blank. The app falls back to manual.
    return jsonResponse({ error: "no_estimate" }, 502);
  }

  return jsonResponse(estimate, 200);
});
