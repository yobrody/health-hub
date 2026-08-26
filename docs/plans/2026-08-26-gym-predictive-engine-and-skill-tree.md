# Gym predictive engine + strength/physique skill-tree — the spec (research-grounded)

Goal: the best progression-prediction system out there — it tells the user when
they'll go up (or down) in strength/physique, and how skipping workouts/meals/steps
changes that. Delicate: a prediction is a **guess**, so honesty gates are as
important as the math. This spec is grounded in how the best systems actually work.

## What the best systems do (researched, sourced)

**Fitbod** ([algorithm](https://fitbod.me/blog/fitbod-algorithm/) ·
[recovery](https://fitbod.me/blog/muscle-recovery/) ·
[lift-heavier/recover](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)):
- **Per-muscle recovery model, 0–100%** = f(volume × intensity of recent sets, rest
  days since last trained); "fully recovered" at ~7 days. Prioritizes fresh muscles.
- **mStrength** (per-muscle strength score) + an **Overall Strength Score**, both
  trend-tracked. **Trending up → lift heavier; flat/declining → recover / change
  programming (plateau flag).**
- Inputs it monitors: **volume (sets×reps×weight), frequency, intensity, RiR
  feedback, estimated 1RM, strength-score trends, recovery status.** Pulls
  Apple Health/Fitbit/Strava for cardio fatigue. New-lift start weight from a
  large dataset (conservative). **Max-effort days recalibrate true capacity.**
- Adaptive loop: complete prescribed reps easily → bump load/reps; struggle →
  downshift. Rep ranges are goal- + evidence-based (Schoenfeld/Grgic).

**Renaissance Periodization** ([volume landmarks](https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth) ·
[method](https://arvo.guru/resources/methods/rp-training)):
- **Volume landmarks per muscle/week (hard sets):** MV (maintain) < **MEV** (min
  effective) < **MAV** (max adaptive) < **MRV** (max recoverable).
- Progress sets **MEV → MRV** across a 4–6-week mesocycle; **RIR falls 3 → 0**;
  **deload at MRV** (~−50% volume, −10% intensity); autoregulate from soreness,
  pump, performance, joint feedback. Two degraded signals → pull volume back.

**Banister fitness–fatigue impulse-response model** ([Humankinetics review](https://journals.humankinetics.com/view/journals/ijspp/17/5/article-p810.xml) ·
[ACWR critique](https://www.globalperformanceinsights.com/post/has-the-acute-chronic-workload-ratio-been-debunked)):
- **Performance = Fitness − Fatigue.** Both are exponentially-decaying responses to
  a training impulse (TRIMP); **fatigue is bigger but shorter-lived** (τ_fitness
  ~20–42 d, τ_fatigue ~7 d). Simplified by TrainingPeaks into **CTL (fitness) / ATL
  (fatigue) / TSB (form)**.
- **⚠️ Honesty lesson:** the ACWR injury-prediction reframe is **now heavily
  criticized** (correlational, mathematically unstable, oversimplified — the original
  authors regret the word "predicts"). Reviews say use fitness–fatigue as
  **data-INFORMED, not data-driven.** → **We must NOT claim injury prediction**, and
  must show uncertainty on everything.

## The inputs the engine needs (exact list, by source)

| Input | Why (what it powers) | Have it? |
|---|---|---|
| Per-set **weight × reps × sets**, per exercise, timestamped | est. 1RM (Epley/Brzycki), strength-score trend, progressive-overload readiness | ✅ logged |
| **RiR / RPE** per set (proximity to failure) | autoregulation — the single most important effort signal | ⚠️ partial — capture it |
| **Sets per muscle group / week** (via exercise→muscle map) | MEV/MAV/MRV volume landmarks + weekly volume trend | ➕ derive from logs |
| **Frequency + rest days** per muscle | per-muscle recovery % (Fitbod-style) | ➕ derive from timestamps |
| **Workout adherence** (done vs planned) | the "if you skip workouts" prediction delta | ✅ trackable |
| **Nutrition**: calories vs TDEE, **protein** vs target | energy balance → gain/loss rate; protein → muscle synthesis | ✅ tracked |
| **Steps / cardio / NEAT** (HealthKit) | energy expenditure + fatigue load | ✅ HealthKit wired |
| **Bodyweight + body metrics / BF** trend | physique trajectory, energy-balance calibration | ✅ tracked |
| **Sleep / readiness** | recovery quality (already computed) | ✅ in app |
| **Soreness** (optional quick check) | RP-style autoregulation signal | ➕ optional add |

## What it predicts (outputs)

1. **Per-lift next increment + ETA** — from the strength trend + progressive-overload
   readiness (top of rep range at target RiR → ready to add load). "≈3 weeks to
   +2.5 kg on squat **if you hold this trend**."
2. **Physique trajectory to goal** — energy-balance + weight-trend regression →
   ETA to goal weight/BF (extends the existing `projectRoadmap`).
3. **Adherence sensitivity ("what-if")** — the headline ask: *skipping 2
   workouts/week pushes your goal ~N weeks out*; under-eating protein slows muscle
   gain; missing steps shifts the deficit. Show the **cost of skipping**, honestly.
4. **Per-muscle readiness (0–100%)** + **plateau / needs-deload** flags.

## Model approach (transparent first, ML later)
- **Strength:** est-1RM trend + a progressive-overload rule set + a light
  fitness–fatigue (CTL/ATL) term for readiness. Explainable, debuggable.
- **Physique:** energy-balance (intake − TDEE − activity) + robust trend regression
  on real weigh-ins (reuse `_all_weighins`).
- **Recovery:** Fitbod-style per-muscle % from volume×intensity×rest-days.
- **NOT** a black-box ML model at v1 — a real learned model comes once we have data,
  and only if it stays explainable. Never a claim we can't show the working for.

## Honesty gates (non-negotiable — this is where trust dies)
- **Data-sufficiency gate:** no prediction until enough real logs (e.g. ≥3 weeks /
  ≥N sessions per lift). Until then: honest "need more data to predict."
- **Confidence ranges, never false precision:** show a band + "if you hold this
  trend," not a fake exact date.
- **No injury prediction** (the ACWR lesson) — we predict progression/physique, and
  flag *recovery/plateau*, not injury risk.
- Every number traces to the user's real logged data (the app's spine).

---

## Why this is the ABSOLUTE best (beyond Fitbod / RP / Whoop)
The leaders each see only PART of the picture — and that gap is our edge:
- **Completeness of data (the biggest accuracy lever, and we own it).** Fitbod has
  your lifts + recovery but **no nutrition**; RP has volume/RIR but **no steps/sleep/
  bodyweight**; Whoop/Oura have recovery but **no lifts**. **We have all of it** —
  lifts, calories/protein, steps/cardio, sleep/readiness, bodyweight/BF — so we're
  the only engine that predicts **strength AND physique jointly from the complete
  signal.**
- **Individualized, not generic.** The sport-science literature explicitly warns
  against general fitness–fatigue constants (they ignore individual differences).
  The best engine **fits each user's OWN parameters** (their gain/loss rate, recovery
  rate, fitness/fatigue k/τ) from real logs and **updates them Bayesianly** as data
  accrues — predictions **start honest-wide and tighten** with use. Most consumer
  apps hard-code constants; we personalize the model itself.
- **Explainable + honestly uncertain = the moat, not a weakness.** The absolute best
  isn't the flashiest black box — it's the one you can trust: every prediction shows
  its working, a confidence band, and "if you hold this trend," and **refuses to
  predict what it can't** (no injury claims — the ACWR lesson). In a category full of
  confident-but-wrong AI, honest prediction *is* the differentiation.
- **Causal-ish adherence what-if.** Holding every input lets us honestly show *skip 2
  workouts → +N weeks; drop protein → slower gain* — a joint model no siloed
  competitor can produce.
- **Roadmap:** transparent math (v1) → individualized Bayesian fitness–fatigue → ML
  refinement once there's data — **always explainable, always honest.** "Best" =
  most-complete-data + individualized + most-honest, held with the humility that no
  forecast is certain.

## The strength/physique SKILL-TREE (the roadmap idea, best version)

Concept: a **living visual map of the user's journey to their goal physique** — where
they are, what's next, and their direction — powered by the engine above. It fuses
RP/strength standards + physique milestones + Duolingo-style path gamification (but
**honest**: only real, earned milestones; ETAs with confidence).

- **Nodes = real milestones**, two interleaved kinds:
  - *Strength* (universal standards scaled to bodyweight/goal): bodyweight bench,
    1.5× BW squat, 2× BW deadlift, first pull-up, first 100 kg lift…
  - *Physique* (body-comp): goal weight bands, BF% tiers, the tape-measure
    milestones (already in the app), "goal physique."
- **Your position + trajectory:** the map highlights where you are, the **next 1–3
  nodes**, each with an **honest ETA** from the engine ("~3 weeks, if you keep it
  up") — and **adherence bends the path** (skip → nodes push out, visibly).
- **Earned only:** a node lights up only on a *real* PR/measurement (honesty spine) —
  no fake confetti (reuses the existing earned-jump logic).
- **Direction, not just points:** it always answers "what do I do next and where is
  this heading" — the fix for "the gym section doesn't pull me in."
- Extends the app's existing **Transformation** system (roadmap + physiqueMilestones
  + progression feedback), rather than replacing it.

### Locked direction (2026-08-26, Brody)
**Unified · richer-linear · fully personalized.**
- **Unified toward the goal physique:** one journey interleaving strength PRs +
  body-composition milestones, all pointing at the goal physique (the app's north star).
- **A RICHER linear path** (not plain Duolingo-linear, not full RPG branching):
  - A single clear **main spine** = the route to the goal physique — always shows
    "you are here" + the next 1–3 nodes + your direction.
  - **Segmented into chapters/phases** (mini-arcs, e.g. "Build a strength base" →
    "Lean bulk to X kg" → "Cut to Y% BF") so it has structure + a sense of progress.
  - **Side-nodes hang off the spine** — per-lift PRs, measurement milestones,
    consistency streaks — richness/depth without parallel-tree complexity.
  - **Living/animated:** nodes light on a *real* earned PR/measurement, ETA labels
    update, and **skipping visibly bends the upcoming segment** (the "alive" fix).
  - **Tap a node → the real data behind it** (honest, no fabricated milestones).
- **Fully personalized milestones:** node placement + ETA are bespoke to the user's
  body, goal, and trajectory (engine-driven) — NOT a rigid universal tier ladder.
  *Honesty guard:* each personalized milestone is still grounded in a real,
  recognized benchmark under the hood (so it's meaningful + earnable), just presented
  as "your next milestone," not "universal tier 3." This keeps legitimacy without a
  one-size ladder.

### Skill-node milestones (the "cool" athletic feats) — Brody 2026-08-26
Beyond numbers, the tree includes **aspirational athletic/calisthenics skills** as
nodes — identity-driven, fun, shareable (fits the physique/identity north star).
- **A curated skill library**, e.g. wall → freestanding **handstand** → handstand
  push-up → handstand walk; pull-up → **muscle-up**; **pistol squat**; **1-minute
  dead hang**; L-sit → tuck front lever → **front lever** → **human flag**; and
  technique feats like the **backflip**.
- **Each node has:** (a) **prerequisites** the engine estimates readiness for from
  real data — a dead hang gates on grip + relative strength, an HSPU on overhead-press
  relative strength, a pistol on unilateral leg strength + mobility; (b) a
  **progression path** (sub-nodes/regressions); (c) a **readiness estimate** ("your
  pressing strength suggests you're ~ready to try a wall handstand").
- **Honesty + SAFETY gates (critical):** strength-gated skills only light "ready" on
  real data. **Technique/risk skills (backflip, muscle-up, human flag) are shown as
  unlockable _challenges_ with an explicit "needs skill practice + safe progression,
  not just strength" caveat + a safety note** — we NEVER say "you can backflip now"
  (injury + honesty). Strength readiness ≠ a green light to attempt.
- These turn the tree from a number-chart into a **"what am I becoming"** map — the
  emotional pull the gym section is missing.
