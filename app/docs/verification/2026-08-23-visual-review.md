# Visual design review — 2026-08-23

First **visual** verification of the app (behaviour was already covered by 843
tests, but nothing had ever _looked_ at the pixels). Built a screenshot harness
(`test/goldens/screens_golden_test.dart`) that renders every key screen ×
light/dark to PNGs under `test/goldens/images/`, with **real fonts** (Fraunces +
Inter + Material/Cupertino icons, vendored under `test/goldens/fonts/`) and
**real soft shadows**, at iPhone-13 size (390×844 @3x), seeded with
representative data. Regenerate with:

```
flutter test --update-goldens --tags golden
```

Tagged `golden` and excluded from CI (`--exclude-tags golden`) so platform font
rasterization never breaks the build.

## Overall

The app looks genuinely premium where it follows its own best pattern —
**Onboarding**, **Auth**, and the **Gym gate** are the high-water mark: a
Fraunces serif headline, exactly **one** solid-orange primary action, an
outlined/secondary action beside it, honest copy ("skipped shows as — never a
guessed value", "Soon" chips). Warm cream (light) and deep matte obsidian (dark)
both read well; the orange is muted terracotta, never glowing — matches the
brand direction.

## Real bugs found + FIXED this pass

1. **Weight delta float noise** — the "since first" delta rendered
   `↑ 1.2999999999999972 kg` (IEEE-754 from `62.3 - 61.0`). It was also long
   enough to overflow the card. `formatKg` now rounds to 2 dp first →
   `↑ 1.3 kg`. Covered by `test/profile/format_kg_test.dart` (whole numbers,
   1-dp weights, float-noise, micro-plate 1.25 kg all asserted).
2. **Transformation roadmap ETA row overflowed** at 390 px — "~30 weeks · 9.7 kg
   to go" was clipped beside the 28 px serif "March 2027". Wrapped the sub-label
   in `Flexible` so it flows to a second line. (Only visible once the harness
   seed was corrected — see below — which is exactly why the populated state
   needed rendering.)

Both were invisible to the 843-test behavioural suite; only rendering the pixels
surfaced them.

## Not bugs (diagnosed + explained)

- **Black ring around FABs / black hairline under cards** — a _test artifact_.
  `flutter_test` forces `debugDisableShadows = true`, which rasterizes elevation
  as solid black. The harness now flips it off across each capture (restoring it
  before the invariant check) so shadows render soft like a device. The FAB code
  is a plain `FloatingActionButton`, no border.
- **Transformation showed the "set your goal" empty state despite a seeded
  goal** — a _harness seed bug_, not an app bug: `Profile.fromJson` reads
  snake_case (`target_weight_kg`, `goal_direction`) but the seed used camelCase,
  so the goal parsed as null and the app _correctly_ showed its honest
  needs-data state. Seed fixed → the real populated roadmap now renders.

## Design recommendations (need Brody's call — not yet changed)

Ranked by impact on the "scream luxury, subtle, Apple-universal" goal:

1. **Orange-fill overload.** Home / Food / Cart / Nutrition give _every_ card a
   full-width solid-orange button, so the first scroll is 2–3 identical orange
   fills. Luxury UIs use one accent action per view. Adopt the Gym/Onboarding
   pattern everywhere: one solid-orange primary, secondary actions as
   outlined/tinted/text. Biggest single lift to premium feel.
2. **On-orange text colour is inconsistent** — dark text on orange in light
   theme, white text on orange in dark theme. Pick one brand treatment (verify
   WCAG contrast for whichever — the orange is light, so white may fail).
3. **Screen-title typography is split** — Home ("Good afternoon") and Food
   ("Your kitchen") use the Fraunces serif; Cart / Weight / Settings / Training
   / Log Food use bold sans. Decide a rule (e.g. serif for all top-level titles)
   so it feels like one system.
4. **Redundancy across the surface** — "Log a meal" appears as a hero button
   _and_ the EAT card action on Home; the EAT card repeats on Home + Nutrition;
   the RESTOCK "BUY" cards are identical on Food + Cart; "Training" title sits
   directly above a "TRAINING" section overline; "Log weight" is both a text
   button and the FAB on Weight. Deduplicate.
5. **"Protei…" truncates** in the 4-across macro field row on Nutrition — shorten
   the label, allow 2 lines, or drop a field width.
6. **Kitchen "Tap an appliance to see what's inside" but no appliances are
   visible** — the screen jumps straight to RESTOCK cards. Either the interactive
   appliance panels are below the fold / not built, or the copy over-promises.
   Reconcile.

## Screens captured (light + dark each)

home_today, food_kitchen, gym_gate, gym_mid_session, gym_no_session,
nutrition_capture, cart, transformation, weight_chart, settings, auth_screen,
onboarding.
