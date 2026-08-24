# Solo-founder master checklist — everything to reach the fully-developed plan

Honest, ordered, end-to-end. Tagged **[you]** (only you can) · **[me]** (I can do
in-repo) · **[both]**. Priority: **P0 = do first / unblocks users**, P1 = before
raising, P2 = after signal. The through-line: the product is functionally done —
**the gate is getting real users + the company/raise scaffolding**, not features.

## P0 — Get it in front of real users (this is the whole ballgame)
- **[you] Enable GitHub Pages** (Settings → Pages → Source: "GitHub Actions"). The
  repo is **private**, so this needs the Enterprise/Pro plan you just activated.
  → makes `yobrody.github.io/health-hub/` live = the app usable on any phone, no
  Apple. **Nothing else about traction matters until this is done.**
- **[me] Verify the live site end-to-end** once Pages is on (via `live-verifier`).
- **[me] Production LLM key** — swap the edge functions to your OpenRouter key
  (in progress) so real users don't hit the free/personal Gemini key. Deploy + smoke.
- **[you] A one-page landing + waitlist** (or just the live app link) to point
  people at. **[me] can build the landing page** in-repo.
- **[you] Launch to ~50 organic users** — personal network, r/fitness / r/nutrition,
  X, relevant Discords. Ask for honest feedback; watch them use it.
- **[both] Instrument the north-star + retention** (D-7/D-28, loop completion) —
  lightweight events. **[me] can build it**; turn on at launch.

## P0.5 — The 3 blocking decisions (needed for the deck + product)
- **[you] Name + domain + icon.** "Health Hub" is generic/likely taken. **[me] can
  re-run the free naming sweep** (USPTO TESS + domain/App-Store checks) on a
  direction you give, then you pick + buy the domain.
- **[you] Pricing** — pick a Pro price to state and test (e.g. $6–10/mo). 
- **[both] LLM provider** — OpenRouter (Gemini Flash) now; revisit per cost/quality.

## P1 — Company & legal (before you take money)
- **[you] Incorporate a Delaware C-corp** (Clerky / Stripe Atlas ~$500) — YC funds
  DE C-corps; do this before/at YC, not after.
- **[you] Founder IP assignment** — assign all the code/IP to the company (clean as
  a solo founder; Clerky/Atlas includes it). Confirm nothing is owned by an employer.
- **[you] Cap table + option pool** — model post-YC (~7%) + a ~10% pool.
- **[both] Terms of Service + Privacy Policy** — health data ⇒ be explicit:
  per-user RLS, offline-first, minimal collection, never sold, **not medical
  advice** disclaimer. **[me] can draft**; a lawyer/template reviews.
- **[you] Business bank + accounting** (Mercury/Brex + a bookkeeping tool) — after incorp.

## P1 — Production-readiness (before real scale)
- **[me] Error monitoring** (Sentry or similar) on the app + edge functions.
- **[me] Rate-limit / abuse guard** on the edge functions (they cost money per call).
- **[me] Backups verified** for the Supabase data (RLS is on; confirm PITR/backup).
- **[both] Cost watch** — OpenRouter + Supabase spend as usage grows (cents/user now).
- **[you] Apple Developer** (when it clears) → native iOS + App Store; **not
  blocking** — web covers iPhone until then.
- **[you] Instacart demo** → the real Connect API for 1-tap ordering (deep-link
  hand-off works meanwhile; **not blocking**).

## P1 — The raise (YC + seed)
- **[both] Finish the deck** — fill the traction numbers once the ~50-user cycle
  runs; lock the name. **[me] iterate `docs/deck/health-hub-deck.html`.**
- **[you] YC application** — the written answers (draft in `deck-readiness.md`) +
  **the 1-minute founder video** (solo, show the loop for ~15s).
- **[both] Mock-interview Q&A** — the rapid-fire questions (in `investor-metrics.md`);
  rehearse one-breath answers. **[me] can draft the Q&A.**
- **[you] Apply** in the batch window; keep shipping + growing while you wait.

## P2 — After you have signal (don't do these early)
- Single-meal swap, per-person/serving scaling, deeper coaching, the R2 game world.
- Paid acquisition (only once the organic loop + retention are proven).
- Native apps / TestFlight (once Apple clears + web has traction).

## What I (in-repo) can knock out right now, on your word
1. Finish + deploy the OpenRouter swap (in progress) + smoke it.
2. Build the retention/analytics events (ready to flip on at launch).
3. Build a one-page landing/waitlist page.
4. Draft ToS + Privacy Policy + the not-medical-advice disclaimer.
5. Re-run the naming sweep (on a direction).
6. Draft the YC written answers + mock-interview Q&A.

## The honest one-liner
You are ~1 enable-Pages click + ~50 users away from turning a finished product
into a fundable story. Everything else is scaffolding around that.
