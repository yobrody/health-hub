# Tooling audit — what would've helped, what to add next

Per the standing "always hunt for better tooling" directive. Honest, specific to
where Health Hub actually is (functionally done → launch → traction → raise).

## What earned its keep (keep using)
- **Subagents `bug-hunter` + `live-verifier`** — bug-hunter caught real bugs on
  every run (honesty blocker, concurrency, spinner-lock, false-gap); live-verifier
  + the reusable `supabase/smoke_edge.py` prove edge changes live. Both stay core.
- **Golden screenshot harness** — the device-less way to *see* every screen; caught
  the float-overflow + let me review the plan UI in pixels.
- **Supabase Management API + `apply_migrations.py`** — migrations/RLS/secrets without a console.
- **GitHub MCP** (PRs/merge) + **Google Calendar MCP** (the Enterprise reminder).

## Would've helped already (retrospective — adopt now)
- **Context7 (docs MCP)** — would've saved the OpenRouter model-id + `max_tokens`
  debugging and Gemini→OpenRouter mapping guesswork. Use it for Supabase / Flutter /
  OpenRouter / Instacart docs from here.
- **Stable Playwright MCP** — kept disconnecting, so I couldn't self-verify the
  pitch-deck render or drive the web app in a real browser. It's back — use it to
  screenshot the deck + do true web e2e once Pages is live.
- **A secret scanner (gitleaks / trufflehog / GitHub secret scanning)** — I
  hand-rolled a git-history scan before recommending the repo go public; a scanner
  in CI (or a pre-commit hook) makes that durable. **Add before/with going public.**

## Add next — ranked by leverage for the road ahead
1. **PostHog (product analytics)** — THE tool for the retention / north-star
   instrumentation that is the traction gate (D-7/D-28, loop-completion, funnels).
   Highest priority the moment we launch. Flutter SDK + a management MCP exist.
2. **Sentry (error monitoring)** — the app + the 3 edge functions, before real
   users hit them. Cheap insurance.
3. **gitleaks in CI** — secret scanning now that the repo is (about to be) public.
4. **Asana (just connected)** — load the P0→P2 `solo-founder-checklist` as a real
   task board so the roadmap is tracked, not just documented. *(Offer stands.)*
5. **Stripe (MCP available)** — when the Pro tier lands (billing + entitlements).
6. **Resend / email** — transactional (auth, waitlist, weekly recap that drives the
   organic share loop).
7. **Instacart Developer Platform** — the demo + Connect API for real 1-tap orders
   (partner integration, not an MCP; deep-link hand-off works meanwhile).
8. **A trademark/domain sweep** — USPTO TESS (free) + domain/App-Store checks for
   the naming decision (I can run it on a direction).

## Agents/skills worth building later
- A **release-checklist** agent (pre-launch gate: secrets scanned, Pages live,
  monitoring on, ToS/privacy present, smoke green).
- A **traction/analytics** agent once PostHog is wired (weekly retention readout).

## The one that matters most right now
**PostHog** — because the single gate is turning the app into retention numbers.
Everything else is insurance or convenience; analytics is the fuel for the raise.
