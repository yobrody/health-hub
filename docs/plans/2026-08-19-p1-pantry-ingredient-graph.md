# P1 — Composition Root + Pantry Keystone + Ingredient Graph

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (same as P0). Per-task model/effort follows `feedback-model-effort-per-task-protocol` (Opus implements correctness/data/honesty tasks; Sonnet for UI/scaffolding; review a tier up; self-calibrate).

**Goal:** Wire the P0 layers together (composition root), then add the **Pantry** as real inventory and the **ingredient graph** (meals = pantry-ingredient compositions) — the keystone that powers meal-suggestions-from-stock and eating-in deduction.

**Architecture:** Local-first. Pantry + meal data persist on-device and mutate through the P0 `Outbox` (queued for future backend sync). The composition root instantiates the real `ApiClient`/`Secrets`/`Outbox` via Riverpod and injects them, and drives `Outbox.flush` on connectivity. **Backend `/pantry` endpoints + sync are the P1→P2 boundary** (needs a VPS redeploy) — out of this plan; the outbox already queues the writes.

**Tech Stack:** Flutter + Riverpod, existing P0 modules (`api/`, `offline/`, `core/`, `profile/`, `health/`). Add `connectivity_plus`. Tests: `flutter_test` + `mocktail`. Verify with `flutter test` + `flutter analyze` (no device).

**Honesty rule (unchanged):** missing = `null`/`—`, queued ≠ failed, never fabricate. No negative stock; a deduction that would go below zero is surfaced honestly, not clamped silently into a lie.

---

### Task 1: Composition root (Opus) — wire what P0 built + close the deferred handoff
**Files:** `app/lib/app_providers.dart` (new), `app/lib/main.dart`, `app/lib/app.dart`, `app/lib/pages/today_page.dart`, `app/lib/pages/settings_page.dart` (inject real deps), `app/lib/core/config.dart`, `app/lib/profile/profile_model.dart`/`profile_repo.dart` (reverse goal map), `app/lib/offline/outbox.dart` (flush caller). Tests under `app/test/app/`.
- Riverpod providers: a single shared `Dio`, `Secrets(FlutterSecureStoreAdapter())`, `ApiClient`, `Outbox` (shared `SharedPrefsOutboxStore`), `ProfileRepo` wired to the real `ApiClient` (not `_OfflineProfileApi`).
- Add `connectivity_plus`; when connectivity returns, call `Outbox.flush(sender)` where `sender` replays a `PendingMutation` via `ApiClient` (map network fail → keep queued; this is the first real flush caller — coordinate with tracked Task 11 reject semantics, but at minimum: online→send→remove, offline→stop).
- Fix `Config.baseUrl`: default to empty (force `--dart-define HEALTH_HUB_API_BASE=...`) OR the real API base — NOT the retired `health-hub-dwz.pages.dev`. Update the Config test.
- Add reverse goal-direction mapping `'lose'→'cut'` on profile read (so a future GET-profile is consistent with the model's `gain|cut|maintain`).
- First-run gate: `app.dart` shows onboarding when `!ProfileRepo.hasProfile()`, else the app; and a re-entry path to onboarding from Settings (even after partial fill). Keep the nav test green (guard async first-run so `today-page` still resolves).
- **Tests:** providers construct without throwing; a queued mutation flushes on a fake "online" connectivity + fake ApiClient (and is removed); reverse goal map round-trips; first-run gate shows onboarding when no profile. TDD.

### Task 2: Pantry model + local repo (Opus) — the keystone data
**Files:** `app/lib/pantry/pantry_item.dart`, `app/lib/pantry/pantry_repo.dart`, `app/lib/pantry/shelf_life.dart` (new); tests under `app/test/pantry/`.
- `PantryItem { String id; String name; PantryZone zone; double? qty; String? unit; DateTime? expiry; double? priceGbp; String? store; DateTime? purchasedAt; int? reorderCadenceDays; DateTime? lastBought; String source; String? ownerId; bool shared; }` — nullable where unknown (honesty), with `toJson`/`fromJson` (omit nulls). `enum PantryZone { fridge, pantry, freezer, condiments }`.
- Pure helpers (tested): `estimateExpiry(zone, purchasedAt)` from a shelf-life table using LOCAL dates; `deriveReorderCadenceDays(purchaseHistory)` from consumption rate (null when insufficient data — never a guess); `isLow(item)` / freshness state for the changing visual.
- `PantryRepo`: local persistence (injectable store, SharedPrefs/JSON like P0) + every mutation (add/update/delete/adjust-qty) also enqueues a `PendingMutation` via the shared `Outbox` (queued success), for future backend sync. CRUD + `adjustQty`.
- **Tests:** add/update/delete/list-by-zone; expiry estimation local-date correctness; reorder cadence null on thin data; a mutation enqueues to a fake Outbox; qty never goes negative (a below-zero adjust is rejected/surfaced, not silently clamped). TDD.

### Task 3: Fridge/Pantry UI + log CRUD (Sonnet)
**Files:** `app/lib/pages/fridge_page.dart` (replace the `food-page` placeholder content — keep `Key('food-page')`), item detail sheet; widget tests.
- List items grouped by zone (fridge/pantry/freezer/condiments). Add-item form, edit, delete (the log CRUD). Tap an item → detail sheet with qty, expiry, price, store, purchased, expected-reorder — each honest (`—` when null). A simple freshness indicator from `isLow`/expiry.
- Wire to `PantryRepo` via the composition root providers.
- **Tests:** widget smoke — items render by zone; adding an item shows it; the detail sheet shows `—` for unset fields (no fabricated values). Preserve `food-page` key.

### Task 4: Ingredient graph — MealComposition (Opus) — the keystone logic
**Files:** `app/lib/meals/meal_composition.dart`, `app/lib/meals/ingredient_graph.dart` (pure); tests under `app/test/meals/`.
- `MealComposition { String id; String name; List<Ingredient> ingredients; }`, `Ingredient { String pantryItemId; double grams; }`, + owner/visibility seam. `toJson`/`fromJson`.
- Pure functions (the graph, read + write):
  - `bool canMakeFromStock(MealComposition, List<PantryItem>)` — true only if every ingredient's pantry item has enough qty (honest about unit/grams; if an ingredient isn't in stock → false; if qty unknown/null → cannot confirm → false, not a guess).
  - `List<MealComposition> suggestMeals(List<MealComposition> known, List<PantryItem> stock, {context})` — makeable meals, ranked (leave the ranking simple/honest for now; context hook for time/DayPlan later).
  - `List<PantryItem> deductIngredients(List<PantryItem> stock, MealComposition)` — subtract each ingredient's grams (qty↓); **never below zero** (return a result that flags a shortfall honestly rather than silently clamping); pure, returns a new list.
