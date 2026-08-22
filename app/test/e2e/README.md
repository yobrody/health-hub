# End-to-end user-journey tests (`test/e2e/`)

The capstone tests. Unlike the per-screen widget tests (which build one page in
isolation), these pump the **real application root** — `HealthHubApp` → the auth
gate → the first-run gate → `RootScaffold`'s Home / Food / Gym / Cart nav — and
drive a coherent, multi-screen user journey with real taps and text entry. Every
provider is overridden to a **shared in-memory fake** (see `journey_scope.dart`),
so nothing touches the network, camera, GPS, Supabase, or `SharedPreferences`,
and the run is deterministic and headless.

They run as part of the normal suite: `flutter test` picks up everything under
`test/`, including this folder. To run just these:

```
flutter test test/e2e
```

## What each journey proves

The key property is **interconnection through shared state + the Brain**. Every
repo override shares ONE store instance, and the Brain reads those SAME repos via
`brainInputsProvider` — so a write the user makes on one screen is genuinely
visible to the Brain and to other screens. That's the loop these tests exercise,
not per-screen mocks.

1. **goal → meal → Brain EAT insight** — set a daily calorie/protein goal on Home
   (the goals editor), log a meal via the Home→Nutrition route. Both persist to
   the real repos. The Brain's EAT insight then appears on Nutrition, and its
   title + expandable **"why"** cite the REAL remaining macros (`2000 − 500 =
   1500 kcal`, `150 − 40 = 110 g` protein) and the real goal/eaten numbers the
   user just entered — never a fabricated default. Proves the eat/goal → Brain
   half of the loop, and the honesty invariant end-to-end.

2. **workout → Brain TRAIN insight** — with no history the Gym shows the honest
   TRAIN *setup* prompt (never a fake "due" date). Start a session → pick a lift
   → log a set → finish; the session persists (with the weight honestly snapped
   to a real machine notch). The Brain's TRAIN slice then flips from the setup
   prompt to a real insight whose "why" cites the real "Last trained: today".

3. **pantry → BUY → Cart** — a genuinely-low pantry item surfaces a BUY insight
   on Home and Food (its "why" cites the real 20 g in stock). Tapping the
   insight's "Add to list" writes the REAL item to the SAME grocery list the Cart
   reads; the Cart tab's live badge reflects the new count (1) immediately, and
   switching to the Cart tab shows the item as a **real, freshly-rendered list
   row** — even though the Cart page stayed alive under the nav's `IndexedStack`
   the whole time — with its BUY suggestion dropped (the honest de-dupe). Proves
   the restock→cart loop closes fully across screens through one reactive shared
   store + the Brain.

4. **Home weaves EAT + BUY together** — from one user's real state Home's "For
   you" section carries BOTH a real EAT and a real BUY card, honestly ordered
   (EAT priority 100 above BUY priority 80 — asserted by on-screen Y position).
   Adding the low item from Home's BUY insight writes the shared list, navigates
   to Cart (via `onOpenCart`), and the item shows as a live row with the badge
   reflecting it and the BUY suggestion gone.

## Bug found by these journeys → FIXED

- **The Cart page's rows used to go stale across tab-switches.** `CartPage` loaded
  its list only in `initState`, which under the nav's `IndexedStack` runs once at
  app start (when the list is empty) and never again. So adding an item from a
  BUY insight on Food/Home updated the live badge but NOT the Cart's list row or
  its own BUY de-dupe until a rebuild — the interconnection was only 99% real.
  **Fixed (single root cause):** the grocery list is now reactive. A
  `groceryListProvider` (`FutureProvider` over `GroceryListRepo.all`) is the
  shared source of truth for BOTH the Cart page's rows and the nav's Cart badge;
  the Cart page `watch`es it in `build`, and every mutation — from any screen —
  `ref.invalidate`s it (`CartPage`'s add/toggle/remove/clearDone, and the shared
  `performInsightAction` used by Home + Food). The stale `initState`-only load is
  gone. Now the row appears live, the badge is live, and `_buyInsights` (which
  de-dupes against the live list) drops the now-listed suggestion — all on any
  change or tab return. Journeys 3 & 4 assert this corrected behaviour.

## Harness notes

- `journey_scope.dart` exposes a `JourneyHarness` that builds a signed-in fake
  auth + all composition-root repos on shared in-memory stores, and hands back
  the live repo instances so a test can assert the real persisted state after
  each step. Spread `harness.overrides` into a `ProviderScope` wrapping
  `const HealthHubApp()`.
- A seeded profile makes the first-run gate resolve into the app (not
  onboarding); a silent connectivity monitor keeps the app-root sync driver inert.
- Several taps use `ensureVisible` / `scrollUntilVisible` because the real pages
  are long scrollables (the Brain cards sit above the forms) — the targets are
  really there, just below the fold.
