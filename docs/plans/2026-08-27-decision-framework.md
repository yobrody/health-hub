# The Decision Framework — nothing arbitrary, a reason for everything

**Why this exists:** the design kept feeling "AI / reactive" because choices were
made by *avoiding* what's bad, not *grounding* in what's right. This is the master
list of everything a brand/design/product decision should run through — each with
its evidence source and the reason it matters — so every choice is defensible and
our success rate goes up. **The rule: if we can't state the reason, we don't ship
the choice.** This is the umbrella; it references the deeper docs we've already
built (analog playbook, naming/brand framework, moat/audience, gym spec).

---

## THE DECISION PROTOCOL (run every real choice through this)
1. **Which determinants apply?** (from the list below)
2. **What does the evidence say?** (name the source)
3. **State the reason** in one sentence.
4. **Validate + measure** where possible (survey, PostHog, the 40% PMF test).
5. **No reason → don't ship it.** Kill anything we can't justify.

---

## THE DETERMINANTS (the full list of "everything important")

### 1 · The problem & the user — the foundation everything sits on
| Determinant | Why it drives decisions | Evidence source |
|---|---|---|
| **Jobs-to-be-done / what we solve** | the real job we're hired for shapes every screen + word | interviews, review-mining, our own dogfooding |
| **Demographic** (age, sex, income, location, training level) | who we design + write + price for | Statista, competitor audience tools (Similarweb/Semrush), PostHog once live |
| **Psychographic** (identity, goals, values, frustrations, aspirations) | *why* they buy → the emotional job + voice | interviews, Reddit/forum mining, competitor 1–3★ reviews |
| **Behaviour** (apps used, spend, frequency, where they gather) | channels + feature bar + habits to hook into | competitor overlap, surveys |
| **Wedge ICP** (goal-driven physique-changers, first) | keeps us narrow + provable, not everything-for-everyone | our moat/audience doc |

### 2 · Market & competition — so we differentiate, not blend
| Determinant | Why | Source |
|---|---|---|
| **Market size + growth** (TAM/SAM/SOM) | is it big enough; where it's heading | Statista / Grand View / IBISWorld |
| **Same-category branding** (Cal AI, Noom, MyFitnessPal, Whoop, Fitbod, Gymshark) | what's *saturated* (avoid) + what's ownable | analog playbook + direct audit |
| **Adjacent-category branding** (Apple, Aesop, editorial mags, premium auto) | borrow premium cues from *outside* fitness to stand apart | curated reference audit |
| **Positioning / the gap we own** | the one sentence no competitor can say | moat doc ("honest AI that runs your whole food + training life") |
| **Competitive teardown** (their onboarding, pricing, retention) | steal what works, avoid what fails | analog success playbook |

### 3 · Brand strategy — the meaning the visuals must express
Positioning statement · brand **archetype** · core **values** (honesty, aspiration,
calm-confidence) · **voice & tone** · the **emotional job** ("what feeling we sell")
· the **name** (its own gated framework). → see the naming/brand doc.

### 4 · Visual & design — grounded, not vibes
| Determinant | Why it matters | The reasoned basis |
|---|---|---|
| **Colour theory** | hue psychology, meaning-in-category, mood | 60-30-10 rule; contrast + WCAG AA; our charcoal/bone/amber chosen for *premium restraint* (Whoop/Oura/Equinox), amber = energy/appetite without neon — each hue justified |
| **Typography** | legibility + personality + hierarchy | pairing rules, x-height/legibility, licensing; a refined editorial sans, not a wellness serif |
| **Imagery / art direction** | aspiration comes from imagery, not clip-art | real cinematic physique photography > cartoon SVG (proven by the welcome concept) |
| **Layout & hierarchy** | guides the eye to one action | visual hierarchy, one-primary-action-per-screen, F/Z scan patterns |
| **Motion** | delight + meaning, not decoration | high-impact moments only; performance-safe |
| **Platform conventions** | native feel = trust | Apple HIG (iOS-first); expected patterns |
| **Accessibility** | reach + App Store + ethics | contrast ratios, ≥44px targets, dynamic type, VoiceOver |

### 5 · Behavioural & conversion science — why people act
Behavioural design (Hooked / loss-aversion / variable reward / commitment) ·
onboarding conversion (Noom commitment quiz × Duolingo aha, short time-to-value) ·
retention mechanics (streaks, a leading indicator). → analog playbook.

### 6 · Product & monetisation
The core loop (snap → plan → cart → deduct → reorder) · pricing (~£5–10 auto-reorder,
to validate) · the **honesty spine** (never a fabricated number) · feature priority
(wedge-first).

### 7 · Distribution & growth
Channel fit (organic-first ladder → creators → ASO → paid) · shareability (share
loops) · SEO/ASO intent. → moat/distribution doc.

### 8 · Trust, legal & compliance
GDPR / health-data (special category) · App Store rules (account deletion ✓,
paywall honesty) · trademark + domain gates (naming) · privacy policy.

---

## HOW WE RAISE THE SUCCESS RATE (refining the list over time)
1. **Ground every choice in ≥1 evidence source** (the table above says where).
2. **Validate with the real demographic** — name-tests, the 40% "very disappointed"
   PMF survey, preference surveys to the wedge communities.
3. **Instrument + measure** (PostHog) and let data refine assumptions.
4. **Benchmark to the best** (the analog playbook) — match/beat, don't invent blind.
5. **Kill the unjustifiable** — if a choice has no determinant + no reason, it goes.

## WHAT WE STILL NEED (the honest gaps to close)
- **Real user input** — we have zero users; dogfooding + a small wedge cohort + the
  40% survey are how we replace assumption with evidence.
- **A locked brand brief** — positioning + archetype + voice, written once, referenced always.
- **The colour/type system documented with rationale** (started here; formalise as tokens).
- **The demographic validated with data**, not assumed.
- **A curated reference board** (same- + adjacent-category) as the visual north star.
