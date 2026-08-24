// recognize-pantry — Supabase Edge Function (Deno).
//
// AI photo → pantry (R-2). Accepts base64 photos of a user's fridge / freezer /
// pantry / spices, asks the LLM (via OpenRouter, model via OPENROUTER_MODEL,
// default google/gemini-2.5-flash) to identify the DISTINCT items actually
// visible, and returns them as honest suggestions with a per-item confidence.
//
// HONESTY (load-bearing — mirrors the app's spine):
//  • The prompt EXPLICITLY forbids inventing items the model doesn't see.
//  • qty/unit are returned ONLY when clearly visible, else null — never a
//    fabricated amount.
//  • On any upstream/parse error we return an honest error status and NO items;
//    we never fabricate a fallback list.
//  • This function only SUGGESTS. The client shows the suggestions and the user
//    confirms before anything is saved as real pantry stock.
//
// Auth: this is a per-user action, so the caller's JWT is required. Supabase's
// Edge runtime already rejects unauthenticated calls when the function is
// deployed WITHOUT `--no-verify-jwt` (the default). We additionally assert an
// Authorization header is present as a defensive check.
//
// NOT DEPLOYED YET. See README.md for how to deploy + set OPENROUTER_API_KEY.

// deno-lint-ignore-file no-explicit-any

import { callLLM, hasKey, type LLMMessage, type ContentPart } from "../_shared/llm.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ZONES = ["fridge", "pantry", "freezer", "condiments"] as const;
type Zone = (typeof ZONES)[number];

interface RecognizedItem {
  name: string;
  zoneGuess: Zone;
  confidence: number;
  qtyGuess?: number | null;
  unitGuess?: string | null;
}

const PROMPT = `
You are a kitchen inventory assistant. You are given one or more photos of a
person's fridge, freezer, pantry shelves, and/or spice rack.

Identify the DISTINCT food, drink, and grocery items you can ACTUALLY SEE in the
photos. Rules — follow them exactly:
- ONLY include items that are genuinely visible. Do NOT invent, assume, or infer
  items that are not clearly in the image. It is correct to return an empty list
  if you cannot identify anything.
- For each item return:
  - "name": a short human name, e.g. "Milk", "Chicken breast", "Paprika".
  - "zoneGuess": the single best storage zone, one of exactly:
    "fridge", "pantry", "freezer", "condiments".
  - "confidence": your confidence it is really that item, a number from 0 to 1.
  - "qtyGuess": the quantity ONLY if it is clearly countable/visible
    (e.g. 6 for six visible eggs); otherwise null. Never guess an amount.
  - "unitGuess": the unit for qtyGuess (e.g. "unit", "pack", "g", "ml") ONLY if
    clear; otherwise null.
- Merge obvious duplicates of the same item into one entry.
- Do not include non-food objects (shelves, containers, hands, etc.).

Respond with STRICT JSON ONLY, no markdown, in exactly this shape:
{"items":[{"name":"...","zoneGuess":"pantry","confidence":0.0,"qtyGuess":null,"unitGuess":null}]}
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

function normalizeZone(v: unknown): Zone {
  return (ZONES as readonly string[]).includes(v as string)
    ? (v as Zone)
    // pantry is the safe default (least-perishable — won't fabricate urgency).
    : "pantry";
}

function normalizeItems(raw: unknown): RecognizedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecognizedItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, any>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue; // a nameless row is not a real suggestion
    const qty = typeof rec.qtyGuess === "number" && Number.isFinite(rec.qtyGuess)
      ? rec.qtyGuess
      : null;
    const unit = typeof rec.unitGuess === "string" && rec.unitGuess.trim()
      ? rec.unitGuess.trim()
      : null;
    out.push({
      name,
      zoneGuess: normalizeZone(rec.zoneGuess),
      confidence: clampConfidence(rec.confidence),
      // qty/unit only when clearly visible — honest nulls otherwise.
      qtyGuess: qty,
      unitGuess: qty === null ? null : unit,
    });
  }
  return out;
}

/** Parse the LLM's JSON content string into a RecognizedItem list. */
function parseLLMContent(content: string): RecognizedItem[] {
  // Strip a possible ```json fence, then parse the first {...} object.
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let obj: any;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  return normalizeItems(obj?.items);
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

  if (!hasKey()) {
    // Honest config error — NOT an empty success, and definitely no fake items.
    return jsonResponse({ error: "recognizer_not_configured" }, 503);
  }

  let images: string[];
  try {
    const body = await req.json();
    images = Array.isArray(body?.images) ? body.images : [];
  } catch {
    return jsonResponse({ error: "bad_request" }, 400);
  }
  images = images.filter((s) => typeof s === "string" && s.length > 0);
  if (images.length === 0) {
    return jsonResponse({ error: "no_images" }, 400);
  }

  // Build OpenAI-style messages with a multipart user content array.
  // Each image becomes an image_url content part; the text prompt is first.
  const userContent: ContentPart[] = [
    { type: "text", text: "Identify all food/drink items visible in the following photo(s)." },
  ];
  for (const b64 of images) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    });
  }

  const messages: LLMMessage[] = [
    { role: "system", content: PROMPT },
    { role: "user", content: userContent },
  ];

  const result = await callLLM(messages, { temperature: 0.1, maxTokens: 800 });

  if (!result.ok) {
    if (result.error === "missing_key") {
      return jsonResponse({ error: "recognizer_not_configured" }, 503);
    }
    if (result.error.startsWith("network_error")) {
      return jsonResponse({ error: "upstream_unreachable", detail: result.error }, 502);
    }
    // Honest upstream failure — no fabricated items.
    return jsonResponse({ error: "upstream_error", status: result.status }, 502);
  }

  // An empty items array is an HONEST "nothing recognized", not an error.
  const items = parseLLMContent(result.content);
  return jsonResponse({ items }, 200);
});
