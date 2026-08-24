# Pitch-deck readiness — every question we must answer

The deck (`2026-08-24-pitch-deck.md`) is NOT ready: it has `[bracket]`
placeholders and three open decisions. This is the full checklist to make it
real — grounded in the YC research (`2026-08-23-yc-strategy.md`). Three buckets:
**✅ answerable now**, **📊 needs real data (traction)**, **�decision needed**.

## Every question a deck + YC application + interview must answer

### Product & insight
- ✅ What do you make? (one-liner) — *"Your AI nutritionist that plans, shops,
  and restocks your food — automatically."*
- ✅ What's the mechanism? — snap → plan → cart → order → deduct → reorder.
- ✅ What do you understand that others don't? — the **loop**: plans fail on
  plan↔kitchen friction, not willpower; close plan→buy→eat→deduct→re-plan.
- ✅ What's new / unfair advantage? — the only one that closes the whole loop
  from a real fridge to a filled cart; honesty → trust; data compounds.
- ✅ Live demo? — the loop works end-to-end (verified live 2026-08-24).

### Market & why-now
- ✅ Why now? — vision + grocery APIs + real-time LLM planning just converged.
- ✅ Who's the customer? — wedge: goal-driven eaters (gain/cut/blood-sugar). *(Sharpen the ICP to one sentence.)*
- ✅ Competition, why you win? — named table (MFP / Instacart / ChatGPT); Fitia/Nourish/SnapCalorie/Vora precedent.
- �decision — **market-size framing** (via pain, not TAM/SAM/SOM — but have one credible top-down number ready if asked).

### Traction — 📊 THE GAP (≈0 real users today)
- 📊 How many users? weekly-active? — need a launch.
- 📊 **Organic D-7 / D-28 retention** (came back without a push) — the metric YC weights for a weekly product.
- 📊 Week-over-week active growth %.
- 📊 Word-of-mouth % / unprompted referrals.
- 📊 Loop depth — snaps/wk, plan→cart completion, reorder rate.
- 📊 Revenue / willingness-to-pay signal.

### Business
- ✅ How do you make money? — free core; grocery/affiliate on the cart; Pro tier; partnerships.
- �decision — **exact pricing** (Pro $/mo).
- 📊 Unit economics (CAC / LTV) — estimate once there's a channel + a price.
- 📊 Path to **default-alive** — runway math once infra cost + price are known.

### Team
- ✅ Who are you, why you? — solo technical founder, built it all, dogfoods daily.
- �decision — **solo vs co-founder** (address offensively either way; note the hiring plan).

### Product / ops / legal
- ✅ What's built vs planned? — full working app + the live loop; analytics + polish remain.
- ✅ Moat / defensibility? — per-user grounded data compounds + honesty-as-trust.
- �decision — **health-claims / liability** stance (stay descriptive, never medical — write the one-liner).
- �decision — **data privacy** answer (per-user RLS, offline-first, health data minimization) — have a crisp statement.

### The three blocking decisions
1. � **Name + domain + icon** — still parked (Sunloe rejected). A named product ships better than "Health Hub" (generic, likely taken). Re-run the free naming sweep (USPTO TESS + domain check) on a new direction, then commit.
2. � **Pricing** — pick a Pro price to state (and test).
3. � **Production LLM provider** — the snap-to-plan foundation (below). Decide + implement.

## What else to expect (interview + diligence)
- **The 10-minute YC interview is rapid-fire.** Partners interrupt and probe the
  *founder's* understanding, speed, and user-obsession. Anticipate: "Why will
  this work when others failed?" · "What's the hardest part?" · "Why hasn't
  Instacart/MyFitnessPal built this?" · "What have you learned from real users?"
  (⚠️ you need users to answer) · "What's your growth channel?" · "How do you get
  to $100M?" · "Why you?" Prep a one-breath answer to each (a mock-Q&A doc).
- **The 1-minute video** — solo, direct to camera, show the loop for ~15s.
- **Diligence** — incorporation, cap table, IP ownership (built solo = clean), a
  working live demo. Have the app deployed (GitHub Pages / a link) and stable.

## The best way to go about it (sequence)
1. **Fill every ✅ now** — the deck v1 already does; tighten the ICP + market line.
2. **Make the 3 decisions** — name, pricing, LLM provider (provider is
   implementable now; see below).
3. **Run the traction sprint** — the real gate. Launch to ~50 organic users
   (personal network, r/fitness, X), instrument D-7/D-28 + referrals, run one
   real usage cycle. Turn every 📊 into a real number. *This is worth more than
   any feature.*
4. **Write the mock-interview Q&A** + record the video + the 15-sec loop demo.
5. **Render the deck on-brand** (Creamsicle/Obsidian) once the numbers + name land.

---

## Long-term snap-to-plan: off the free/beta Gemini key

**Problem:** `recognize-pantry`, `estimate-nutrition`, and `plan-week` all use a
free Google AI Studio (`GEMINI_API_KEY`) — a personal, rate-limited, non-
production key. Not a foundation for real users.

**The asset that makes this easy:** all AI is already behind **edge functions +
client seams** (`MealPlanClient`, `NutritionEstimateClient`,
`PantryRecognitionClient`). Swapping the model = change the edge fn's HTTP call +
one secret. **The app never changes.** Snap-to-plan is not coupled to Gemini.

**Recommendation (tiered):**
1. **Now (dev/demo):** keep the free Gemini key — fine for building + a demo.
2. **Before real users (production) — the durable answer:** provision a **billed
   production key** and put a thin provider switch in the edge fns (read an
   `LLM_PROVIDER` secret; `callModel()` dispatches). Recommended primary:
   **Anthropic Claude (latest 4.x)** for the text jobs — **plan-week** and
   **estimate-nutrition** — because they are honesty-critical + structured, which
   is Claude's strength (and the house guidance is to default to the latest
   Claude for AI apps). Store `ANTHROPIC_API_KEY` as a Supabase secret; the
   client seams are untouched.
   - **Vision (recognize-pantry):** evaluate **Claude vision** vs a paid Gemini
     Vision key on real fridge photos; pick by accuracy. Keep it swappable.
3. **At scale (cost / "next billion"):** revisit cheaper or on-device models
   per-task; the seam already makes this a config change.

**Migration path (small, do before launch):** (a) get a billed provider key →
Supabase secret; (b) add `callModel()` behind `LLM_PROVIDER` in each edge fn
(default stays Gemini until proven); (c) `python supabase/smoke_edge.py plan-week
…` against the new provider; (d) flip the default; (e) keep the free key for
local dev. No app-side or schema changes.

**One-line answer for the deck/interview:** *"Our AI runs behind provider-agnostic
edge functions, so the model is a config choice — we run on a production LLM
(Claude) for quality + honesty, and can swap or go on-device for cost at scale."*
