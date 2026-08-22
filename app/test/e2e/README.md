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
   reads; the shared list holds it and the Cart tab's live badge reflects the new
   count (1). Proves the restock→cart loop closes across screens through one
   shared store + the Brain. On Food (fresh page state) the suggestion also drops
   out once listed — the honest de-dupe — proven in the per-screen tests too.

4. **Home weaves EAT + BUY together** — from one user's real state Home's "For
   you" section carries BOTH a real EAT and a real BUY card, honestly ordered
   (EAT priority 100 above BUY priority 80 — asserted by on-screen Y position).
   Adding the low item from Home's BUY insight writes the shared list and
   navigates to Cart (via `onOpenCart`), with the badge reflecting it.

## Gaps found (real findings, not test flaws)

- **The Cart page's item rows don't refresh on a tab-switch.** `CartPage` loads
  its list only in `initState` — which runs once at app start, when the list is
  empty. Switching to the Cart tab reloads only the **badge count** (in
  `RootScaffold`), not the page's own item list. So after adding an item from a
  Brain BUY insight, the item is genuinely on the shared list AND counted in the
  badge, but its **row** isn't drawn until the page is rebuilt. Because that
  stale in-page list is empty, the Cart page's own de-dupe ("hide a BUY whose
  item is already listed") also can't fire, so the BUY suggestion still shows on
  Cart. Journey 3 documents this precisely: it asserts the **honest current
  behaviour** (badge updates, list row absent, suggestion still shown) rather
  than asserting a behaviour the app doesn't yet have. A fix would be to reload
  `CartPage`'s list when the Cart tab is (re)selected (e.g. watch the grocery
  repo, or reload in `RootScaffold._goToTab` for the Cart index like the badge
  does). Reloading `CartPage._items` is the SINGLE root cause fix: once it holds
  the real list, both symptoms resolve together — the row appears AND
  `_buyInsights` (which de-dupes against `_items`) drops the now-listed
  suggestion. The data layer and the badge already close the loop correctly; only
  the page's row rendering is stale.

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
