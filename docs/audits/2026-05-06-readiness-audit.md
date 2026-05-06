# Health Hub — readiness audit (2026-05-06)

> Brody asked: *"I want to use this app in my day to day but right now it's not ready."*
>
> This audit walks every page, clicks every button, and reads every word from the user's perspective. Backend issues at the bottom. Severity tiers at the top.

## Severity scheme

| Tier | Meaning |
|---|---|
| **P0** | Blocks daily use — broken flow, wrong data, missing primary capability |
| **P1** | Visible UX issue you'll trip on every day (redundancy, wrong copy, confusing affordance) |
| **P2** | Polish — small but cumulative; the difference between "shipping" and "mine" |
| **B**  | Backend / infra — fragile path, missing handler, schema concern |

---

## P0 — BLOCKERS

### P0-1. Goals page is unreachable
- **Files:** [src/App.tsx:173](src/App.tsx) routes it, but no `setTab('goals')` call exists anywhere in `src/pages/*.tsx` or `src/components/*.tsx`.
- The Today header used to have a Goals/settings button — it's gone. There's no path to: change calorie target, change protein target, change weekly gym days, set/log weight, edit meal plan.
- 356 lines of [src/pages/Goals.tsx](src/pages/Goals.tsx) with weight-trend analysis + suggested calorie targets — completely orphaned.
- **Fix:** Add a profile/settings entry point (cog icon in Today header, or a "more" tab). Goals is the natural home for weight + targets.

### P0-2. Fridge header buttons duplicate the always-on camera FAB
- **Files:** [src/pages/Fridge.tsx:1668](src/pages/Fridge.tsx) — `🏷️ Barcode` + `📷 Scan` + `+ Add` row
- The bottom camera FAB ([src/App.tsx:206](src/App.tsx)) opens [src/components/CameraSheet.tsx](src/components/CameraSheet.tsx) which already offers "Scan Receipt" + "Scan Barcode". So we have THREE camera entry points:
  - Header `📷 Scan` → receipt scan
  - Header `🏷️ Barcode` → barcode scan
  - Bottom FAB → both of the above
- The header stack is cramped on phone width (3 buttons + cluttered emojis). Remove the two camera buttons; keep only `+ Add` (manual entry — distinct from camera).
- Brody noticed this on day-1 use.

### P0-3. WORKOUTS tile shows `—` instead of `0`
- **Where:** Today page WORKOUTS card. Renders `—/4 this week` because some count formatter returns em-dash for 0.
- **Why it matters:** The whole point of the tile is "did I work out this week?" — `—/4` reads like "data unavailable", not "you've done zero". User loses the at-a-glance signal.
- **Fix:** Use `0/4` for actual zero. Reserve `—` for unknown/loading.

### P0-4. Freezer LCD reads `3°C`
- **Files:** [src/pages/Fridge.tsx:502](src/pages/Fridge.tsx) — hardcoded `<text … fill="#5EE6A8">3°C</text>` next to a `FREEZER` label.
- Freezers are −18°C. The display is on the freezer compartment itself. Breaks the metaphor.
- **Fix:** Two LCDs (one per compartment, fridge ~3°C, freezer ~−18°C) OR move the LCD onto the fridge compartment + label "FRIDGE 3°C".

### P0-5. Recent workouts show stale + zero-data sessions
- **Where:** Workout page → RECENT card list.
  - "Lower A · Sat 2 May · 0 min · 5 exercises · **0kg**"
  - "Upper A · Fri 13 Mar · 22 min · 8 exercises · **0kg**"
- 0kg + 0 min sessions imply nothing was actually logged. Either filter them out of "RECENT", or show them with a clear "draft / not started" state.
- The `Mar 13` session is 7+ weeks old and still listed under "Recent" — extend the filter or label time-decayed sessions clearly.

---

## P1 — Visible daily friction

### P1-1. Quick log on Today has no `protein` field
- **Where:** Today page → QUICK LOG card. Fields: text + kcal + ADD.
- The protein metric is shown as a goal (140g) but you can't log protein from the quick path. To track protein you must use the camera flow (AI estimates) or Nutrition page.
- **Fix:** Add an optional `protein g` mini-field next to kcal.

### P1-2. Smart grocery list duplicates the Eat-Soon banner
- **Where:** Fridge page renders both:
  - Top: "⚠️ Eat soon — chicken thighs · grapes · protein meals · pineapple slices +2 [📋 List]"
  - Bottom: "SMART GROCERY LIST 🛒 chicken thighs / 🛒 grapes / 🛒 protein meals … 🛒 milk / 🛒 spinach / 🛒 oats"
- Both surface the same expiring items, with the bottom list also adding staples-not-in-fridge. The `🛒` icon is identical for both kinds — user can't tell which is "use up" vs "buy more". Consolidate or differentiate (e.g. ⏳ for expiring, 🛒 for buy).

