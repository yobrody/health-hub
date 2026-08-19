# Health Hub — North-Star Design (v1.1, 2026-08-19)

> Status: **FINAL.** All decisions locked; completeness pass folded in. One app: **"Health Hub."** Single-user now; social deferred behind a clean seam (§14). Roadmap in §12 is the ordered build plan.
> **Locked:** Flutter (+ **3D low-poly avatar** — glTF morph-targets, NOT Rive/2D; decided 2026-08-19) · ingredient-graph model = yes · destination "C" (proactive daily plan on cross-linked sections, plumbing-first) · clean rewrite (current React/PWA retired).

## 0. The goal
Make Health Hub feel **alive** and fully **interconnected**: gym ↔ nutrition ↔ food/pantry ↔ shopping ↔ reorder all read/write one shared state, in service of one thing — getting Brody to his physique goal **as fast as honestly possible**. Honesty rule is inviolable (`health-hub-reviewer`): never show guessed/default/stale data as real; a missing signal degrades to `—`/`~` with a note — never fabricated.

Destination = **C: a proactive daily plan on top of cross-linked sections**, built **plumbing-first**.

## 1. Platform — a real native mobile app: Flutter
Native for **iPhone + Android**. Framework = **Flutter** (clean rewrite; React/PWA retired) — best-in-class animation smoothness (Impeller) for an animation-heavy app, pixel-identical cross-platform, unified `health` package. Dart is written by the AI builder, so language is a non-factor.
- **Avatar tech = 3D low-poly** (LOCKED 2026-08-19; NOT Rive/2D) — AI-generated low-poly body **+ clothing** with **glTF morph-targets**, rendered via a Flutter 3D path (`flutter_scene`/`flutter_3d_controller`), driven by real `PhysiqueState` (§3). Morph-targets power the cosmetics fit-engine. Best-AI-generator research (Meshy/Tripo/Luma/Rodin) owed at P4 start.
- **Backend stays** FastAPI on lucky-vps. Rebuild the offline queue in Dart.
- **Location** (consent-gated) powers location-aware reorder (§7) + gym research (§9).
- **Richer Health import** (one permission): **steps, sleep, active energy (→ TDEE), resting HR + HRV (→ readiness), body weight, body-fat (smart scale), logged workouts.**
- **Native extras:** home-screen **widgets** (Today plan / rings). Apple Watch app deferred (§14).
- **Rewrite discipline:** re-implement pure logic (gym progression, TDEE, readiness, strength targets, ring math…) **test-first** in Dart — fix the "constantly broken" parts, don't port them.

## 2. Core architecture — one shared state, one loop
```
SIGNALS  →  BRAIN  →  DAYPLAN  →  ACTIONS  →  new SIGNALS
sleep/steps/energy     one reasoner   Train/Eat/Buy   log meal, finish set,
RHR/HRV/readiness       over all       (ordered, w/    buy item, snap photo
weight+measures+BF                     the WHY)
macro gap · pantry+£ · training history
```
The brain also runs a **periodic recalibration** (weekly): is goal pace on track? gaining too fast/slow → nudge the calorie target (ties in adaptive TDEE).

### Data model
1. **`Pantry`** — `{name, zone, qty, unit, expiry, price, store, purchasedAt, reorderCadenceDays, lastBought, source}`. **Keystone.** `reorderCadenceDays` derived from consumption.
2. **`MealComposition` / ingredient graph (§4b)** — home meal = `[{pantryItem, grams}]`. One graph, read two ways.
3. **`DayPlan`** — `{trainingFocus, meals[], macroTargets, buy[], reasons[]}`. Regenerated as signals change. Never fabricated.
4. **`ReorderIntent`** — `{item, qty, channel, reason, status}`. Never actioned without explicit checkout confirm.
5. **`PhysiqueState`** — weight + body-fat (if measured) + tape measurements + progression → avatar inputs.
6. **`SetEffort`** — per-set effort (angry/contempt/easy) → progression.
7. **`Spend`** (derived) — grocery spend + fridge value consumed + eating-out spend.
8. **`Recipe`** — user-created (reusable `MealComposition` + steps).
9. **`Program`** — training arc (§8): split, weekly progression, rest days, deloads.
10. **`ProgressPhoto`** — dated front/side/back photos (§3).

> **Social seam (§14):** every user-owned object reserves an owner/`userId` + private/shared flag; auth stays swappable (today: single-user `X-Health-Key`). Social can be added later **without a schema rewrite**.

