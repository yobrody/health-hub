# Live-verification playbook — how to prove a change actually works

The device-less answer to "does this really work?" for Health Hub. Pick the
**cheapest route that actually exercises the thing you changed** — then keep this
file current when a new route is found. The `live-verifier` agent
(`.claude/agents/live-verifier.md`) orchestrates these.

## Route table — change type → fastest live check

| You changed… | Fastest route | How |
|---|---|---|
| **A screen / widget** (layout, colours, states) | **Golden render + eyeball** | Add/keep a case in `app/test/goldens/screens_golden_test.dart`; `flutter test --update-goldens --tags golden`; **Read** the PNG in `app/test/goldens/images/`. Catches overflow, contrast, honest empty states, premium-ness. |
| **An edge function** (Deno + Gemini) | **Authed live smoke** | `python supabase/smoke_edge.py <fn> '<json-body>'` — real signed-in user, real model, real response. Exit 0 iff 2xx. |
| **A migration / RLS / grants** | **Apply + verify live** | `python supabase/apply_migrations.py` — applies + prints RLS enabled/forced + policy counts per table. |
| **Domain logic or a user flow** (providers, repos, services, navigation) | **Driven e2e test** | Extend `app/test/e2e/…` — pumps the REAL `HealthHubApp`/page with `JourneyHarness` fakes and taps through as a user. No device. |
| **The whole loop, as a user, with REAL AI** | **Lived session** | Drive `smoke_edge.py plan-week` with realistic goals+pantry → feed the plan through the real `neededIngredients`/`resolveDeductions` in a Dart test or a quick script. This is what found the name-match bug (2026-08-24). |
| **Auth gating on a function** | **Gateway curl** | `curl -s -o /dev/null -w "%{http_code}" -X POST <BASE>/functions/v1/<fn>` → expect `401` unauthenticated. |
| **Anything, for a HUMAN on a real iPhone** | **Web build → GitHub Pages** | Push to `main` → `pages.yml` deploys → open `https://yobrody.github.io/health-hub/` in iPhone Safari. The only true on-device path without an Apple account. |
| **A pure function / calculation** | **Unit test (TDD)** | `flutter test test/…` — write it first. Not "live", but the cheapest proof for pure logic. |

## Principles
- **Match the route to the risk.** A colour tweak → golden. A new edge fn → authed smoke. A migration → apply+verify. Don't run the full suite to check a one-line copy change.
- **Real fonts + real shadows** in goldens (the harness handles it) — otherwise you're reviewing a lie.
- **Live smokes create + delete a throwaway user** — never touch real data; never print secrets.
- **Honesty is the thing to verify**, not just "it renders": does it ever show a guessed/stale/0 value? The lived-session route is best at catching this (it found the false-gap bug that unit tests passed).
- **Keep this table current.** New surface → add its route here + teach the agent.

## Secrets / prerequisites
- `.supabase-admin.local` (gitignored) — `SUPABASE_ACCESS_TOKEN` (PAT) for the Management API.
- `app/env.local.json` (gitignored) — the anon/publishable key.
- Flutter on PATH: `export PATH="$PATH:/d/dev/flutter/bin"`.
- Project ref: `eazwtlqieizvsqvbbknj`.

## Should this be an agent? — yes, and it is
The routines are reusable **scripts** (`smoke_edge.py`, `apply_migrations.py`, the
golden harness); the **`live-verifier` agent** is the thin orchestrator that,
given a diff, picks the right route(s), runs them, reads any rendered images, and
reports pass/fail with evidence. Invoke it after a change that needs a live
check — especially edge functions, migrations, and UI.
