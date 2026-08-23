# Health Hub (Flutter) — Gap Report vs the Vision

_Date: 2026-08-22. Author: exhaustive-verification pass (`feat/exhaustive-verification`)._

This is an **honest** assessment of where the Flutter app stands versus the full
product vision — the interconnected loop of **gym + nutrition + food + reorder +
the Brain**, all working together, honestly. It comes from actually exercising
**every feature** through the real app (auth → gates → the four tabs + their
routes), in **different orders**, and in **every empty / offline / error state**,
via the new `test/e2e/coverage_*` suites (built on the `JourneyHarness` that pumps
the real `HealthHubApp` with shared in-memory stores + fake seams).

Vision sources: `docs/plans/2026-08-21-alive-redesign.md`,
`docs/plans/2026-08-22-the-brain.md`, `docs/plans/2026-08-18-health-hub-north-star-design.md`,
`docs/plans/2026-08-19-p*` , `docs/plans/2026-08-20-release1-master-plan.md`.

Legend: ✅ genuinely works (verified by a test I wrote) · ⚠️ incomplete / stubbed
/ not-yet-at-vision · ❌ a real bug.

---

## TL;DR — the verdict

**The R1 "alive & interconnected" loop is genuinely real and honest, end-to-end,
on-device-logic terms.** Eat → deplete (eat-in) → restock-soon → Brain BUY →
Cart → hand-off all close through ONE reactive shared store, and every Brain
insight cites real numbers. Order-independence holds. Honesty (`—`/`~`/setup
prompts/queued-is-success) holds everywhere I could drive it.

**What is NOT yet at vision is almost entirely the "real cloud" edges** — the
two AI seams (photo→pantry recognition, barcode) and all sync/auth are proven
only against *fakes*, because the app is not yet wired to a live Supabase/edge
deployment in a way these tests (or a device-less run) can reach. Those are the
top gaps. There is **no interconnection bug** left of the class that bit the old
app (the stale-cart bug is fixed and re-verified here).

**No new ❌ correctness bugs were found.** Several ⚠️ gaps and one latent
robustness concern (a leaked rest-timer, see Gym ⚠️) are listed below.

---

## Coverage delivered by this pass

- **Features** (`coverage_features_test.dart`): auth (5), onboarding (2),
  home/brain (2), nutrition (6), food/kitchen (6), gym (3), cart (5),
  weigh-ins (2), settings (1), sync banner (2), brain actions (2).
- **Orderings** (`coverage_orderings_test.dart`, 8): goal↔meal, workout↔goal,
  cart↔meal, a multi-tab tour, and eat-in→restock→cart — each asserted
  order-independent.
- **States** (`coverage_states_test.dart`, 12): empty (6), honest `—`/`~` (2),
  offline (2), error paths (2: failed-sync retry, no-result barcode).

These join the 4 original journeys. Every assertion is against **real store
state or an honest visible value**, never pixels.

---

## Area-by-area

### Auth — ✅ solid, ⚠️ only the fake is exercised
- ✅ Gate precedence all three ways: unauth→auth screen; authed+no-profile→
  onboarding; authed+profile→app. Sign-in routes in; sign-up (autoconfirm OFF)
  shows the honest "check your email" and does NOT enter the app; an auth error
  is surfaced verbatim (never a fake success); sign-out ends the session.
- ⚠️ **All of this is against `FakeAuthService`.** The real `SupabaseAuthService`
  path (and the `_AuthGate` hydration-on-sign-in) is never exercised device-less.
  Confidence in the *contract* is high (the fake mirrors the documented Supabase
  behaviour); confidence in the *live wiring* needs one on-device / integration
  run.
- ⚠️ Apple / phone sign-in are honestly-disabled stubs (by design in R1).

### Onboarding — ✅ complete + honest
- ✅ Complete-with-skips persists a **sparse** profile (only entered fields;
  skipped stay `null`). Skip-everything still resolves into the app and Home
  leads with the honest "set up your profile" card. No field is ever defaulted.

### Home / dashboard / the Brain — ✅ the interconnection is real
- ✅ Empty state shows NO "For you" section (Home excludes setup prompts) and no
  fabricated numbers; the rift seam is present and inert (tap = no-op, no crash).
- ✅ "Restock soon" appears **only** when the pantry honestly has something due,
  and is omitted otherwise.
- ✅ The Brain weaves EAT + BUY together, ordered by real priority, each with a
  traceable "why" (covered by the original journey 4 + reinforced here).
- ⚠️ **Weigh-in trend is computed but no visual chart** — the vision's "living
  Home that reflects your day" is met at the card level (hero number + ▲/▼
  trend chip), not a richer time-series. Acceptable for R1; a gap vs "alive".
