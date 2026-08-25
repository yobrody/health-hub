# Moat, distribution & audience — the plan

Honest, specific, and tied to what we can actually do. Pairs with
`2026-08-24-investor-metrics.md` (the metric definitions) and
`2026-08-23-yc-strategy.md` (the positioning). This is the *how we win + how we
grow + who for*.

---

## PART 1 — MOAT (why a funded competitor can't just copy us)

A moat is not one thing; it's layers that compound with usage. Ours, weakest → strongest:

### 1. Compounding per-user data (the real long-term moat)
Every use teaches the app your kitchen, tastes, routine, portion sizes, what you
actually cooked vs skipped. After a month it plans better *for you* than any
fresh competitor can — and re-teaching a new app is the switching cost. **Action
to deepen it:** persist and use the signal (accepted vs swapped meals, re-buys,
which gaps got carted) so the plan visibly improves week over week; make "it
knows me" a felt experience, not a claim.

### 2. Honesty → trust → permission to be an agent (hard to copy)
People will only hand an agent their food/money if they trust it. Our spine —
never show a guessed number — builds that trust. A competitor that fabricates to
look smart loses it. **Action:** keep honesty visible (the `~`, the `—`, the
"couldn't plan" states) and make it a stated brand value; trust is marketing.

### 3. The closed-loop integration + grocery relationships
plan → buy → deduct → reorder is engineering-deep and gets deeper with each
integration (Instacart Connect, then more retailers). Partner APIs + affiliate
relationships are a moat incumbents-of-one-piece (a tracker, a delivery app)
aren't incentivized to build. **Action:** land the Instacart Connect integration;
each retailer added widens it.

### 4. Habit / frequency lock-in
A weekly plan + a grocery run you already do = the app embeds in an existing
routine. Habits are their own moat (see retention below).

### Honest non-moats (say so plainly)
- **Not** a patent or secret model — we run on commodity LLMs behind a swappable
  seam (that's a *feature* for cost, not a moat).
- Early on the moat is **thin** (wrapper risk); it thickens with data + trust +
  integrations + brand. Investors respect founders who name this accurately.

### The one-line moat pitch
*"The longer you use it, the better it knows your kitchen and the more of your
food life it runs — and you have to trust it to let it, which is a brand you
can't clone."*

---

## PART 2 — AUDIENCE (who, precisely)

### The wedge ICP (start narrow — this is who we build + market for first)
**Goal-driven eaters who already try and fail at nutrition.** Concretely:
- On a specific goal: **muscle gain, fat loss, or a health flag** (pre-diabetic
  / blood-sugar, high-protein, etc.). They have a number to hit and feel the miss.
- Already *doing the work badly*: they own MyFitnessPal, follow fitness creators,
  buy protein — high intent, high frustration, low system.
- Cook or assemble most meals at home (the loop needs a kitchen).
- Comfortable with an app doing more for them (the "let AI handle it" mindset).

Why this wedge: **highest compliance intent + clearest success metric + they'll
tolerate a v1**, which is exactly Seibel's "hair on fire" test. They're also the
loudest sharers when something works (transformations, PRs).

### The expansion audience (later — do NOT market to them yet)
- **Busy households / parents** ("what's for dinner + the grocery run") — huge,
  but a *vitamin* for them until the wedge proves the loop. This is the "moms"
  audience from the brand brief; it's expansion, not entry.
- **General "eat better" mainstream** — the biggest market, reachable only after
  retention is proven on the wedge.

### Anti-audience (who we ignore for now)
Casual dabblers with no goal (they churn on motivation), and pure macro-nerds who
want a spreadsheet (they don't want an agent). Chasing them dilutes the wedge.

### Honest tension to hold
The premium/"Apple-universal" brand instinct and the "next billion" framing both
pull wide. **Resolve it by sequencing:** win the goal-driven wedge first (narrow,
provable), then expand to households, then mainstream. Aspirational quality,
delivered to a sharp segment first.

---

## PART 3 — DISTRIBUTION (how we actually get users)

Ranked by fit for a solo founder pre-PMF. **Organic-first — YC distrusts consumer
apps that only grow by buying users.**

### Phase 0 — the first ~50 (this week, for retention data)
- **Personal network + warm intros** — the launch email (drafted) + DMs.
- **Where the wedge already gathers:** r/fitness, r/nutrition, r/loseit,
  r/gainit, r/mealprep; fitness Discords; X fitness/AI communities. Post the
  *honest* value + a direct link; ask for brutal feedback, not praise.
- Goal: 50 real users, one usage cycle, **D-7/D-28 in PostHog**. This is the gate.

### Phase 1 — the organic growth loop (the engine)
- **Shareable honest artifacts:** the weekly recap + the transformation roadmap
  ("here's my real week / my real trend") → a share → install loop. Build a
  one-tap "share my week" that produces an on-brand image. *This is the highest-
  leverage growth build after retention is proven.*
- **Content from real (anonymized) data:** "what a week of hitting 155g protein
  from your own kitchen actually looks like." SEO + social. Use Ahrefs/Semrush
  (connected) to target real search demand.
- **Referral incentive** once there's a Pro tier (give a month, get a month).

### Phase 2 — scalable channels (only after the loop + retention work)
- **SEO / content** at scale (recipes → plan, "meal plan for X goal").
- **Creator partnerships** — fitness/nutrition creators demo the loop (aligned
  audience, performance-based).
- **App Store** (once Apple clears) — ASO on "meal planner / grocery" intent.
- **Paid** — last, and only against a known LTV.

### Distribution moat-in-the-making
The share loop + the SEO content compound; a competitor buying users pays every
time, we earn them once. That's the growth-side counterpart to the data moat.

### What NOT to do
Paid acquisition before retention is proven; broad mainstream marketing before
the wedge converts; launching everywhere at once (dilutes the feedback signal).

---

## The single sequence
1. **This week:** ship the app to ~50 wedge users → measure D-7/D-28 (infra ready).
2. **On signal:** build the "share my week" growth loop + start SEO content.
3. **Then:** creators + App Store + (only then) paid.
Moat deepens automatically as usage + integrations + trust accrue — our job is to
get the usage started and make the data/trust visible.
