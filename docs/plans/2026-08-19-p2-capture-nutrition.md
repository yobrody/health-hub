# P2 — Capture + Nutrition (client-side-first: barcode + manual + In/Out)

> **For Claude:** subagent-driven; per-task model/effort per `feedback-model-effort-per-task-protocol` (Opus for data/honesty, Sonnet for UI). Honesty rule: EXACT vs ESTIMATE(`~`) tiers; micros only when measured else `—`; queued≠failed; eating-in deducts pantry, eating-out doesn't.

**Goal:** Real food/drink logging via **barcode (Open Food Facts, client-side) + manual entry + grams/Guess**, an **In/Out** toggle (In → pantry deduction via P1's `EatInService`; Out → restaurant + eating-out spend), all offline-queued and accuracy-tiered.

**Scope decision:** Barcode logging needs no Health Hub backend (OFF is a public API). So P2 ships client-side. **DEFERRED to a "backend connectivity" milestone** (flagged, needs Brody's infra/security call): AI meal-photo recognition + receipt OCR (the existing FastAPI already has `/scan/smart` `/food/smart` `/barcode` — the native app just can't *reach* it yet), and actually syncing queued writes. Options to present later: expose FastAPI on a subdomain + `X-Health-Key`, a CF Worker proxy, or Tailscale-only.

**Tech Stack:** Flutter + Riverpod, P0/P1 modules, `mobile_scanner` (barcode), `dio` (OFF lookup). Tests: `flutter_test` + `mocktail`.

---

### P2-T1: Nutrition log model + repo (Opus)
- `app/lib/nutrition/food_log_entry.dart`: `FoodLogEntry { id; name; DateTime at; double? kcal; double? proteinG; double? carbsG; double? fatG; Map<String,double?>? micros; double? grams; AccuracyTier tier; bool ateOut; String? restaurant; double? spendGbp; String? barcode; String source; owner-seam }` — all macro/micro nullable; `enum AccuracyTier { exact, estimate }`. `toJson`/`fromJson` omit nulls (no fabricated 0). 
- `NutritionRepo`: local persist (injectable store) + outbox-queued writes; `add/update/delete/logsForDay`. Micros only stored when actually measured (else null). `estimate` entries carry `tier=estimate`.
- Tests: nulls stay null (no 0-fill); estimate vs exact preserved; a write queues (not failed); eating-out entry carries spend and does NOT touch pantry.
- Add `nutritionRepoProvider`.

### P2-T2: Packaged-food scaling logic (Opus) — the accuracy backbone
- `app/lib/nutrition/packaged_food.dart` — PURE, port the honest logic from the old `src/lib/packaged-food.ts` (read it): `parseServingGrams(str)` (handles `g` and `ml`≈1g for liquids; grams take precedence), `scalePer100gToServing(per100, grams)`, `sodiumMgFromSalt(saltG)`, `isRelevantMatch(query, product)` (relevance guard so a wrong OFF hit isn't logged). All null-safe (missing → null, never 0/guess).
- Tests: 500 g pot scales correctly (not per-100g); `"330 ml"` → ~330 g; salt→sodium; irrelevant match rejected; missing fields → null.

### P2-T3: Open Food Facts lookup client (Opus)
- `app/lib/nutrition/off_client.dart` — `OffClient(Dio)` → `Future<PackagedFood?> lookupBarcode(String code)` hitting `world.openfoodfacts.org/api/v2/product/{code}` (public; no auth). Parse into a `PackagedFood` using T2 scaling; **micros only when OFF supplies them**, else null; return null on not-found/error (honest, not a guess). Validate the barcode (numeric).
- Tests (mocked dio): a real-ish OFF payload parses + scales; missing product → null; a non-numeric code → null/validation; micros absent → null (not 0).

### P2-T4: Capture UI — barcode + manual + In/Out (Sonnet)
- A capture entry on the Nutrition page (replace `nutrition-page` placeholder, keep its Key): **Barcode scan** (`mobile_scanner`) → `OffClient` → prefilled, editable log; **Manual entry** (name + grams/ml + macros, or a **Guess** button that logs `tier=estimate` with a clear `~`); **In/Out toggle** (In → if it maps to a `MealComposition`, deduct via `EatInService`; Out → restaurant + `spendGbp`). Log via `NutritionRepo`. Honest rendering: `—` for unmeasured, `~` for estimates.
- Widget tests (fake providers): manual add logs an entry; Guess logs `estimate`; Out entry records spend + no pantry deduction; barcode path prefV from a fake `OffClient`.

### P2-T5: Verify + finish (Sonnet)
- Full `flutter test` + `analyze` green; update north-star P2 status; push + PR + merge on green CI.

## Definition of done (P2)
Barcode + manual + Guess food logging, accuracy-tiered + honest, with In/Out (pantry deduction vs eating-out spend), offline-queued. AI recognition + sync deferred to the backend-connectivity milestone.

## Deferred (backend-connectivity milestone — needs Brody's infra/security decision)
- How the native app reaches the FastAPI on lucky-vps (subdomain + `X-Health-Key` / CF Worker proxy / Tailscale). Then: wire `HEALTH_HUB_API_BASE`, AI capture via existing `/scan/smart` `/food/smart`, `/pantry` CRUD endpoints + real sync (queued writes replay), outbox reject semantics (Task 11).