- ⚠️ The rift seam / R2 game and the living **avatar/cosmetics/DayPlan** (see
  `2026-08-19-cosmetics-avatar-accounts.md`, `2026-08-18-north-star`) are
  explicitly deferred — the biggest "aliveness" pieces of the north star are
  not built (by plan).

### Nutrition — ✅ every entry path works honestly
- ✅ Exact In meal (macros → `exact` tier; unmeasured macros stay `null`, never
  0); Guess (`estimate` tier + `~` prefix); Out mode (records restaurant +
  spend, `ateOut=true`, **never touches the pantry**); barcode seam pre-fills +
  **scales per-100g → serving** (a 50 g serving of a 500 kcal/100g product logs
  as 250 kcal, tier `exact`, source `barcode`); goals editor saves blanks as
  `null` (honest empty rings); eat-in attaches a pantry ingredient and **deducts
  real stock** on log with an honest confirmation.
- ⚠️ **Barcode uses the real camera on device only** — the OFF lookup itself is a
  real HTTP client, but tests/device-less runs drive the `handleBarcodeResult`
  seam directly. The camera→scan→lookup leg is unproven without a device. The
  vision's "snap the label" is a seam, not proven live.
- ⚠️ There is **no AI/vision *nutrition* estimate** ("guess" is a manual tier
  flag, not an AI estimate). The north-star "photo of a plate → macros" is not
  built; only barcode + manual.

### Food / interactive kitchen — ✅ R3 shape is real, ⚠️ AI photo is a fake here
- ✅ Empty pantry → the gate (not a fabricated kitchen). Manual add persists and
  flips to the kitchen scene with real zone panels. Tapping a zone opens its
  real items → item-facts sheet. Single/double appliance toggle persists
  (cosmetic; never invents stock). Empty zone shows an honest "is empty".
- ✅ AI-photo confirm-before-save flow: a (fake) recognition result routes to the
  confirm screen, **nothing is saved until Confirm**, then real items land with
  `source: scan`; a recognition **failure** surfaces an honest error and saves
  nothing.
- ⚠️ **This is the single biggest "not-yet-at-vision" item.** The AI vision
  (`recognize-pantry` Supabase edge fn) is only ever a `FakePantryRecognitionClient`
  in tests, and the real client requires a configured, deployed Supabase +
  Gemini-vision edge function. **Whether the real recognizer works end-to-end is
  UNVERIFIED here** — the confirm/honesty UX around it is solid, the intelligence
  behind it is unproven. This is the R2 headline feature; treat "AI photo →
  pantry" as *wired but not live-verified*.
- ⚠️ The kitchen is "stylized panels", not the illustrated kitchen the redesign
  imagines (noted as a future layer in `food_page.dart` itself). Cosmetic gap.

### Gym — ✅ full flow + honest progression, ⚠️ a robustness smell
- ✅ Gate before a session; TRAIN setup insight present with no history. Full
  flow: start → pick → log a set (**97 kg snaps to the real 95 kg notch**) →
  rest panel → rate effort (persists onto the set) → finish (real finished
  session). Bodyweight lift stores `null` weight (no fabricated 0). Confetti is
  gated to a genuine `bump` (covered by `gym_page_test.dart` unit tests).
- ⚠️ **Workout "upload/import" is an honest stub** (R2). Create works; import is
  a "coming soon" snackbar — by plan.
- ⚠️ **Latent robustness:** the rest-timer is a live `Timer.periodic`. My e2e
  flows must `pump()` (not `pumpAndSettle`) around it and skip it before
  finishing, or a test hangs — this is handled, but it means an un-skipped rest
  timer is a live async resource. Not a user bug, but worth knowing when writing
  future gym tests. (No leak in the app itself — `dispose`/`_endRestPhase`
  cancel it.)
- ⚠️ Goal-aware per-exercise targets / roadmap / physique milestones from the
  OLD (React) app's "Transformation" system are **not present** in the Flutter
  app yet — the Brain's TRAIN insight covers "due + progression", but the richer
  62→72 kg roadmap is not ported.

### Cart / reorder — ✅ the loop closes, hand-off is honest
- ✅ Notepad add → check → clear-done → remove, all against the real reactive
  list. Amazon hand-off launches a search URL; Instacart **prefers the pre-filled
  list URL** (via the fake edge client) and **falls back to search** when the
  edge fn returns null — the button is never a dead end. Delivery near-me with a
  **denied** permission still lists services with an honest note (never claims to
  verify delivery). Restock BUY suggestion → add → the suggestion drops
  everywhere (de-dupe), badge + rows live.
- ⚠️ **Instacart pre-filled cart depends on the `instacart-cart` Supabase edge
  fn** — verified only against the fake. Live behaviour unproven device-less.
