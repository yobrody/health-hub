# Implementation plan — the agentic food loop

Turns the **Brain** from advisor into **operator**, per the YC strategy
(`2026-08-23-yc-strategy.md`). The headline capability:

```
Snap fridge → AI plans the week to your goals + existing pantry
   → auto-builds the grocery cart (only the gaps)
   → one-tap order (Instacart hand-off)
   → deduct pantry as eaten → reorder before you run out
```

## What already exists (reuse — do NOT rebuild)

| Piece | Where | Reuse for |
|---|---|---|
| Photo → pantry recognition (Gemini edge fn, live) | `supabase/functions/recognize-pantry` | "what's in your kitchen" input |
| Pantry model + repo (zones, qty, expiry) | `lib/pantry/` | plan grounding + deduction |
| Nutrition goals (kcal/macros) | `lib/nutrition/…goals` | plan target |
| Grocery list repo + Outbox sync | `lib/…grocery` + `SupabaseSyncSender` | the auto-built cart |
| Instacart hand-off (deep-link / list; API-key-gated) | `supabase/functions/instacart-cart` + `InstacartClient` | one-tap order |
| Eat-in deduction (`EatInService.eatMeal`) | `lib/…eat_in` | deduct-as-eaten |
| Reorder cadence (median of real re-buys) | `lib/pantry/purchase_history.dart` | reorder-before-out |
| Gemini edge-fn pattern (Deno, JWT, honest nulls) | `estimate-nutrition` | the meal-plan fn |

The loop is mostly **wiring existing rails** + one new brain (the planner).

## New pieces

1. **`plan-week` edge function** (Deno + Gemini, JWT, mirrors estimate-nutrition):
   input = goals (kcal/macros) + pantry items + optional prefs/dislikes;
   output = a 7-day plan of meals (each: name, kcal, macros, ingredients w/
   grams) **honestly tagged** (`~` estimate tier, never fabricated micros) +
   a **needed-ingredients** list = plan ingredients minus what the pantry
   already covers. Prompt forbids inventing foods the user can't get and must
   return `confidence`; unavailable → honest "couldn't plan, here's why".
2. **`MealPlan` model + repo** (`lib/nutrition/plan/`): 7 days × meals, PK
   `plan-<uid>-<isoWeek>`, synced via the Outbox rails (path `/meal-plans`).
   Pure `neededIngredients(plan, pantry)` (tested) = the gap set.
3. **Plan UI** (`lib/pages/plan_page.dart` or a Home entry): "Plan my week" →
   loading → editable plan (accept / swap a meal / regenerate) → "Add gaps to
   cart" (writes the grocery list via the existing repo). Confirm-before-order
   preserved; honest empty/needs-goal states (reuse the Transformation-style
   needs-data cards).
4. **Loop close**: logging a planned meal deducts pantry (existing eat-in path,
   extended to accept a plan line); reorder-cadence already flags "buy before
   out" into the Brain BUY insights.

## Honesty gates (health-hub-reviewer will check)

- No meal/number shown that isn't grounded in the plan output; missing goal →
  "set your goal", never a guessed plan.
- Estimated macros tagged `~`; micros the model didn't give → `—`, never 0.
- "Needed ingredients" must be a real diff against real pantry qty — never a
  guess; if pantry unknown, say so.
- Order step never claims a purchase happened; confirm-before-hand-off stays.

## Build order (each = its own commit, TDD, then bug-hunter + health-hub-reviewer)

1. Pure `neededIngredients(plan, pantry)` + `MealPlan` model — tests first.
2. `MealPlan` repo + Outbox `/meal-plans` sync + hydrator pull.
3. `plan-week` edge fn (code + deploy when GEMINI key confirmed; fake
   `MealPlanClient` seam so the app + tests run without the live fn).
4. Plan UI (generate → edit → accept) on the design system, one orange primary.
5. "Add gaps to cart" wiring (grocery repo) + plan-line eat-in deduction.
6. Golden screens for the plan flow (empty / generated / gaps-added).
7. Live-smoke the edge fn (admin user → invoke) once deployed.

**First shippable slice = steps 1–2 + 4 behind the fake client** (real,
testable "plan my week → gaps to cart" with a deterministic fake planner),
then swap in the live Gemini fn (step 3) + smoke.

## Analytics (step 3 of the YC sequence — separate follow-up)

Instrument retention after the loop lands: a small honest event sink (Supabase
table `events` via the Outbox, or a privacy-first provider) capturing
plan-generated / gaps-added / order-handoff / meal-logged / active-day — enough
to compute D1/7/30 + DAU/MAU + loop-completion. Decision to surface then:
self-hosted Supabase events vs a provider (PostHog). Health data stays on-device
/ RLS; events are minimal + non-PII.
