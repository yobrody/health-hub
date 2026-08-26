# Security audit — first deep pass (2026-08-26)

Scope: the live attack surface — Supabase RLS, the 4 edge functions, secrets
handling, client exposure, CI. The legacy FastAPI backend got a lighter pass
(flagged for its own). Method: manual review + greps; this is the "what the best
security agent does" first pass, now backed by automated scanners (below).

## Verdict: strong posture, no critical holes. A handful of hardening items.

### ✅ What's already right (don't regress these)
- **Multi-tenant isolation (the big one) is textbook-correct.** All 9 public tables
  have RLS **enabled AND forced**, with 36 policies — every one keyed on
  `auth.uid() = user_id`, scoped `to authenticated`, correct `using` vs
  `with check` (INSERT checks ownership; UPDATE checks both). Anon = deny-all.
  (`supabase/migrations/0002_rls.sql`.)
- **No secrets in the client.** No `service_role`, no AI/commerce keys in `app/lib`.
  `secrets.dart` only holds header/storage *key names*; values come from secure
  storage / dart-defines. All server secrets are `Deno.env.get(...)` /
  function secrets (`OPENROUTER_API_KEY`, `INSTACART_API_KEY`).
- **All 4 edge functions require the caller's JWT** (`401` without `Authorization`);
  JWT verification on by default (per-user actions).
- **Honest, non-leaky error handling.** Failures return typed statuses
  (`bad_request`/`upstream_error`/`internal_error`); unexpected throws → Sentry
  (error *type* only, no PII) → generic `500`. Careful input normalization
  (`macro()`, `nonEmptyString()`) — no fabricated data, no stack traces leaked.
- **Secrets gitignored** (`.env*`, `.supabase-admin.local`) + **gitleaks in CI**.

### ⚠️ Findings to fix (prioritized)
| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | **No rate limiting** on the LLM-calling edge functions (`plan-week`, `estimate-nutrition`, `recognize-pantry`). An authenticated user can spam paid Gemini calls (maxTokens up to 4096) → cost-abuse / DoS. | **Medium** | Per-user quota — a `usage` table + a cheap counter check, or Supabase's rate-limit primitives. Do before public launch. |
| 2 | **No dependency/SAST scanning** in CI. | Medium | ✅ **Added this pass** — Dependabot (pub/pip/npm/actions) + CodeQL (TS + Python). |
| 3 | **CORS `Access-Control-Allow-Origin: *`** on all edge functions. | Low | JWT-gated so not exploitable for data theft, but tighten to the app origin(s). |
| 4 | **Prompt injection** — user text (prefs, pantry, food descriptions) is interpolated into LLM prompts. | Low (currently) | Bounded today because LLM output is strictly re-normalized to a fixed schema and **never reaches a privileged sink** (no SQL/shell/eval from model output). Keep that invariant; add input length caps. |
| 5 | **FastAPI backend** (`api/main.py`, ~3,558 lines) still deployed — only a light pass here. | Medium | Give it its own deep pass: `X-Health-Key` auth strength, input validation, injection, and whether it's still needed post-Flutter-pivot (retire if not). |
| 6 | **No in-app account deletion** (also an Apple requirement). GDPR right-to-erasure. | Medium | Build the delete-account flow (Settings) + a server-side purge of all user rows. |
| 7 | **Photo "instant-delete" guarantee** (planned feature) not yet built. | Design invariant | When built, it must be **provably delete-on-read** — processed in memory, never written to storage/logs. This is a promise we cannot break. |
| 8 | **Health data = GDPR "special category."** | Compliance | Privacy policy + a data-handling/retention note before real users; document what's stored, where (EU region ✓), and deletion. |

## The best version = ongoing, layered (now partially in place)
1. **Automated in CI (added):** gitleaks (secrets) + **Dependabot** (dep CVEs) +
   **CodeQL** (SAST on TS + Python). Free on the public repo.
2. **A recurring deep agent audit** (this doc's method) run **pre-release** and after
   any auth/RLS/edge-fn change — covers RLS correctness, auth flows, input
   validation, PII, injection, rate limits.
3. **Supabase invariants enforced** (RLS forced ✓, service_role server-only ✓, JWT ✓)
   — re-verify after every migration via `apply_migrations.py verify-only`.
4. **A real third-party pen-test before taking payments.**

**How useful: very.** Health data + auth + soon payments means one RLS hole or a
broken photo-promise = exposed users = fatal for a trust-brand. Highest ROI right
before launch — and cheap now that the automated layer is wired.