- ⚠️ **Reorder *cadence* is never actually computed in-app.** `restockSoon`
  supports `reorderDue`, but `reorderCadenceDays`/`lastBought` are only ever set
  by imported/synced data — no in-app flow learns a cadence from repeated
  purchases yet. So the "reorder-due" third of BUY is dormant in practice (low +
  expiring are the live signals). A real gap vs "reorder" in the vision.
- ⚠️ The grocery list is **local-only** (no Supabase table yet, by the repo's own
  note) — it won't sync across devices.

### Weigh-ins + trend — ✅ honest
- ✅ One reading → current shown, **no** trend chip; a second → the real ▲/▼
  trend chip appears. Logging a weight from Home persists and shows the number.

### Sync / offline — ✅ honest banner, ⚠️ only fakes exercised
- ✅ A queued write is a **success** (the meal persists + shows; never surfaced
  as a failure). Pending outbox → honest "Syncing… N queued". Empty → silent
  (no fake "all good"). A **failed** write → the honest "couldn't sync" warning +
  a **working retry** that requeues it (failed→pending, nothing lost).
- ⚠️ The **real** flush path (`SupabaseSyncSender` → live tables) and
  login-time hydration are only exercised against fakes / not at all here.
  Whether queued writes actually land in Supabase is UNVERIFIED device-less.

### Settings — ✅ the real actions work
- ✅ Goal reset clears `goalDirection` + `targetWeightKg` on the real profile.
  Sign-out works (above). Health-key + health-connections are real seams;
  Budget/Units/Gyms/Notifications/Privacy are honest "coming soon" stubs (by
  plan).

### Cross-links / interconnection — ✅ the headline strength
- ✅ **Order-independence holds**: goal-then-meal == meal-then-goal (same EAT
  arithmetic); workout-before-goal == after (both surfaces real); add-to-cart
  before/after logging a meal leaves both consistent; a multi-tab tour then an
  add keeps badge + rows + de-dupe correct; eat-in deduction → a NEW BUY signal
  appears → adding it drops the suggestion. Every one asserts the REAL stores.
- ✅ Every Brain insight **action is wired to the real flow**: EAT setup →
  opens goals; TRAIN setup → starts a real session; BUY → writes the real list +
  jumps to Cart; (log-meal → Nutrition, covered by journeys).
- ✅ **The old stale-cart bug stays fixed** — re-verified: an add on one screen
  is live on the Cart's rows, badge, and BUY de-dupe without a manual reload.

---

## Prioritized gap list (the roadmap to "the full vision")

**P0 — proves the intelligence is actually real (currently only fakes):**
1. ⚠️ **AI photo → pantry recognition, live.** Deploy + verify the
   `recognize-pantry` edge fn (Gemini vision) end-to-end against a real photo.
   Today only the confirm/honesty UX is proven; the recognizer itself is
   unverified. This is the R2 headline.
2. ⚠️ **Live sync + auth end-to-end.** Prove queued writes land in Supabase and a
   returning user hydrates. All auth/sync confidence today is against fakes.

**P1 — completes the interconnected loop:**
3. ⚠️ **Reorder cadence is dormant.** No in-app flow learns `reorderCadenceDays`
   from repeat purchases, so the "reorder-due" BUY signal never fires from
   organic use. Build the purchase-history → cadence learning (or wire receipts).
4. ⚠️ **Instacart pre-filled cart, live.** Verify the `instacart-cart` edge fn
   returns a real pre-filled URL (fallback-to-search is already proven).
5. ⚠️ **Grocery list sync.** It's local-only; add the Supabase table so the Cart
   survives a device switch.

**P2 — richness / "aliveness" the north star wants (deferred by plan):**
6. ⚠️ **Gym "Transformation" system** (goal-aware targets, 62→72 roadmap,
   physique milestones) from the old app is not ported.
7. ⚠️ **Barcode + camera leg** unproven device-less; **no AI *nutrition* estimate
   from a plate photo** (only barcode + manual).
8. ⚠️ **The living avatar / cosmetics / DayPlan / R2 game** — the biggest
   north-star "alive" pieces — are not built (rift seam is an inert placeholder).
9. ⚠️ Weigh-in **trend chart** (visual time-series) + a richer living Home.

**Bugs (❌):** none found this pass. The one honesty-critical class (stale
cross-screen views) is fixed and re-verified.

---

## Honest caveat about this verification

Everything above the "cloud edges" is proven with **in-memory fakes wired
exactly as the real composition root wires the repos** — so the *app logic and
interconnection* are genuinely verified, headless and deterministic. What a
device-less run **cannot** prove — and this report does not claim — is the
behaviour of the live Supabase auth/sync/edge functions and the real camera.
Those are the P0 items precisely because they're the unverified surface.
