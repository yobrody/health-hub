# Cosmetics + Living Avatar + Accounts (design, 2026-08-19)

> Status: **design/planning** (Brody's idea, developed). Deferred build — lands after the core loop + the avatar (P4), behind a new **Accounts/backend phase**. Captures the multi-user + own-domain shift.

## 0. The core idea (Brody's, developed)
A **rotating item shop** sells wearable cosmetics that render on the **living avatar** — but the defining mechanic is that **how an item fits and looks is driven by your real physique, and the best fits/styles are EARNED through measured progress.** You buy the item; you *grow into it*. Monetization is fused to the app's core progress loop instead of bolted on.

Item slots (a full outfit): **hat · accessory · top · belt · bottom · shoes.**

## 1. Fit-by-physique (the innovation)
Every wearable has an **ideal physique range**. How it renders on your avatar depends on your current `PhysiqueState` (weight / body-fat / shoulder-waist / muscle — already modeled) vs that ideal:
- **Below ideal** (extra fat / less muscle than the item wants) → renders **tight/straining or ill-fitting** (e.g. slim jeans look tight).
- **At ideal** → **fits as advertised.**
- **Above ideal in muscle** → **"outgrown" earned styles** (ripped tee, straining sleeves) — a badge of gains.
- **Regression** (stop training / gain fat / lose muscle) → clothes render **baggier, a belly shows** — the same honesty rule as the avatar, framed kindly (accountability, never shaming — see §7).

## 2. Earned styles (the reward layer)
- Buying gives you the **item**; **sustained, MEASURED progress** unlocks its premium **style / perfect-fit**.
- **Gate = real progress**, not time (e.g. "+X kg lean mass over Y weeks while owning this item," or reaching the item's ideal body-fat) — unfakeable, honest.
- **Unlock permanence:** the *unlock* (achievement) is **permanent**; the *equipped look* still reflects your **current** body (so it can visually regress) — you never lose the earned right, and re-equip the perfect look when back in shape. Balances honesty (current look is real) with reward (achievement isn't erased).
- Ties into the physique **milestones** (north-star §3) and the goal-"prize" avatar.

## 3. Buying = goal-setting
Each item previews **"fits perfectly at: [target physique]."** Buying slim jeans literally **sets a visual goal** you then train toward — the shop doubles as a goal-setter, and you're buying a *future self to grow into*. This is why the monetization is healthy: it sells motivation, not just pixels.

## 4. The rotating shop
- Refreshes on a cadence (**weekly featured + daily rotation**), game-style, for engagement/FOMO.
- **Free starter outfit** so the avatar is presentable from day one — never pay-to-look-decent.
- Later: rarities, themed/seasonal drops, bundles.

## 5. Economy — DECISION (recommend hybrid)
- (a) real-money only (StoreKit IAP per item) · (b) earned **soft-currency** (coins from workouts/streaks/consistency) · (c) **hybrid**.
- **Recommend HYBRID:** earn soft-currency from real activity (rewards the health loop) for most items; premium/rare items + currency top-ups via real-money IAP. Monetizes without gating fun behind cash, and the earned currency reinforces the habit. _Brody to confirm._

## 6. Data model (with the social seam we're already building)
- `CosmeticItem { id, category, name, rarity?, priceReal?, priceSoft?, idealPhysique, styleVariants[] }`.
- `OwnedCosmetic { userId, itemId, purchasedAt, equipped, unlockedStyles[] }`.
- Pure `FitState computeFit(CosmeticItem, PhysiqueState)` → `{ tight | perfect | baggy | outgrown | ... }` (honest, deterministic).
- `AvatarRender = PhysiqueState + equipped items + per-item FitState`.
- Per-user ownership = why this needs **accounts** (§8). The `ownerId`/`shared` seam on Pantry/Nutrition/Meal/Profile is the groundwork.

## 7. Honesty / ethics guardrail (this is a health app)
The avatar + clothing reflect real body state, but **always framed supportively — motivating, never body-shaming.** Respect body-image / disordered-eating sensitivities. Never sell by making a user feel bad about their body; the "grow into it" framing is **aspirational, not punitive**. The regression view is gentle accountability, dismissible, and never the sales pitch. This is a first-class design principle, not optional.

## 8. What this REQUIRES: Accounts + multi-user + own-domain backend (the prep)
Selling on the App Store + adding users + cosmetic ownership all require a real backend the current single-user setup can't provide. **`pestdispatch.co.uk` is retired for this** (it was another project's domain).
- **Own domain** — register a Health Hub domain; the backend + API live there.
- **Per-user accounts + auth** — **Sign in with Apple, email, or phone (SMS OTP)** (Brody's choice, 2026-08-19). Apple is mandatory to *offer* if you also offer other third-party logins, and cleanest on iOS; phone auth needs an SMS provider (Supabase/Firebase phone auth via Twilio/MessageBird). All three are supported by the recommended Supabase backend.
- **Multi-tenant backend + real DB** (userId-scoped; the JSON/single-user FastAPI won't scale). **DECISION:**
  - (A) **Managed BaaS — Supabase** (Postgres + auth + row-level-security + storage): fast path to multi-tenant, you keep SQL, RLS enforces per-user isolation. **Leaning rec.**
  - (B) Firebase (Firestore + Auth): fastest, but NoSQL + lock-in.
  - (C) Extend the FastAPI with proper auth + Postgres on the VPS: most control, most work.
- **StoreKit IAP + server-side receipt validation**; per-user entitlement storage.
- **App Store requirements:** privacy policy, **in-app account deletion** (Apple mandates once you have accounts), explicit health-data consent/handling.

## 9. Avatar-tech implication (feeds the P4 decision)
Clothing that fits differently by body state = **clothing meshes weighted to the body's morph-targets** — far cleaner in **3D (glTF morph targets)** than 2D vector. **Cosmetics are a strong argument for the 3D avatar path** (Meshy/Tripo-generated low-poly body + clothing with blend-shapes). Factor this into the P4 prototype: prototype the 3D path with a clothed, morphing character, not just a bare body.

## 10. Sequencing
Core features (P2/P3) → **Avatar (P4)** → **Accounts/backend phase (own domain, Supabase-ish, Sign in with Apple, IAP scaffolding, account deletion, privacy)** → **Cosmetics/shop/fit-engine/earned-styles**. Accounts MUST precede cosmetics and App Store launch.

## Open decisions (Brody, when ready — none block current build)
1. Economy: hybrid (rec) vs real-money-only vs soft-currency-only.
2. Backend: Supabase (rec) vs Firebase vs extend-FastAPI.
3. Domain name for Health Hub.