### 4b. Ingredient graph — the keystone (LOCKED: yes)
Home meals = **compositions of pantry ingredients in grams**. Read → **suggests** ("can I make this from stock, given time/habits/DayPlan/workout?"); write → **deducts** ("ate this → remove grams → qty ↓, £ ↓, visual ↓") + computes macros. Eating-*out* stays a single estimated line. Powers suggestions, inventory, spend, macro accuracy, and shopping-gap detection.

## 3. Home screen — the living avatar (My Little Universe style, 3D low-poly) + progress photos
- **Center = a cute low-poly stylized character**, **morphing via a Rive state machine driven by `PhysiqueState`** (weight→size, body-fat→leanness, shoulder/waist→V-taper, progression→muscle). Deterministic, no AI. Unlockable **skins** as rewards.
- **Honesty:** "you now" reflects only measured data; missing measurements interpolate conservatively; no earned abs without a real body-fat reading.
- **Goal preview = one-time "prize":** seen once when you set/reset goals (reset lives in Settings §11), then hidden until reset. Day to day you watch *your* avatar move toward the remembered prize — rewarding the logging of weight/measurements; **we lean into that loop.**
- **Progress photos:** a dated **front/side/back photo timeline** — the honest, real-body counterpart to the stylized avatar. Private, local-first.
- **Progress meters** (gym · physique · nutrition) around the avatar.

## 4. The "Today" tab
- **Today tab above the avatar**; tapping slides a full-cover panel: **Train · Eat · Buy**, ordered by the brain, each with its **reason**. This is `DayPlan`, also fed to push + the home-screen widget.

## 5. Capture + nutrition — one camera, accuracy-tiered, in vs out
AI **pre-guesses type**; one-tap chip row corrects. Types: **Meal/Drink**, **Receipt** (→ Pantry w/ price/store/date + estimated expiry), **Shopping-list screenshot** (→ list).

**IN vs OUT (one-tap toggle):**
- **IN** → deducts the meal's ingredients from `Pantry` (qty↓, visual↓, £↓); macros from the ingredient graph.
- **OUT** → user types the **restaurant** + selects the **item** → searched, confirmed, calculated; tracked as **eating-out spend**. Exact not found → estimate the average, use the photo to refine, labelled `~`.

**Also:** one-tap **hydration/water**; **supplements** (protein/creatine/vitamins) as a light pantry+log category; **full edit/delete (CRUD)** on any past log; a **meal-schedule / eating window** so pre/post-workout timing advice (§8) is real.

### 5a. Accuracy — "down to the calorie", honestly
- **EXACT** — barcode (backbone) · **nutrition-label OCR** (*new, biggest win*) · **grams/ml entered** · **food-memory** (your own numbers) · **searchable food DB**.
- **ESTIMATE (`~`)** — the **Guess button** + eating-out average+photo. Always labelled; micros only when measured, else `—`. Optional **Bluetooth kitchen scale** for gram-exact input.

### 5b. Money / spend (+ budget enforcement)
Prices give pantry items value; consuming decrements fridge value; eating-out is its own line. **Spend summary** (week/month · groceries vs eating out) **+ enforced food budget** (GBP): monthly cap → warnings approaching, over-budget flag at reorder checkout (warns, never blocks).

## 6. Food section — walk-up UX
- **Shopping list:** standard **notepad UI**. Items stay put; nothing ordered until **Checkout tapped + confirmed**.
- **Fridge/pantry/freezer view:** each item's **visual changes as qty/freshness drops**; tapping **zooms toward the product** ("walking up to it") + opens **additional facts** (qty, expiry, price, store, purchased, expected time to buy again).

## 7. Reorder — consent-gated, location-aware
- Nothing leaves the list until **Checkout tapped + confirmed** → offer the **top 3–5 grocery-delivery apps for the user's location** (+ Amazon) via **share-sheet / deep-link hand-off**; the app opens with items queued; user checks out **there** (no stored passwords, no fragile automation).

## 8. Gym — program layer + live session + bidirectional nutrition link
- **`Program` (the arc):** a **weekly split, progressive overload across weeks, rest days, and deloads** — not just isolated sessions. This is what makes "fastest way to the goal" real.
- **Live session:** tailored sets/weights/order/rest; **rest-timer effort emojis** (angry/contempt/easy, optional, each animated) → **easy→heavier next, angry→hold/deload, contempt→hold**.
- **Auto-regulation:** a quick **soreness/injury/pain** check reshapes the session (swap/skip/deload) and the program — honesty-gated ("fastest *safe* path").
- **Bidirectional nutrition:** under-fuelled/big deficit → eat-before or lighter session; training day raises calorie/protein targets; workout time shifts meal timing; brutal session → recovery-nutrition nudge.

