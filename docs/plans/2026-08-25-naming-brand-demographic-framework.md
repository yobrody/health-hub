# Naming, brand & demographic — the research-based framework (do it by the book)

The goal: **decide the name, brand, and demographic from evidence, not vibes** —
so it's right the first time. This is the complete list of everything that
determines each, the research source/tool for each input, and the process to run
them. Nothing here is "pick one that sounds nice" — every determinant has a data
source. First-timer-friendly: follow it top to bottom.

> Order of operations (important): **define the DEMOGRAPHIC first**, then the
> BRAND positioning it implies, then generate + test NAMES against both. A name
> chosen before you know who it's for is a guess. So this doc is: (A) demographic
> → (B) brand → (C) name, with the naming rubric being the biggest section.

---

## A. DEMOGRAPHIC — determine it from data, not assumption

You cannot name for an audience you haven't defined. Determinants + sources:

| Determinant | What it answers | Research source / tool |
|---|---|---|
| **Who has the pain most acutely** | The wedge ICP | Customer interviews (10–20), r/fitness+r/nutrition survey, our own PostHog once live |
| **Demographics** (age, gender split, income, location) | Who they are | Google Trends by region; Statista / Pew / market reports on nutrition-app users; App Store/Play category demographics; **PostHog person properties once we have users** |
| **Psychographics** (goals, identity, values, frustrations) | Why they buy | Interviews; Reddit/forum mining; review-mining competitors' 1–3★ reviews (App Store, Trustpilot) for unmet needs |
| **Behavior** (apps used, spend, frequency) | How they act now | Competitor overlap (Similarweb/Semrush audience tools — Semrush connected); survey |
| **Market size + growth** | Is it big enough | Statista / Grand View / IBISWorld nutrition-app + meal-kit market reports |
| **Cultural/regional nuance** | Where it plays | Google Trends geo; language/food-culture differences |

**Method:** (1) run 10–20 wedge interviews + a short survey (Typeform) posted to
the fitness communities; (2) mine competitor reviews for the words real users
use; (3) once the app is live, let **PostHog** person/behavior data refine it
with real signal. Output: a **one-paragraph ICP + a written persona** (the wedge)
+ the expansion segments. (Draft wedge already in `2026-08-25-moat-distribution-
audience.md` — this validates/sharpens it with data.)

---

## B. BRAND — the positioning the demographic implies

A name serves a brand; define the brand first. Determinants:

| Determinant | Source |
|---|---|
| **Positioning statement** (for [ICP], we are [category] that [unique value], unlike [alt]) | Synthesized from A + competitor gap analysis |
| **Brand personality / archetype** (e.g. the Sage, the Magician, the Everyman) | Jungian brand-archetype framework mapped to the persona's values |
| **Core values** (ours: honesty, calm, aspirational-yet-accessible) | From the product spine + persona |
| **Voice & tone** | Persona language (from interviews/reviews) |
| **Emotional job** ("what feeling do we sell") | Interviews ("how do you want to feel about food?") |
| **Competitor brand landscape** (so we differentiate, not blend) | Audit MyFitnessPal, Noom, Fitia, Nourish, Yuka, Whisk/Samsung Food — their names, colors, tone |

**Output:** a one-page brand brief (positioning + archetype + values + voice +
the emotional job) that the name must express. (We have a draft brand brief:
`docs/plans/2026-08-20-brand-and-audience.md` — Creamsicle/Obsidian, honest+calm+
aspirational; this step validates it against the demographic data.)

---

## C. NAME — the full determinant rubric (the core of this doc)

Every candidate name is scored on these. **Gates (pass/fail) first — a fail kills
the name no matter how good it sounds. Then weighted scores.**

### C1. LEGAL / OWNABILITY GATES (hard pass/fail — check these FIRST)
| Gate | Why | How to check (tool) |
|---|---|---|
| **Trademark availability** (in class 9 software + 42/44 as relevant, in your markets) | You can be sued / forced to rebrand | **USPTO TESS** (uspto.gov, free) for US; EUIPO / UKIPO for EU/UK; a knockout search; a lawyer confirms before filing |
| **.com domain** (exact or a clean, ownable variant) | Credibility + you must own the front door | Registrar search (Namecheap/GoDaddy); check aftermarket price if taken |
| **App Store + Play name** (not taken/confusable) | You need the listing | Search App Store + Google Play directly |
| **Social handles** (@name on X, IG, TikTok) | Consistent presence | namecheckr.com / direct checks |
| **No existing competitor with the name in-category** | Confusion + SEO fight | Google the name + "app" / "nutrition" |

> Reality from our prior sweep: the warm-real-word space (Clementine, Nectar,
> Clove, Ember…) is **saturated in-category** → coined/invented names are far more
> ownable. This gate is why "sounds nice" fails.

### C2. LINGUISTIC / PHONETIC (weighted score)
| Determinant | Target | Source |
|---|---|---|
| **Length** | ~4–8 letters, ~2–3 syllables | Naming best-practice; shorter = more memorable/typo-proof |
| **Pronounceability** | One obvious pronunciation on sight | Say-it-out-loud test; a 5-person read-aloud test |
| **Spellability** | Hearable → typeable (radio test) | Read it aloud, ask people to spell it |
| **Memorability / distinctiveness** | Stands out in the category | Recall test (show 5 names, ask which they remember next day) |
| **No unfortunate meanings** | Clean across your target languages | Native-speaker check / translation check (esp. if "next billion") |
| **Rhythm / sound symbolism** | Feels premium + warm (brand fit) | Phonetic intuition + the read-aloud panel |