- **Tests:** canMake true/false incl. null-qty→false; suggest returns only makeable; deduct reduces qty correctly and flags a shortfall instead of going negative; a missing pantry item is handled honestly. TDD.

### Task 5: Eating-in deduction wiring (Opus)
**Files:** a small service `app/lib/meals/eat_in_service.dart` tying a logged home meal → `deductIngredients` → `PantryRepo` updates (offline-queued); tests.
- Logging a home meal with a composition deducts its ingredients from the pantry via the graph, persists via `PantryRepo` (each adjust queued), and reports honestly if stock was short (doesn't fabricate that you had it).
- **Tests:** eating-in deducts the right grams and queues the updates; a short-stock meal surfaces the shortfall, doesn't drive qty negative. TDD.

### Task 6: Verify + finish (Sonnet)
- `flutter test` (whole suite) green; `flutter analyze` clean. Update the north-star doc's P1 status.
- Finishing-a-development-branch → push + PR; merge on green CI (pre-authorized).

## Definition of done (P1)
Composition root wired (app talks to backend for profile; outbox flushes on connectivity); Pantry is real local-first inventory with honest expiry/reorder + CRUD UI; the ingredient graph suggests meals from stock and deducts on eating-in — all offline-safe, honesty-gated, tested. Backend `/pantry` sync is the next boundary (P2, needs VPS redeploy).

## Deferred to P2+ / boundary
- Backend `/pantry` CRUD endpoints on `api/main.py` + VPS redeploy + wiring `PantryRepo` to sync (the queued mutations then replay to a real endpoint).
- Capture routing (receipt→pantry), accuracy tiers, spend/budget — P2 per the north star.
- Outbox reject semantics (tracked Task 11) — fold in when flush meets real server rejects.
