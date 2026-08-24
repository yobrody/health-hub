# Investor metrics & questions — the thorough list (be ready for every one)

Everything an investor / YC will press on, with our honest answer, status
(✅ have · 📊 needs real data · 🟡 model/decision), and how we get it. Pair with
`2026-08-24-deck-readiness.md`. **Rule: never state a guessed metric as real —
model it and label it a model.**

## Pain point — and is it strong enough?
- **What:** how acute, frequent, and universal the problem is (painkiller vs vitamin).
- **Our answer:** eating well is **daily, universal, expensive** (a nutritionist is
  $150–500/mo), **high-failure** (~90% plan dropout), and **wasteful** (30–40% of
  food bought is thrown out). For our **wedge — goal-driven eaters** (gain/cut/
  blood-sugar) it's a painkiller: they're already trying and failing at exactly
  this. **Honest caveat:** for the *general* population it can read as a vitamin
  (nice-to-have) — which is why the wedge matters and why **retention is the real
  proof** the pain is strong enough. The historical killer of health apps is
  motivation-decay churn; our antidote is the **utilitarian grocery loop** (you
  shop every week regardless), which is stickier than motivation-based tracking.
- **Status:** 📊 strength = provable only by retention. The 40% "very disappointed"
  test (below) is the direct measure.

## Moat / defensibility
- **What:** why a well-funded competitor can't just copy you.
- **Our answer, honestly layered:**
  1. **Compounding per-user data** — the longer you use it, the better it knows
     your kitchen, body, tastes, routine → rising switching cost. This is the
     real long-term moat.
  2. **Honesty → trust** — a brand users trust to run their food is hard to copy;
     trust is the permission to be an agent.
  3. **Closed-loop integration + partnerships** — plan→cart→deduct→reorder is
     engineering-deep, and grocery/delivery partnerships (Instacart etc.) compound.
- **Honest weakness to own in the room:** early on the moat is **thin** (wrapper
  risk) — it deepens with data, integrations, and brand. It's a compounding-
  data + execution + trust moat, **not** a patent. Say that plainly; founders who
  over-claim a moat lose credibility.
- **Status:** ✅ articulable now; deepens with usage.

## North-star metric (what predicts long-term success)
- **What:** the one number that, if it goes up, the business wins.
- **Our pick:** **weekly food-decisions removed per active user** — meals auto-
  planned + carts auto-filled + reorders that actually happened. It captures
  *value delivered* AND correlates with retention. Simpler public proxy: **% of
  weekly-active users who complete the plan→cart loop.**
- **Long-term target to state:** e.g. *D-28 retention > 40%, ≥60% of WAU complete
  the loop weekly, ≥30% of new users organic.* (State as targets, not facts.)
- **Status:** 🟡 define + instrument at launch (analytics deferred to release).

## Product-market fit (PMF)
- **What:** are people pulling the product out of your hands?
- **Measures:** (1) **Sean Ellis test** — ≥40% of active users say they'd be
  "very disappointed" without it; (2) a **retention curve that flattens** (not
  decaying to zero); (3) **organic** growth / word-of-mouth.
- **Our answer, honest:** **we do NOT have PMF yet** — we have a built, working
  product and a strong hypothesis. Claiming PMF pre-users is an instant
  credibility hit. The plan is to *earn the evidence* (below).
- **Status:** 📊 unproven; the ~50-user launch is the test.

## CAC (customer acquisition cost)
- **What:** $ to acquire one (activated) user.
- **Our answer:** **organic-first by design** — the shareable honest weekly recap /
  transformation drives a share→install loop, targeting a near-$0 blended CAC for
  the organic channel. Paid is *not* the early plan (YC distrusts consumer apps
  that only grow by buying users). If we ever pay: consumer-health benchmarks run
  ~$2–10 per install / ~$20–60 per activated user — but we don't pay yet.
- **Status:** 📊 needs a live channel; the org-loop % is the number to show.

## LTV (lifetime value)
- **What:** total gross profit from an average user.
- **Model:** `LTV = ARPU × gross-margin × avg-lifetime (≈ 1/monthly-churn)` +
  grocery/affiliate revenue per active user. Illustrative (label as a model):
  Pro **$8/mo × ~85% margin × (1 / 5% churn = 20 mo) ≈ $136** software LTV, plus
  affiliate on the cart. LLM cost per user is **cents/month** (OpenRouter Gemini
  Flash), so margins are high.
- **Status:** 🟡 model now; real once price + churn are measured.

## Churn
- **What:** % of users who stop each month (the inverse of retention).
- **Our answer:** the #1 risk metric for a health app. Target **< 5%/mo** for
  engaged users (implies strong D-28). Our structural anti-churn is the grocery
  loop (recurring, utilitarian). If churn is high, the pain wasn't strong enough
  or the loop isn't closing — we'd fix the loop, not add features.
- **Status:** 📊 the single most important number to earn at launch.

## Equity / dilution
- **What:** how much of the company you give up.
- **The YC standard deal:** **$125K for 7%** on a post-money SAFE **+ $375K on an
  uncapped MFN SAFE** = **$500K total** (the "$125K/7% + $375K" structure).
- **Rough trajectory (model your own cap table):** post-YC ≈ **7%** out; a seed
  round typically another **~15–20%**; set a **~10% option pool**. As a solo
  founder with no co-founder split, you keep a large majority into Series A —
  that's an *advantage* to state, not a liability.
- **Status:** ✅ know the standard; 🟡 build the cap-table model before raising.

## The other questions they'll ask (have a one-breath answer)
- **Why hasn't Instacart / MyFitnessPal built this?** — trackers monetize logging
  work; Instacart monetizes carts, not knowing *you*. Neither is incentivized to
  close the *loop*; we're loop-native.
- **Why you?** — built the whole thing solo, dogfood it daily, honesty is the spine.
- **How do you get to $100M?** — a mass daily behavior (food) × a Pro subscription
  + grocery take-rate; even a small % of grocery spend is large.
- **What's the hardest part?** — retention (making it a habit) + recognition
  accuracy. Answer with the loop (habit) + the confirm-before-save honesty guard.
- **Data privacy (health data)?** — per-user Postgres with RLS (enabled+forced),
  offline-first (data on-device), minimal collection, never sold; write the ToS +
  privacy policy before launch.
- **Legal / medical claims?** — descriptive, **never medical advice**; ship a
  clear disclaimer.

## The single gate
All the 📊 items collapse to one action: **launch to ~50 organic users and run one
real usage cycle.** That turns pain-strength, PMF, CAC, LTV, and churn from
hypotheses into numbers — and it's worth more than any feature.
