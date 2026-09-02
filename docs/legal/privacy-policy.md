# Privacy Policy — Health Hub

_Last updated: 2026-08-31 · **DRAFT** — accurate to how the app handles data today,
but have a solicitor review before launch. Fill the **[BRACKETED]** items._

**[Health Hub / your legal name or company]** ("we", "us") operates the Health Hub
app. This policy explains what we collect, why, who it's shared with, and your
rights. We take a **privacy-first, honesty-first** stance: we never sell your data,
and our analytics/error tools are configured to carry **no personal or health
values**.

## Who's responsible (Data Controller)
**[Your legal name / company], [address], [contact email].** For UK/EU users this is
the data controller under UK GDPR / EU GDPR.

## What we collect
- **Account:** your email address and an authentication record (password is stored
  only as a salted hash by our auth provider — we never see it).
- **Profile you enter:** first name, and optionally age, sex, height, weight, body
  measurements, activity level, and your goals.
- **Health & fitness data you log:** weigh-ins, workouts and sets, food/nutrition
  logs, pantry items, and grocery lists. **This is "special category" health data
  under GDPR** and is processed only with your explicit consent (see Legal basis).
- **Photos you take** (e.g. of food or your fridge): the image is **sent to our AI
  provider to recognise the contents**, and the recognised result (text/macros) is
  what we store — **we do not store the photo itself** in our database. _(A future
  version will process photos entirely in-memory and delete them immediately; until
  that ships, this describes the real behaviour.)_
- **Usage analytics:** product-usage events via **PostHog** (EU region), configured
  to capture **counts and feature usage only — never your name, email, food, weight,
  or any health value.**
- **Error diagnostics:** crash/error reports via **Sentry**, configured to send the
  **error type and stack only — no PII, no health values, and performance tracing off.**

## Legal basis (UK/EU GDPR)
- **Contract** — to provide the app you asked for (account, planning, tracking).
- **Explicit consent** — for your **health/fitness special-category data**; you can
  withdraw at any time by deleting the data or your account.
- **Legitimate interests** — minimal, privacy-preserving analytics + error monitoring
  to keep the app working (balanced against your rights; no profiling that affects you).

## Who we share it with (processors — not sold, ever)
- **Supabase** — database + authentication, hosted in the **EU (Frankfurt)**. Your
  rows are isolated per-user by row-level security.
- **Google (via OpenRouter)** — AI processing: the **text and any photos** needed for
  meal planning / food recognition are sent to generate your result. Not used to
  train models on your identity; not stored by us beyond the returned result.
- **PostHog (EU)** — PII-free product analytics. **Sentry** — PII-free error reports.
- **Instacart / grocery partners** — _only if/when you use grocery reordering_ (not
  yet live); we'd share the shopping list needed to build your cart.
- **Legal** — if required by law.

We do **not** sell your data or use it for third-party advertising.

## Where your data lives + how long
Stored in the EU (Supabase, Frankfurt). We keep it while your account is active.
**Delete your account in the app (Settings → Delete account)** and we permanently
erase all your data from our systems (verified — it removes every table + the auth
record). You can also delete individual entries anytime.

## Your rights
Access, rectification, **erasure** (in-app Delete Account), restriction, portability,
and to withdraw consent or object. To exercise any, use the in-app controls or email
**[contact email]**. You may also complain to the UK **ICO** (or your local authority).

## Security
Encryption in transit and at rest, per-user row-level security (a user can only ever
access their own rows), secrets kept server-side, and dependency + code security
scanning in our pipeline.

## Children
Health Hub is **not for under-16s** (or the minimum digital-consent age in your
country). We don't knowingly collect data from children.

## Changes
We'll update this page and change the "Last updated" date; material changes will be
notified in-app.

## Contact
**[contact email]** · **[Your legal name / company], [address]**.
