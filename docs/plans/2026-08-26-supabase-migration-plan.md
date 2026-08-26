# Supabase migration plan — the "backup" that's ready to pull

Purpose: a ready-to-execute plan so the moment the bill justifies it, we move
without scrambling — and so when Brody says "let's do the switch," we both know
exactly what that means. Refines the trigger DOWN from ~$200 and rejects
self-hosting on the personal box.

> **TL;DR:** stay on Supabase (it's fine + 95% margin) but **watch the bill from
> ~$50/mo**; when it sustains **~$100/mo** despite optimization, migrate the DB to
> **DigitalOcean Managed Postgres** (managed, isolated, ~$15/mo, predictable) — NOT
> self-hosted, NOT the personal Hetzner box. Local-first pushes this out to ~10k+
> active users, and makes the migration a thin layer.

## Is self-hosting even the best method? No.
For a solo founder, **managed is the best method** — self-hosting Postgres means you
personally own backups, PITR, failover, patching, monitoring, incident response
(~10–20 hrs/month), and putting a production consumer DB on the **personal
life-ops Hetzner box co-mingles risk** (one box, one blast radius, your other
services). The right target is a **dedicated managed Postgres**, isolated from
everything else. Self-host stays a *theoretical* floor, not the plan.

## The trigger (lowered + tiered, so we're never surprised)
$200 was too high — here's an early-warning ladder on the **sustained monthly bill**
(the real driver is egress at $0.09/GB over 250 GB, then compute):
- **~$50/mo → REVIEW + OPTIMIZE + keep this backup ready.** Right-size compute, move
  images/assets to a CDN/R2 (egress is the usual culprit), consolidate projects.
  Usually this alone resets the bill for far less effort than migrating.
- **~$100/mo sustained despite optimization → EXECUTE** the DB migration below.
- Also migrate early (regardless of bill) if a **non-cost** trigger hits: EU-user
  write latency, a compliance/data-residency ask, or a needed extension Supabase
  won't run.

Local-first (our decided architecture) keeps server reads/egress low, so realistically
these triggers arrive around **~10k–50k active users**, not hundreds — but the ladder
means we act on the *bill*, not a guess.

## The target (when we execute)
**DigitalOcean Managed Postgres** — ~$15/mo bundled (backups, monitoring, failover,
read replicas), predictable pricing, "just run my DB," isolated. Best fit for a solo
founder who wants zero ops and no surprise bills ([comparison](https://www.bytebase.com/blog/postgres-hosting-options-pricing-comparison/), [DEV: RDS vs Supabase vs Neon vs self-host](https://dev.to/philip_mcclarence_2ef9475/best-postgresql-hosting-in-2026-rds-vs-supabase-vs-neon-vs-self-hosted-5fkp)).
- **Alternatives considered:** **Neon** (serverless, cheap-when-idle + branching, but
  **cold-starts** hurt a consumer API unless you pay for a warm floor); **Aiven**
  ($19+, multi-cloud — overkill unless multi-cloud is the point); **AWS RDS** (only
  if we're already deep in AWS); **Crunchy Bridge** (Postgres-purist; Snowflake-owned
  now). DO wins on predictable + simple + isolated for our shape.

## The migration runbook (data is easy; auth is the real work)
Supabase is **standard Postgres**, so the data move is straightforward; the hidden
work is roles/RLS and re-homing Auth ([Supabase→Postgres guide](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres), [Migrating off Supabase](https://witscode.com/blogs/migrate-off-supabase)):
1. **Provision** the DO Managed PG instance; validate our extension set (pgvector etc.).
2. **Data:** `pg_dump` → `pg_restore`. **Roles/users + RLS policies are NOT migrated**
   — recreate them explicitly (script this from our `supabase/migrations/`).
3. **Auth (the biggest piece):** Supabase Auth = GoTrue against the `auth` schema.
   Options, cheapest-risk first: (a) **keep Supabase Auth** running even after the DB
   moves (auth is light, so this defers the hard part — recommended first step);
   (b) when needed, self-host GoTrue or move to another auth provider. **Password
   hashes are bcrypt → they migrate without forcing any user to reset.**
4. **Phased/zero-downtime:** logical replication / a sync tool (e.g. DBSync) to keep
   old+new in sync, then cut over — no downtime.
5. **Re-point the client** (`SUPABASE_URL`/keys → new connection) behind our existing
   client seam; **verify RLS + a full auth+CRUD smoke** (reuse `supabase/smoke_edge.py`
   pattern) before flipping traffic. Roll back = re-point to Supabase (kept warm).

## What local-first changes
Because the client is the source of truth and the backend is sync/backup, the DB we
migrate is **not a hot per-request path** — it's a thin sync/aggregate store. That
(a) delays the trigger for a long time and (b) makes the eventual migration a
low-risk move of a thin layer, not a transactional core. See
`2026-08-25-data-architecture-and-scaling.md`.