### P1-3. Fridge "Eat soon" banner shows truncated count
- "+2" tail of "chicken thighs · grapes · protein meals · pineapple slices +2" — but the header above already says "6 expiring". So we say `6` then list `4` then say `+2` — three different number statements for the same set. Pick one.
- **Fix:** Show first 3 then "+ N more"; never show two different totals.

### P1-4. SKINCARE tile reads `AM ○ PM ○ routine`
- The trailing `routine` is the section subtitle but rendered inline → reads as "morning empty, evening empty, …routine??". Confusing.
- **Fix:** Subtitle on its own line, e.g. `AM • PM` with filled vs hollow circles, "routine" removed.

### P1-5. Lists / Agenda lack any back-affordance
- Agenda + Lists pages reached via Today tile clicks have no visible "← back" or breadcrumb. Only way back is the bottom nav's `Today` tab — works but discoverability is poor on first use, especially given no tab is highlighted as the source.
- **Fix:** Page header with `←` back to Today, or rename pages "Plan" / "Shopping" matching the tile labels.

### P1-6. Lists page label/tile mismatch
- Today tile says **"Shopping 3 items to buy"** → clicking lands on a page titled **"Lists"** with three list tabs **🛒 Groceries / 📋 Errands / 🛍️ Shopping**. So "Shopping" on Today opens "Lists", but Shopping is also one of three sub-lists. Confusing nesting.
- **Fix:** either rename the Today tile to "Lists" or change the page title to match the entry tile.

### P1-7. Agenda priority labels are unconventional
- Agenda has filter chips: `Normal | Urgent | Low` (not `Low / Normal / High` or `P1 / P2 / P3`). And the `+` button to add is far right after three priority chips — looks like a fourth filter, not an action.
- **Fix:** standard priority order; visually distinguish add button from filters.

### P1-8. Routines streak copy is verbose
- Each routine card: "🧘 Meditate / **No streak yet** / Mark done" — the empty-state line repeats five times. Cumulative noise.
- **Fix:** Hide "No streak yet" until streak ≥ 1; show streak inline only when meaningful. Free space for a "log time" stamp instead.

### P1-9. Skincare "Tap" labels are unnecessary
- Each step renders as: emoji + name + "Tap" — "Tap" is decoration. The whole tile IS the tap target.
- **Fix:** drop the literal word "Tap"; rely on tap affordance + state change.

### P1-10. Workout "Begin" CTA next to NEXT UP is far from item list
- The next workout card shows `NEXT UP / Lower B / Legs · Recovery / Begin` then dumps 4–5 exercise lines below. The Begin button is at top-right while the actual exercises preview is lower — eye flow is awkward. On phone, primary action should be at thumb-bottom.
- **Fix:** Sticky "Begin" footer or moves below the exercise preview.

### P1-11. Nutrition page header has weird "Fridge" button
- Nutrition page top bar: `Nutrition | Fridge | 📸 Photos | + Add`. The "Fridge" button label without context implies "switch to Fridge tab" but is right next to nutrition controls — visually similar to a filter chip.
- **Fix:** Either remove (Fridge is one tap away in the nav) or label it `View fridge ▸` clearly.

### P1-12. "Use these soon" Today tile is identical concept to Fridge "Eat soon" banner
- Two different copies for the same meaning. Standardize: pick one verb (probably "Eat soon" — more imperative, clearer urgency).

---

## P2 — Polish (small but cumulative)

### P2-1. Pantry's still-visible drawer base
- **Files:** [src/pages/Fridge.tsx:657](src/pages/Fridge.tsx)
- After the doors-removed polish, the BOTTOM DRAWER (with brass pull) is now stylistically inconsistent — it's a closed drawer at the bottom of an otherwise open shelving unit. Probably also looks "behind" the open interior.
- **Fix:** either remove the drawer entirely (open dresser look) or move the open shelves entirely above the drawer (genuine cabinet-with-drawer-base look).

### P2-2. Camera sheet copy could be sharper
- "Log Food / Photo → AI identifies items + macros" — the `→` in option labels reads like a heading separator, not a flow arrow.
- "Scan Barcode / Log food **or** add to fridge" — the disjunction is real (barcode → log to today vs add to fridge inventory) but the user has to mentally model when to use which. Surface the choice INSIDE the barcode flow, not as ambiguity in the label.

### P2-3. Date format inconsistencies
- Today header: `WED 6 MAY` (uppercase day, abbreviated)
- Workout RECENT: `Sat 2 May` (mixed case, abbreviated)
- Nutrition LAST 7 DAYS: `Tue 5`, `Mon 4`, `Sun 3` (abbreviated, no month)
- Agenda: `Wednesday 6 May` (full weekday)
- **Fix:** pick one: `Sat 2 May` everywhere, or `Sat May 2`, or `2 May`.

