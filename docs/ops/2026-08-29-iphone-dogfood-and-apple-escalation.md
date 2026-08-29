# Get the app on your iPhone 13 — two tracks

You have an iPhone 13 and no working paid Apple account (enrollment stuck). Both
tracks below run in parallel: Track 1 fixes the real thing (needed for launch),
Track 2 gets you dogfooding *this week* without it.

---

## TRACK 1 — Unstick the Apple enrollment (the clean fix, and you need it to launch)

Weeks-pending + a double-charge is snagged on Apple's side (usually a legal-name
mismatch, a payment hold, or stuck identity verification). This is a **support
case, not a wait.**

**Do first (2 min):** at [developer.apple.com/account](https://developer.apple.com/account) confirm
(a) your Apple ID shows your **exact legal name** (no nickname), (b) **region +
billing address + phone all the same country**, (c) a valid card on file. Note your
**Enrollment ID** and any **Order ID**.

**Then file it** at [developer.apple.com/contact](https://developer.apple.com/contact) → *Membership & Account* →
*Enrollment*. Paste this:

> Subject: Enrollment pending for weeks + duplicate charge — request manual review
>
> My individual Apple Developer Program enrollment has been "pending" for several
> weeks and I was charged/held **twice** across two attempts, with no activation.
> Enrollment ID: **[yours]**. Order ID(s): **[yours]**. My Apple ID uses my exact
> legal name, correct country/billing, and a valid card. Please (1) tell me exactly
> what is blocking activation (identity verification? payment?), (2) manually
> activate the membership or refund the duplicate charge, and (3) confirm my
> identity-verification status. I'm blocked from TestFlight and the App Store. Thank you.

Also **post the same on the [Developer Forums](https://developer.apple.com/forums/)** (Program/Enrollment) — Apple
staff monitor and escalate there. **Do NOT re-pay or re-enroll** — it tangles the case.

---

## TRACK 2 — Full app on your iPhone this week, free Apple ID, via SideStore

SideStore sideloads the real native app with your **free** Apple ID — no paid
account, no App Store. **Honest trade-offs:** the app cert lasts **7 days**
(SideStore auto-refreshes on-device), max **3** sideloaded apps per Apple ID, and
**HealthKit (step/health sync) + push notifications won't work** (Apple locks those
to paid accounts — I strip them so it installs cleanly). **Everything else — the
whole core loop, workouts, physique, the UI — works.** That's the ~90% that matters
for finding real problems.

### Steps
1. **Get the IPA (me + you):** I've added a `sideload-ipa` workflow to
   `codemagic.yaml`. Connect the `health-hub` repo in [Codemagic](https://codemagic.io) (free tier,
   no Apple account needed for THIS build), run **`sideload-ipa`**, and download the
   artifact **`HealthHub-sideload.ipa`**. *(First run is unverified from my Windows
   box — it's the standard unsigned-IPA recipe; if it errors I'll fix it fast.)*
2. **Install SideStore** on your iPhone: follow [sidestore.io](https://sidestore.io) (one-time setup from
   your Windows laptop; it pairs your device + your free Apple ID). SideStore is
   preferred over AltStore because it refreshes **on-device** — no always-on PC.
3. In SideStore, **sign in with your free Apple ID**.
4. Tap **＋ → select `HealthHub-sideload.ipa`** → install.
5. On the iPhone: **Settings → General → VPN & Device Management → trust** your
   developer profile. Open the app. SideStore keeps it alive (7-day auto-refresh).

You're now dogfooding the real app on your real phone — the whole point.

---

## Why both
Track 1 is the durable, launch-ready path (and TestFlight for your first testers).
Track 2 removes the "I can't use it" blocker *now* so real problems surface while
Apple sorts itself out. Using it > waiting for perfect.
