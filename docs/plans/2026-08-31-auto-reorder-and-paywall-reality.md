# Auto-reorder + the £5 paywall — the honest reality (and what to build)

Surveyed the existing code before speccing. The finding is important enough that it
should reshape the monetization pitch, so read the headline first.

## ⚠️ Headline: "fully automatic reordering" is NOT technically feasible for us
The £5 paywall was premised on *"paying makes it fully automatic — it reorders your
groceries for you."* After surveying the integration, that specific promise can't be
delivered honestly:

- **What we have** (`supabase/functions/instacart-cart` + `app/lib/cart/`): the
  Instacart integration is stubbed, and even the *complete* version only uses the
  **Instacart Developer Platform (IDP)** "shopping-list link" API — it creates a
  **pre-filled cart URL the user opens and checks out themselves.** It explicitly
  **never places an order** (that's baked into the code's honesty comments).
- **True hands-off ordering** (the app places + pays without you) needs Instacart's
  enterprise **Connect/fulfilment** partnership (for retailers, not open to a solo
  founder) — and there's no consumer order-placement API a solo dev can use.
- Even if we could: **auto-charging someone for groceries with no confirmation** is a
  trust/consent/refund minefield and an App-Store risk. Nobody should want it.

**So "fully automatic" is both infeasible AND a bad idea. We must not advertise or
charge for it** — that would be a false claim and it breaks the honesty spine.

## What IS real, valuable, and honest — reframe the paywall
The genuine magic isn't hands-off ordering; it's **removing all the work up to one
tap.** Reframe the value:

> **Free:** snap → plan → see the gaps.
> **£5/mo (Pro):** the app runs the loop for you — watches your pantry, auto-plans the
> week, **auto-builds your grocery cart from the gaps**, and hands you a **one-tap
> checkout** — then deducts as you eat and re-primes the next cart. You approve with
> one tap; you never build a list again.

That's "your food life on autopilot **up to checkout**" — true, deliverable, and still
a strong £5 pitch. (Honest microcopy: "One tap to order — we've done everything else.")

## What already exists (don't rebuild)
- **Grocery list + reactive cart** (`cart/grocery_list_repo.dart`, the live badge).
- **Reorder-cadence learner + purchase history** (`pantry/acquisition_service.dart`,
  `pantry/purchase_history.dart`) — already learns *when* you re-buy.
- **The gap engine** (plan ingredients diffed vs pantry → the list) and **cart
  hand-offs** (Instacart/Amazon URL launchers, `cart/delivery_services.dart`).
- **The Instacart edge fn** (stub) — ready to deploy once we have an IDP key.

## What's missing (the actual build, in order)
1. **Deploy the Instacart IDP integration** — get an IDP API key, set the secret,
   deploy `instacart-cart`, verify the pre-filled cart URL works end-to-end. _(One-tap
   checkout — the honest ceiling.)_
2. **The auto-loop trigger** — when the cadence learner + pantry say an item is
   low/due, auto-add it to the cart (already have the pieces; wire the automation +
   an honest "we added X to your cart" surface). Gate the *automation* behind Pro.
3. **Subscription infrastructure** — **there is currently NO paywall/IAP code.** Add
   **RevenueCat + StoreKit/Play Billing** (the standard for a solo founder), a Pro
   entitlement check, and the paywall screen. £5/mo + an annual plan.
4. **Honest UX** — never say "ordered" until the user taps checkout; show what's
   automated vs what needs their tap.

## Recommendation
- **Fix the pitch now** (docs/investor deck/app copy): "**autopilot up to one-tap
  checkout**," not "fully automatic." This is a cheap change that keeps us honest.
- **Sequence the build** after you've dogfooded the core loop (validate people even
  want the loop before building the commerce + billing rails). Order 1→3 above when
  we do.
- **Validate willingness-to-pay** for *this* (one-tap reorder) specifically — it's a
  different value prop than "fully automatic," so the £5 assumption needs a real test.