### P2-4. Today tile separators inconsistent
- ROUTINES tile: "meditate · vitamins · journal · read · stretch" — middle dot `·`
- NEXT WORKOUT: "Legs · Recovery · 5 exercises" — same middle dot
- Workout list: "Sat 2 May · 2 min · 8 exercises · 1,000kg" — same dot
- Camera buttons (Today): "Photo → AI identifies items + macros" — arrow, not dot
- The dot is fine; just be consistent across CTAs (no arrows).

### P2-5. PR claim is misleading
- Workout page: `Flat Dumbbell Bench Press / 20kg × 50` with PR badge. 50 reps at 20kg isn't a strength PR — it's an endurance set. If it's truly the heaviest the user has logged for that lift, label it; otherwise don't badge as PR.

### P2-6. Empty-state copy could be warmer
- Lists empty: `Nothing on the list yet` — fine.
- Agenda empty: `Nothing planned yet — add your first task above` — better.
- Nutrition empty: `Nothing logged yet / Tap + Add to start tracking` — fine.
- Routines empty (per routine): `No streak yet` — feels passive-aggressive on every card. See P1-8.

### P2-7. HYDRATION 0/8 with 8 hidden buttons
- The hydration row shows `0/8` with 8 unlabeled `<button>` elements (presumably water-droplet pip toggles). Aria-labels would help screen-readers; a number line would help everyone.
- **Files:** [src/pages/Today.tsx](src/pages/Today.tsx) — find the hydration block.

### P2-8. Onboarding default name is "Brody" everywhere
- [src/App.tsx:90](src/App.tsx) and [src/pages/Today.tsx:196](src/pages/Today.tsx) — fine because it's your app, but if this ships to anyone else (or you reset state) the default `Brody` greeting before onboarding looks weird.
- **Fix:** show no name (or "there") until onboarded.

### P2-9. ItemDetailModal Inventory section shows £ even when cost is null
- **Files:** [src/pages/Fridge.tsx](src/pages/Fridge.tsx) ItemDetailModal
- Section is gated on cost-or-store-or-unit_size, but the cost row inside renders `£` literally even when `detail.cost == null` (the `{detail.cost != null && …}` wraps the number, but the `<span>` parent + leading `£` still appears in some flows). Verify on the live preview.

### P2-10. ItemDetailModal "Re-enrich" button hides what it does
- After tap, brief `…` placeholder then a generic toast "Updated X" — no signal that nutrition + photo + brand are being refreshed. A user who tapped expecting "edit" might be surprised.
- **Fix:** rename to "Refresh data" or add a one-line subtitle "Re-pull nutrition + photo from sources".

### P2-11. Fridge cards use Noto icons but freezer/condiments fall back to legacy emoji grid
- Inconsistent visual language: top of fridge page = cartoon SVG with Noto items. Below = flat grid with native emoji. Bring everything to the same style.

### P2-12. App-level: no system theme respected by default
- Theme cycler is `light → dark → system → light`. But onboarding completes in light mode and doesn't ask which the user wants.
- **Fix:** default to `system` first run.

### P2-13. PWA manifest icons are SVG only
- iOS/Android stores prefer rasterized PNGs at 192/512. Currently `icon-192.png`, `icon-512.png` exist as files but the manifest only lists SVG. May affect home-screen install quality.

---

## B — Backend / infra

### B-1. VPS `/fridge` returns by zone but no slot data
- **Files:** [api/main.py:212](api/main.py)
- `GET /fridge` returns the four zones; `GET /fridge/slots` is a separate call. Frontend does both on every page load. Combine into one to halve the round-trips on a phone with flaky 4G.

### B-2. `removeFridgeItem` substring-match is dangerous
- **Files:** [api/main.py:354](api/main.py)
- `if name_lower not in i["name"].lower()` deletes ANY item whose name CONTAINS the request string. Already bit us tonight (the `honey` → `honeycomb cereal` collision).
- **Fix:** require exact case-insensitive match; add a `?contains=true` flag for explicit substring deletion if anyone needs it.

### B-3. KV merge in `[[path]].js` only carries 4 fields
- **Files:** [functions/api/[[path]].js:55-65](functions/api/[[path]].js)
- The proxy merges `size, cost, store, photo_url`. But the new enrichment cascade also writes `brand, nutrition_per_100g, packaging, allergens, etc`. Those fields only surface via `/fridge/item/{name}` — not on the main `/fridge` payload.
- **Implication:** Fridge cards can't show brand/nutrition without a per-item request. Modal works. List view can't.
- **Fix:** extend the merge to pass through the full enriched record; or add a single `extras` blob field.

