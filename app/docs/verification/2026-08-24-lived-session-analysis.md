# Lived-session analysis — using the app as a real user (2026-08-24)

Drove the loop the way a user actually would: a returning user with a goal
(2600 kcal / 155 g protein) and a real kitchen (chicken, Greek yogurt, oats,
brown rice, eggs, olive oil, frozen broccoli, bananas) taps **Plan my week** →
the **live** `plan-week` function (real Gemini, authed round-trip) returns a
3-day plan → the app's real `neededIngredients` builds the shopping list. Then
analyzed the result from the perspectives that matter most.

**Live plan (real, 3 days):**
- Day 1 **2497 kcal / 151.5 g protein**, Day 2 **2398 / 139.7**, Day 3 **2708 /
  145.6** — all within ~8% of the 2600 target. Grounded, realistic, uses the
  pantry (chicken & rice bowls, oats & yogurt, eggs & rice).

## The 6 perspectives

### 1. Honesty & trust (the app's spine) — a real bug found + FIXED
The shopping list the app produced from the live plan had **2 of 5 items wrong**:
it told the user to buy **"banana"** (they have Bananas ×4) and **"brown rice
(dry)"** (they have Brown rice 1200 g). Cause: Gemini writes qualified/plural
names (`Brown rice (cooked)`, `Banana`, `Milk (2%)`) while the pantry says
`Brown rice` / `Bananas`, and `neededIngredients` matched by **exact** normalized
name → false gaps. This silently breaks the load-bearing promise *"the rest is
in your kitchen."*
**Fixed this session:** `_norm` now strips parenthetical qualifiers and folds
simple plurals, so `Brown rice (cooked)` ≡ `Brown rice` and `Banana` ≡
`Bananas`. Re-verified: the list collapses to only the genuinely-absent items.
The correct items were already right (chicken 700 g needed vs 500 g on hand →
**SHORT**, milk + tuna → real gaps).

### 2. Core-loop integrity (does eat → plan → cart → deduct close?)
- plan → cart: **now accurate** (post-fix).
- **Gap:** logging a *planned* meal does not yet deduct the pantry — the "deduct
  as you eat / reorder before you run out" arrow of the loop is not wired to
  plan lines yet. This is the top remaining build (below).

### 3. Nutrition correctness
Daily totals track the goal honestly (within ~8%); protein runs slightly under
(140–151 vs 155). **Gap:** the plan UI shows per-*meal* kcal but no per-**day
total vs goal**, so the user can't see at a glance whether a day hits their
target — the data exists (sum of meals), it's just not surfaced.

### 4. The "aha" / can't-live-without (YC lens)
The differentiator works **for real, live**: an AI plan grounded in the user's
actual kitchen → an accurate "only the gaps" cart. That's the loop no tracker or
delivery app closes. Friction that dilutes the delight: no per-day totals, no
single-meal swap, no per-person/serving scaling.

### 5. First-run / new user
Planning is honestly gated behind a real goal ("set your goal first"). A brand-
new user with an empty pantry gets an all-gaps list — correct, but the copy "the
rest is in your kitchen" assumes a stocked kitchen; worth softening for empty
pantries.

### 6. Edge/failure & polish
Honest failure states present (planner-null, save error). The live fn is
JWT-gated. Golden review earlier confirmed premium look in both themes. AI
quirks observed and now tolerated: qualifier/plural name variance (fixed);
cooked-vs-dry gram basis (rice "cooked" grams vs a dry pantry qty) — coverage
still resolves correctly (present ⇒ covered, no nag); exact shortfall grams for
cooked-vs-dry could mislead, low priority.

## Prioritized actions
1. ✅ **DONE — robust ingredient matching** (the false-gap honesty bug).
2. **Plan-line eat-in deduction** — log a planned meal ⇒ deduct its pantry
   ingredients (closes the loop's deduct arrow). *Next build.*
3. **Per-day total vs goal** on the plan (kcal + protein) — data already exists.
4. Empty-pantry copy; later: single-meal swap, per-person scaling, cooked/dry
   gram basis.
