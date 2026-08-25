# Data architecture & scaling — the decision (local-first + thin backend)

Supersedes the vaguer "just ship on Supabase" note. Records the architecture
decision and the trigger points that flip each future call, so scaling is done
on **numbers, not vibes** — and never ahead of users.

> **The one-line decision:** the phone is the source of truth for personal data
> (on-device SQLite), and the backend shrinks to only what *must* be central
> (AI-key proxy, commerce, auth/sync-backup, aggregate/moat signal). We **decide
> this now, build it incrementally, and never ahead of real users.**

---

## Context (why this came up)

Concern raised: Supabase is convenient now but will bill heavily at traffic, and
the alternatives floated were (a) DigitalOcean droplets — frontend+backend on one,
a dedicated large-connection-pool DB on another — plus (b) Redis caching and a
Fastify backend, i.e. self-hosting the stack. A further idea: could users just run
the app **locally on their phone**?

We have **zero users right now** (the PostHog North Star dashboard "populates when
real users arrive"). That reality gates everything below.

---

## Part 1 — Rejected: pure on-device (no backend)

"Runs entirely on the phone, no server" is **not viable** for this product. Five
hard blockers:

1. **The AI key.** "An AI that runs your food life" = cloud LLM planning. Pure-local
   means shipping the API key in the app (extractable → credit theft) or each user
   bringing their own key (kills "*democratize* the AI nutritionist"). Protecting
   the key **requires** a server proxy. This alone ends pure-local.
2. **Grocery commerce.** Instacart Connect / retailer OAuth + affiliate secrets can
   never live on a device. The "fills your cart / reorders" half is inherently
   server-side.
3. **Backup / multi-device / web.** A health journal that dies with a lost or
   upgraded phone is a trust-killer — and we already ship a **web** app, which
   pure-local can't serve.
4. **It guts the moat.** The moat is *compounding per-user data*. If that data lives
   only on losable devices and never touches our infra, there's no aggregate signal,
   no cross-user improvement, no "it learns" — the moat evaporates.
5. It doesn't even save infra — you still need a server for 1–3.

## Part 1b — Rejected (for now): self-hosted droplets

- **Frontend on a droplet is a downgrade.** The frontend is a Flutter *web* app —
  static files that belong on a CDN (GitHub Pages today → Cloudflare Pages), giving
  edge caching and cheap bandwidth. A single droplet loses the CDN. The "4TB
  bandwidth" figure is a red herring: this app moves tiny JSON; image bytes belong
  in object storage + CDN.
- **A dedicated DB droplet with a big connection pool** is legitimate *scale*
  architecture — but Supabase already gives managed, pooled Postgres (Supavisor,
  transaction mode). Self-hosting means owning backups, PITR, failover, replication,
  and patching — a DBA/SRE tax a solo founder pays before feeling any benefit.
- **Redis / Fastify:** see triggers below — one narrow early win (caching expensive
  external/AI calls), the rest premature.
- Portability insurance: Supabase is **plain Postgres**, so migrating off later is a
  `pg_dump`, not a rewrite. Deferring costs almost nothing.

---

## Part 2 — Decided: local-first client + thin sync/proxy backend

### The shape
- **On-device (source of truth):** a real embedded SQLite DB (**Drift**) holds logs,
  weight, pantry, preferences. UI serves instantly from the device; the app is fully
  usable offline. The honesty/tracking logic is already client-side.
- **Thin backend (only what must be central):**
  1. **AI proxy** — holds the LLM key, rate-limits, controls cost (today: Supabase
     Edge Functions in Deno — already the right shape).
  2. **Commerce** — grocery/retailer integrations.
  3. **Auth + sync/backup** — so data survives device loss + spans web/phone.
  4. **Aggregate / moat signal + PostHog** — the anonymized cross-user learning.

### Why this is the real answer to the cost concern
The Supabase bill scales with **server reads**, and local-first eliminates most of
them. Serving screens from the device means Postgres is hit for **sync/backup**, not
for *every glance at macros*. That pushes the "Supabase gets expensive / need
droplets" question **years** out — and when it returns, we migrate a thin sync layer,
not a hot transactional core. Cheaper, more private, faster, more scalable — and it
**keeps the moat** because the aggregate still lands on our infra.

### We're already ~60% there
Existing seam (do **not** rebuild): `lib/offline/outbox.dart` + `outbox_store.dart`
(offline write queue) and `lib/sync/{supabase_sync_sender,supabase_hydrator,
sync_service,connectivity_monitor,supabase_writer}.dart`. The gap is that on-device
persistence is `shared_preferences`, not a real DB. **The only structural change is
swapping `shared_preferences` → Drift as the local source of truth**, with the
existing outbox/hydrator as the sync bridge. Incremental, on rails we already built.

---

## Part 3 — Trigger points (build on numbers, not vibes)

Nothing below gets built until its trigger fires. Guarding against premature scaling
(the #1 pre-PMF startup killer).

| Change | Build it WHEN (trigger) | Not before, because |
|---|---|---|
| **Local-first (Drift on-device store)** | Retention proven on the first ~50 users AND offline/perf friction is real, OR the Supabase read bill starts climbing | Current offline-tolerant stack serves 50 users fine; decision is banked, build is incremental |
| **Redis (cache external/AI calls)** | Gemini/OFF spend becomes a visible line item, OR external-call latency hurts UX | Early narrow win; DB-query caching solves read load we don't have yet |
| **Redis (DB read cache)** | Read QPS actually strains Postgres despite pooling | Our data is per-user + write-heavy; small cacheable surface |
| **Own backend service (Fastify or FastAPI)** | Need background jobs / websockets / long-running work, OR hitting edge-fn limits | Edge functions (Deno) work today; a 3rd runtime adds cost, no user benefit |
| **Move DB off Supabase-managed** | Supabase bill clears a real monthly threshold AND pooling can't hold connections AND ops bandwidth exists (realistically 10k+ active users) | It's portable Postgres; migrate when traffic funds it |
| **CDN upgrade (GitHub Pages → Cloudflare Pages)** | Web traffic grows or we want a custom domain + better caching | Cheap, do opportunistically; not urgent |

---

## Part 4 — What to do now (the sequence)

1. **Ship on the current stack.** Get the first ~50 wedge users; measure D-7/D-28.
   Let real load + a real bill say what to optimize.
2. **Keep it portable** (already true: plain Postgres + client seams + the
   outbox/sync layer). Cheap insurance that makes every future migration a weekend.
3. **When AI cost gets real:** cache expensive Gemini/OFF responses (start with a
   Postgres table or Redis) — the one early item from the self-host wishlist.
4. **When retention is proven:** execute the local-first step (Drift), reusing the
   existing outbox/hydrator seam.

**Do not** build droplets, a dedicated DB box, Redis, or a Fastify rewrite ahead of
the users that would justify them.
