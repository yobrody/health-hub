// plan-week — Supabase Edge Function (Deno).
//
// The agentic "plan my week" brain. Given the user's real nutrition goals + what
// is actually in their pantry, the LLM (via OpenRouter, model via OPENROUTER_MODEL,
// default google/gemini-2.5-flash) returns a 7-day meal plan whose meals prefer
// ingredients the user already has and whose daily totals aim at the goals. The app
// then diffs the plan's ingredients against the pantry (neededIngredients) to build
// the grocery cart.
//
// HONESTY (load-bearing — the app's spine):
//  • Meals are ESTIMATES. Any macro the model can't estimate is null — NEVER a
//    fabricated 0 or an invented precise number.
//  • The plan is grounded in the goals + pantry the caller passes; the prompt
//    forbids inventing exotic ingredients and tells it to lean on the pantry.
//  • On any upstream/parse error we return an honest error status and NO plan —
//    never a fabricated fallback week. The app falls back to "couldn't plan".
//
// Auth: per-user action → the caller's JWT is required (Edge runtime enforces it
// when deployed with JWT verification on; asserted defensively here).
//
// Deploy (OPENROUTER_API_KEY must be set as a function secret on the Health Hub project):
//   npx supabase functions deploy plan-week --project-ref eazwtlqieizvsqvbbknj

// deno-lint-ignore-file no-explicit-any

import { callLLM, hasKey, type LLMMessage } from "../_shared/llm.ts";
import { reportError } from "../_shared/sentry.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_DAYS = 7;
const SLOTS = ["breakfast", "lunch", "dinner", "snack"];

const PROMPT = `
You are a practical meal planner. You are given a person's daily nutrition goals
and a list of what is currently in their kitchen (pantry). Produce a realistic
plan of DAYS of meals that:
- aims each day's TOTAL calories and macros at the goals (get close; exact is not
  required),
- PREFERS ingredients the person already has in their pantry, and only adds
  common, easy-to-buy ingredients when needed,
- uses simple, real meals a normal person would actually cook or assemble.

These macro numbers are ESTIMATES, not measurements. Rules, followed exactly:
- Each meal has: "name" (short, e.g. "Chicken & rice"), "slot" (one of
  breakfast, lunch, dinner, snack), "kcal", "protein_g", "carbs_g", "fat_g", and
  "ingredients" (a list of {"name","grams"}).
- For any macro you cannot reasonably estimate, return null for THAT value. Do
  NOT guess a precise number you have no basis for. Never fabricate a 0 to fill a
  gap.
- For an ingredient whose amount you cannot sensibly quantify (e.g. "a pinch of
  salt"), return null for its "grams". Never invent a precise gram amount.
- Do NOT invent exotic or hard-to-buy ingredients. Keep it grounded and normal.
- Return "confidence" (0..1) and an optional one-sentence "note".

Respond with STRICT JSON ONLY, no markdown, in exactly this shape:
{"days":[{"meals":[{"name":"...","slot":"breakfast","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"ingredients":[{"name":"...","grams":0}]}]}],"confidence":0.0,"note":null}
`.trim();

interface PlanIngredient {
  name: string;
  grams: number | null;
}
interface PlanMeal {
  name: string;
  slot: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  ingredients: PlanIngredient[];
}
interface PlanDay {
  meals: PlanMeal[];
}
interface WeekPlan {
  days: PlanDay[];
  confidence: number;
  note: string | null;
}

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

function normalizeIngredient(raw: any): PlanIngredient | null {
  const name = nonEmptyString(raw?.name);
  if (!name) return null; // an ingredient with no name is meaningless — drop it.
  return { name, grams: macro(raw?.grams) };
}

function normalizeSlot(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return SLOTS.includes(s) ? s : "snack";
}

function normalizeMeal(raw: any): PlanMeal | null {
  const name = nonEmptyString(raw?.name);
  if (!name) return null; // a nameless meal is dropped, not fabricated.
  const ingredients = Array.isArray(raw?.ingredients)
    ? raw.ingredients.map(normalizeIngredient).filter((x: unknown): x is PlanIngredient => x !== null)
    : [];
  return {
    name,
    slot: normalizeSlot(raw?.slot),
    kcal: macro(raw?.kcal),
    protein_g: macro(raw?.protein_g),
    carbs_g: macro(raw?.carbs_g),
    fat_g: macro(raw?.fat_g),
    ingredients,
  };
}