### B-4. `enrich-backfill` may exceed CF Pages CPU/wall-clock for large fridges
- **Files:** [functions/api/fridge/enrich-backfill.js:56](functions/api/fridge/enrich-backfill.js)
- For each item: barcode lookup (≤1 OFF call) + text search (≤1 OFF call) + Gemini (1 call). With 50 items + 350ms OFF politeness + 200ms Gemini step + actual fetch latency, ~1 minute per 50 items. Under CF Pages 5-min wall limit but tight.
- **Fix:** chunked backfill — accept `?offset=N&limit=M` so client can drive multiple shorter calls.

### B-5. `enrich.js` price-history append on every call is O(N) cost
- **Files:** [functions/api/fridge/enrich.js:79](functions/api/fridge/enrich.js)
- Every `enrich` call with `hints.cost` reads `prices:{name}`, prepends new entry, writes back. KV reads + writes per add. For receipt scans with 20 items = 20 KV reads + 20 KV writes just for prices.
- Fine for personal scale. Not fine if multi-user later. Note for future.

### B-6. `/fridge/scan` (VPS) and `/api/fridge/scan` (CF) coexist
- **Files:** [api/main.py:280](api/main.py) + [functions/api/fridge/scan.js](functions/api/fridge/scan.js)
- Both implement receipt scan, both now use Gemini directly. CF function intercepts the route in production. The VPS variant is dead code in the browser path but live for direct-curl / Telegram bot use.
- **Decision needed:** keep both (and accept duplicate prompt strings), or pick one. If the Telegram bot can call CF instead, the VPS scan endpoint can be deleted.

### B-7. CF Pages env still has `ANTHROPIC_API_KEY` + `OPENROUTER_API_KEY`
- Production env per CF API: both still set. Both unused after tonight's free-tier migration. Safe to delete.
- **Action (Brody-clickable):** CF dashboard → Pages → health-hub → Settings → Variables and Secrets → delete on Production AND Preview.

### B-8. `slot_memory.json` lives outside Syncthing path
- **Files:** [api/main.py:208](api/main.py) → `DATA_DIR / "slot_memory.json"` = `~/health-hub/api/data/slot_memory.json` on VPS
- Other state files (`workouts.json`, `lists.json`, `routines.json`) also live in `DATA_DIR`. None of these are under Syncthing's `~/workspace/` path, so they don't sync to the local PC. If the VPS dies the data is in the docker volume only.
- **Fix:** add `~/health-hub/api/data/` to Syncthing OR add a periodic backup job. Low immediate risk, real medium-term risk.

### B-9. Health Key is hardcoded everywhere
- `brody-health-hub-2026` appears in: `.env.example`, `api/main.py`, every `functions/api/*.js` fallback, `vite.config.ts`. Rotation requires editing 6+ files.
- **Fix:** centralize. CF Pages env `HEALTH_API_KEY` + `.env` only.

### B-10. No rate limiting on VPS endpoints
- Anyone with the X-Health-Key header can spam any endpoint. Fine while the key isn't leaked. The OpenAPI/CF env exposure of the key in client requests means it's de facto public — anyone inspecting network tab on the live site sees it.
- Real fix is auth proper (cookie/session). Acceptable for now since it's personal use, but worth noting.

---

## What "ready for daily use" looks like, prioritized

If I were to ship a daily-driver build tomorrow morning, in order of impact:

1. **Make Goals reachable** (P0-1) — settings cog in Today header opens it.
2. **Strip the Fridge header buttons** down to just `+ Add` (P0-2) — camera FAB handles the rest.
3. **Fix the `—/4` workouts display** (P0-3).
4. **Fix freezer 3°C → −18°C** OR move LCD to the fridge compartment (P0-4).
5. **Filter zero-min/zero-kg sessions out of Recent** (P0-5).
6. **Consolidate Eat Soon vs Smart Grocery** (P1-2).
7. **Add protein input to Quick Log** (P1-1).
8. **Pick one nav copy across Today tile / page title** (P1-6).
9. **Pick one date format** (P2-3).
10. **Stop saying "No streak yet" five times on Routines** (P1-8).

Roughly half a day of focused work for P0+P1; another half for P2 polish.

Backend B-2 (substring delete) is the only backend item I'd ship before daily use — it's the kind of thing that surprises you when you delete `salt` and lose `salted butter`.

---

## What I tested

- 7 pages clicked through (Today, Nutrition, Fridge, Workout, Skincare, Routines, Agenda, Lists)
- Camera FAB opened, all 3 actions verified by label
- Fridge add-modal opened
- Goals page reached only by code-search (zero entry points)
- Source code grep for nav references, copy strings, hardcoded values
- Backend code reviewed (api/main.py + all CF functions + KV usage)
- Did NOT test on physical phone (Brody to do this)
- Did NOT scan a real receipt (no test image available; API contract verified by code review)