## 9. Gym-location personalization
- **Multiple saved gyms** (home / commercial / travel); switch at will. Set a gym → app does **all research it can** → tailors exercise selection, machine↔free-weight↔bodyweight swaps, order, sets, weights, rest to its equipment + goal + fastest honest path.
- **User overrides are authoritative + persistent:** "it has X" / "doesn't have X" edits the model at will, is honored everywhere relevant, and beats future re-research.

## 10. Onboarding + empty states
- **First-run flow** collects the minimum for an honest brain (height, age, sex, current weight, goal + goal weight, primary gym, optional measurements/photo). Skippable fields degrade honestly.
- **Empty states** on day 1: the avatar starts from your real inputs; DayPlan/pantry show honest "let's get set up" prompts, never fake data.

## 11. Settings / profile hub
Health connections, **budget cap**, units (metric/GBP), gym management, **goal reset** (re-reveals the avatar prize), notification prefs + **quiet hours**, privacy. Consistency tracker + AI coach reachable throughout.

## 11a. AI coach chat (grounded)
A conversational coach that **sees your full context** — "why this plan?", "swap this exercise", "am I on track?" — answers from your real data, honesty-gated. Carries forward today's Chat/GymChat.

## 12. Roadmap (ordered build plan)
- **P0 — Flutter foundation:** new Flutter app; unified `health` package (steps, sleep, energy, RHR/HRV, weight, BF, workouts); camera; push + quiet hours; location; Dart offline queue; **onboarding + Settings shell**; wire to FastAPI backend.
- **P1 — Pantry keystone + ingredient graph:** `Pantry` + `MealComposition` (+ social-seam owner fields), test-first; log CRUD.
- **P2 — Capture + accuracy tiers:** barcode-first, label OCR, grams/Guess, In/Out (+ eating-out spend), receipt→pantry, hydration, supplements, food DB search.
- **P3 — Cross-links (plumbing):** ingredient deduction + spend + budget, gym↔nutrition link, pantry-low→list, effort emojis + soreness→progression, gym-equipment+overrides→exercise engine, meal schedule.
- **P4 — Avatar + PhysiqueState (3D low-poly, glTF morph-targets) + progress photos:** morphing home + goal-prize mechanic + photo timeline + widget. Start with the best-AI-generator research + a clothed morphing-character spike (cosmetics need clothing morph-targets).
- **P5 — Brain: DayPlan + Today tab + program layer + recalibration:** ordered Train/Eat/Buy, `Program` arc/deloads, weekly recalibration, wired to push/widget/coach chat.
- **P6 — Reorder + Recipe creator:** location-aware share-sheet hand-off; recipe creator.
- **Cross-cutting:** AI coach chat; progress-reveal-on-nav animations; consistency trackers; accessibility (semantics, dynamic type, contrast).

## 13. Progress reveal on navigation
- **Data always real-time-correct** (shelf life by real days, macros/timer live); only the **animated *reveal*** of change (avatar morph, meter fill, shelf-life ticks) is gated to opening a surface.

## 14. Deferred (designed-for, not built)
- **Monetization — paid cosmetics** (planned; details TBD from Brody). The app will sell cosmetic items later (tie-in to the avatar / unlockable skins is the natural surface). Requires: Apple Developer paid-apps agreement + StoreKit / in-app purchase, an entitlement/ownership model (with the same owner/visibility seam as §2), and honest "earned vs bought" separation (never present a bought cosmetic as an earned achievement). **Fully developed in `docs/plans/2026-08-19-cosmetics-avatar-accounts.md`** — a rotating item shop (hats/accessories/tops/belts/bottoms/shoes) where items render on the avatar and **fit by your real physique**: buy an item, *grow into it* (measured progress unlocks the perfect-fit / ripped "earned" styles; regression shows honestly, framed kindly). Buying = goal-setting. Economy = hybrid (rec). **This forces a multi-user shift:** accounts (Sign in with Apple), a real multi-tenant backend on Health Hub's **own domain** (pestdispatch.co.uk retired — was another project), StoreKit IAP + account deletion. Cosmetics also strongly favor the **3D avatar** (clothing morph-targets). Sequence: core → avatar (P4) → Accounts/backend phase → cosmetics.
- **Social** (accounts, sharing, community recipes, feeds, leaderboards) — social seam reserved (§2).
- **Data export / backup portability**, **Apple Watch app**, **recipe-import-from-URL** — nice, not needed for a complete day-one app.