function normalizePlan(raw: any): WeekPlan | null {
  const rec = (raw && typeof raw === "object") ? raw : {};
  const rawDays = Array.isArray(rec.days) ? rec.days.slice(0, MAX_DAYS) : [];
  const days: PlanDay[] = rawDays
    .map((d: any) => ({
      meals: Array.isArray(d?.meals)
        ? d.meals.map(normalizeMeal).filter((x: unknown): x is PlanMeal => x !== null)
        : [],
    }))
    .filter((d: PlanDay) => d.meals.length > 0);
  if (days.length === 0) return null; // no real day of meals → honest failure.
  return { days, confidence: clampConfidence(rec.confidence), note: nonEmptyString(rec.note) };
}

/** Parse the LLM's JSON content string into a WeekPlan. */
function parseLLMContent(content: string): WeekPlan | null {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: any;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  return normalizePlan(obj);
}

function describeGoals(g: any): string {
  if (!g || typeof g !== "object") return "No explicit goals given.";
  const bits: string[] = [];
  if (macro(g.calories_kcal) !== null) bits.push(`${g.calories_kcal} kcal/day`);
  if (macro(g.protein_g) !== null) bits.push(`${g.protein_g} g protein/day`);
  if (macro(g.carbs_g) !== null) bits.push(`${g.carbs_g} g carbs/day`);
  if (macro(g.fat_g) !== null) bits.push(`${g.fat_g} g fat/day`);
  return bits.length ? bits.join(", ") : "No explicit goals given.";
}

function describePantry(p: any): string {
  if (!Array.isArray(p) || p.length === 0) return "Pantry is empty/unknown.";
  return p
    .map((it: any) => {
      const name = nonEmptyString(it?.name);
      if (!name) return null;
      const qty = macro(it?.qty);
      const unit = nonEmptyString(it?.unit);
      return qty !== null && unit ? `${name} (${qty} ${unit})` : name;
    })
    .filter((s: unknown): s is string => !!s)
    .join(", ");
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    if (!hasKey()) {
      return jsonResponse({ error: "planner_not_configured" }, 503);
    }

    let goals: any = null;
    let pantry: any = null;
    let days = MAX_DAYS;
    let prefs: string | null = null;
    try {
      const body = await req.json();
      goals = body?.goals ?? null;
      pantry = body?.pantry ?? null;
      if (typeof body?.days === "number" && body.days >= 1 && body.days <= MAX_DAYS) {
        days = Math.floor(body.days);
      }
      prefs = nonEmptyString(body?.prefs);
    } catch {
      return jsonResponse({ error: "bad_request" }, 400);
    }

    const userText = [
      `Plan ${days} day(s) of meals.`,
      `Daily goals: ${describeGoals(goals)}.`,
      `Pantry (prefer these): ${describePantry(pantry)}.`,
      prefs ? `Preferences/dislikes: ${prefs}.` : "",
    ].filter(Boolean).join("\n");

    const messages: LLMMessage[] = [
      { role: "system", content: PROMPT },
      { role: "user", content: userText },
    ];

    const result = await callLLM(messages, { temperature: 0.3, maxTokens: 4096 });

    if (!result.ok) {
      // Map the helper's failure class to the same honest statuses as before.
      if (result.error === "missing_key") {
        return jsonResponse({ error: "planner_not_configured" }, 503);
      }
      if (result.error.startsWith("network_error")) {
        return jsonResponse({ error: "upstream_unreachable", detail: result.error }, 502);
      }
      return jsonResponse({ error: "upstream_error", status: result.status }, 502);
    }

    const plan = parseLLMContent(result.content);
    if (!plan) {
      return jsonResponse({ error: "no_plan" }, 502);
    }

    return jsonResponse(plan, 200);
  } catch (err) {
    // Unexpected throw — report to Sentry (no-op when DSN absent) and return an
    // honest 500. Response shape and status are NOT changed for handled errors above.
    await reportError(err, { function: "plan-week" });
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