### C3. DISCOVERABILITY / SEARCH (weighted — use the connected tools)
| Determinant | Why | Tool (connected) |
|---|---|---|
| **Search volume** of the name + is it contested | Ownable in search vs fighting a common word | **Ahrefs / Semrush Keywords Explorer** (both connected), Google Trends |
| **Keyword difficulty / SERP** for the name | Can you rank #1 for your own name | Ahrefs/Semrush SERP overview |
| **ASO fit** | Does the name + category rank in the store | Store search; ASO tools |
| **Coined vs descriptive tradeoff** | Coined = ownable but zero built-in search; descriptive = searchable but generic/untrademarkable | Weigh per strategy (usually coined + a descriptive tagline) |

### C4. BRAND-STRATEGY FIT (weighted — against Part B)
| Determinant | Source |
|---|---|
| **Expresses the positioning / archetype / values** | The brand brief (B) |
| **Emotional resonance with the persona** | A **name test on the real demographic** (survey the fitness communities: "which of these feels like an app that runs your food life?") |
| **Extensibility** — works for R2 (the game world) + sub-brands | Strategic check ("Name Play"? "Name Pro"?) |
| **Tone match** (premium, honest, calm, warm) | Persona + brand brief |
| **Metaphor/meaning** (what it evokes) | Intentional — warm food/nourishment/rhythm, not clinical |

### C5. TREND / LONGEVITY (light weight)
| Determinant | Source |
|---|---|
| **Not a dated naming fad** (over-cute misspellings, "-ly/-ify" fatigue) | Review current startup naming trends; will it age? |
| **Timeless vs trendy** | Prefer timeless for a brand you keep |

---

## D. THE PROCESS (run it in this order)

1. **Finish A + B** (demographic + brand brief, evidence-backed). Nothing names well without these.
2. **Generate 30–50 candidates** across strategies: coined (Oura/Whoop/Noom style), metaphor (warm food/nourishment/rhythm), compound, real-word-if-any-are-free. Bias to **coined** (ownability).
3. **Apply the C1 gates** → kill anything failing trademark/domain/App-Store/competitor. Expect ~70% to die here. (I run the USPTO + domain + store + Ahrefs/Semrush checks.)
4. **Score survivors on C2–C5** with a weighted rubric (e.g. Ownability 30% [already gated] · Brand fit 25% · Pronounceability/memorability 20% · Discoverability 15% · Longevity 10%) → a shortlist of ~5.
5. **Test the shortlist on the real demographic** — a name-preference + association survey to the wedge communities (which feels trustworthy / premium / "runs my food life"; can you spell it; what does it make you expect). This is the "by the book" step most skip.
6. **Legal clearance** on the winner (lawyer/USPTO class 9+42/44 knockout → file intent-to-use if strong).
7. **Buy** the .com + handles + store name the moment it's cleared.
8. **Build the brand system** around it (below).

---

## E. "FULLY DEVELOPED BRAND" — the deliverables (what done looks like)
1. **Name** (cleared + owned).
2. **Logo / wordmark** (the abstracted-produce mark idea; via Canva/Adobe — both connected — or a designer).
3. **Color system** (we have Creamsicle/Obsidian — validate contrast + emotion).
4. **Typography** (Fraunces + Inter — validate).
5. **Voice & tone guide** (from B).
6. **Tagline** ("Your AI nutritionist that plans, shops, and restocks your food").
7. **Icon / app store assets** (once Apple).
8. **A one-page brand guide** holding all of the above.

---

## F. CONNECTED TOOLS → which research each one does
- **Ahrefs / Semrush** — search volume, keyword difficulty, SERP, competitor-audience overlap (C3, A behavior).
- **Google Trends** (web) — interest over time + by region (A demographics, C3).
- **USPTO TESS / EUIPO / UKIPO** (web, free) — trademark knockout (C1).
- **Namecheap/GoDaddy + App Store/Play + namecheckr** — domain/handle/store availability (C1).
- **PostHog** — real user demographics/behavior once live (A, ongoing).
- **Typeform/Google Forms + Reddit/Discord** — interviews + name-test surveys (A, C4, step 5).
- **Canva / Adobe Express** — logo/wordmark/brand assets (E).
- **Statista / Pew / market reports** (web) — market size + user demographics (A).

---

## G. NEXT STEPS (what I can run for you)
1. **I run the demographic research pass** (competitor review-mining + Trends/Ahrefs audience data + a survey draft) → the evidence-backed ICP + persona.
2. **I generate the 30–50 candidates + run the C1 gates** (USPTO knockout + domain + store + Ahrefs contest check) → a legally-clear, ownable shortlist.
3. **You + the community score/test the shortlist** (step 5 survey) → the winner.
4. **Legal clearance + buy + brand system.**

**The rule:** no name is "decided" until it has passed the C1 gates, scored top on
C2–C5, and won a real name-test on the actual demographic. That's by the book.
