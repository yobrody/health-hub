# Health Hub — pitch deck (v1, 2026-08-24)

Slide-by-slide content for the seed / YC deck. Structure follows the proven YC
seed order (purpose → problem → solution → why-now → market → product → model →
competition → traction → team → ask). Keep each slide to one idea, big type,
few words. Brand: Creamsicle (light) / Obsidian (dark), Fraunces display + Inter.
Grounded in `2026-08-23-yc-strategy.md` (v2) and the live loop verified
2026-08-24. Numbers in **[brackets]** are placeholders to fill with real data
before sending — do NOT ship guesses.

---

## Slide 1 — Title
**Health Hub**
*Your AI nutritionist that plans, shops, and restocks your food — automatically.*
[logo] · [founder name] · [email] · [date]
> Speaker note: say the one-liner out loud; it should land in 5 seconds.

## Slide 2 — The problem
**Eating well is a full-time job nobody has time for.**
- A nutritionist costs $150–500/mo — almost no one keeps one.
- Plans fail ~90% of the time: not from willpower, but **friction between the
  plan and the kitchen**. You still have to figure out meals, remember what's in
  the fridge, shop, and re-plan when life happens.
- People waste 30–40% of the food they buy and still miss their targets.
> Speaker note: this is a painkiller, not a vitamin — the pain is daily.

## Slide 3 — The insight (what we understand that others don't)
**Close the loop.**
Nutritionists hand you a plan and never see your fridge, your pantry, or what you
actually bought — so plan and reality drift apart within a week.
The unlock is the loop: **plan → buy → eat → deduct → re-plan**, grounded in
what's physically in your kitchen. No one closed it before because reliable
fridge-vision, programmatic grocery carts, and real-time per-person planning only
converged in the last ~18 months.

## Slide 4 — The solution
**An AI that runs your food life.**
1. **Snap your fridge** → it knows what you have.
2. **Plans your week** to your real goals, preferring what you already own.
3. **Fills your cart** with only the gaps → one tap to order.
4. **Deducts as you eat** and **reorders before you run out.**
Honest by design: it never shows a guessed number — estimates are marked, unknowns
say so. That's how you earn the trust to hand an agent the keys.

## Slide 5 — Product (show, don't tell)
**[Live demo / 15-sec loop video]**
Real screens (already built): snap → the weekly plan → the shopping list that
shows *only the gaps* ("the rest is in your kitchen") → add to cart. Premium,
calm, one clear action per screen.
> Speaker note: this is the strongest slide — play the real loop end-to-end.

## Slide 6 — Why now
**Three things just composed into a loop.**
- **Multimodal vision** identifies a pantry from a phone snap (not reliable pre-2023).
- **Grocery APIs** (Instacart Connect et al.) expose inventory + programmatic carts.
- **LLMs** generate and adapt a personal plan in real time — replacing the
  nutritionist's 45-minute consult, at ~zero marginal cost.
Each existed alone. Only now do they close the loop.

## Slide 7 — Market
**Everyone who eats and wants to eat better.**
- Entry wedge: goal-driven users (muscle gain / fat loss / blood-sugar) — highest
  compliance intent, clearest success metric.
- Expansion: the whole food-life OS (gym, transformation, coaching), then broader
  health. Show the market through the pain, not a TAM pie chart.
- "Democratize the nutritionist" — a $150–500/mo service made free and universal.

## Slide 8 — Business model
**Free grounded core (reach) → revenue on the loop.**
- Grocery / affiliate on the cart hand-off (Instacart et al.).
- **Pro** tier: the agentic auto-plan + deeper coaching.
- Later: brand / delivery / health partnerships.
> Willingness-to-pay: [cite the signal from real users before sending].

## Slide 9 — Competition (name them, win specifically)
| | Logs food | Knows your kitchen | Plans to your goal | Fills the cart | Closes the loop |
|---|:-:|:-:|:-:|:-:|:-:|
| MyFitnessPal / trackers | ✅ | ❌ | ❌ | ❌ | ❌ |
| Instacart / delivery | ❌ | ❌ | ❌ | ✅ | ❌ |
| ChatGPT meal plans | ❌ | ❌ | ~ | ❌ | ❌ |
| **Health Hub** | ✅ | ✅ | ✅ | ✅ | ✅ |
We're not a better tracker — we're the agent that runs the loop the trackers
create work for. Precedent that this is fundable & huge: **Fitia** (YC S21,
"democratize the nutritionist," 10M+ users), **Nourish** (W21), **SnapCalorie**
(S21), **Vora** (W25).

## Slide 10 — Traction
**[Fill with REAL numbers — this is the gating slide before applying.]**
Target the metrics YC weights for a weekly-cadence product:
- **Organic D-7 / D-28 retention** [x% / y%] (came back without a push).
- **Week-over-week active growth** [z%] on [base].
- **Unprompted referrals** [k].
- **Loop depth**: snaps/wk, plan→cart completion, reorder rate.
What's built today: full working app (Flutter, web + Android), the honest Brain,
photo→pantry (live), the plan→cart loop (live, verified end-to-end), Supabase +
RLS + offline sync, **[N] automated tests**.
> Honest note: real usage data > a polished app. Get ~50 organic users first.

## Slide 11 — Team
**[Founder]** — built the entire working app solo (Flutter web+Android,
Supabase-direct + RLS, the full eat→plan→cart loop, [N] tests). Team-speed
execution; dogfoods it daily. Hiring [roles] post-funding.
> Address solo-founder offensively: lead with what shipped and how fast.

## Slide 12 — The ask / vision
**[Raising $X] to get to [milestone: N users / default-alive].**
Vision: the app hundreds of millions can't live without — the one that thinks
about their food so they don't have to. Aspirational quality, universal access.
[email] · [link to the live app]

---

### Deck-craft checklist (before sending)
- One idea per slide, big type, ≤ ~20 words; the loop video is the centerpiece.
- Replace every **[bracket]** with a real number or cut it — never a guessed metric.
- 1-min founder video: solo, direct to camera, show the loop working for ~15s.
- Render on-brand (Creamsicle/Obsidian, Fraunces/Inter). Can be produced as a
  branded HTML/PDF deck from this content on request.
