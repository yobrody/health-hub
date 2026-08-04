# Health Hub — Honesty Audit (2026-08-04)

Brody asked: *"is anything else not honest?"* — i.e. find anywhere the app shows a
hardcoded default, placeholder, or stale value dressed up as his real data (like
the old 80 kg TDEE default). This is the sweep, the findings, and what was fixed.

**Principle:** a fabricated number is worse than an absent one, because it gets
trusted. When we don't have real data, show `—` / "estimate" / "log more", never
a plausible-looking guess presented as fact.

---

## Fixed this session

### 1. [CRITICAL] All non-food state was ephemeral — silently wiped on every rebuild
`DATA_DIR` (workouts, weight log, body metrics, **profile**, lists, routines,
agenda, sleep, meal plans) defaulted to `./data` *inside the Docker image*. The
container only bind-mounted `WORKSPACE`, so `DATA_DIR` lived in the throwaway
image layer. Every `docker build` + `run` started it empty.

Consequences:
- `profile.json` **never persisted** → `/tdee` always ran on the default
  180 cm / 25 y / male / moderate, no matter what Brody typed into the Body
  Profile editor.
- Today's weigh-ins, workouts, lists, etc. would vanish on the next deploy.
- A stale, orphaned copy of the data (March–May) sat unused at
  `~/health-hub/api/data/` (Syncthing-managed, not mounted), diverging from the
  live container.

**Fix:** `DATA_DIR` is now `HEALTH_DATA_DIR`-overridable (default unchanged for
local/tests). Prod pins it to `/data` and bind-mounts `/home/lucky/health-hub-data`.
Existing data was backed up (`~/health-hub-backups/<ts>/`), the divergent sources
merged (weight logs deduped by date — May 64.5 kg ×2 + Aug 62.0 kg recovered), and
3 workouts of history restored. `api/README.md` now documents the required second
mount so it can't be forgotten again.

### 2. [HIGH] TDEE fell back to the 80 kg placeholder despite real weigh-ins
`/tdee` and `/tdee/adaptive` read current weight only from `body_metrics.json`,
but the **primary** weigh-in path — the Goals/Today weight tile — writes
`weight_log.json`. So a user who only ever used the tile had an empty
`body_metrics`, and TDEE silently used `profile.get("weight_kg", 80.0)`.

**Fix:** `_all_weighins()` unifies both stores (deduped by date, weight log wins
on collision); `_latest_weight_kg()` returns `(kg, source)`. The `/tdee` weight
trend uses the unified log too. Responses now carry `weight_source`
(`logged` / `profile` / `default`) so the client can distinguish measured from
guessed. **Verified live:** `/tdee` now returns `weight_kg: 62.0,
weight_source: "logged"` (was `80.0`).

### 3. [MEDIUM] Goal direction never reached the backend → targets assumed "maintain"
The Goals direction picker (gain/maintain/lose) saved only to `localStorage`.
The server's `goal_direction` defaulted to `"maintain"`, so `/tdee/adaptive`
`targets` and recommendations gave Brody — who is **bulking** — maintenance
numbers with no surplus.

**Fix:** the picker now also `PUT /tdee/profile?goal_direction=…`; the endpoint
accepts and persists it. Profile seeded to `goal_direction: "gain"`. **Verified:**
adaptive `suggested_goals` now returns the gain path (2700 kcal / 124 g).

### 4. [MEDIUM] Progress view treated weight *gain* as a bad thing
`Stats.tsx` hardcoded the body-weight tile colour as loss = green, gain = orange —
a cut mindset baked in, dishonest for someone whose entire goal is muscle gain.

**Fix:** tested `weightProgressTone(deltaKg, direction)` colours by the user's
actual goal — gaining reads as good progress when bulking, off-track when cutting,
neutral for maintenance or scale noise. Sub-label now says "gained"/"lost".

### 5. [LOW] Nutrition goals were fixed numbers, not derived from the body
Calorie + protein goals were round numbers with no tie to TDEE or bodyweight.
**Fix:** `src/lib/goal-suggestions.ts` derives calories = TDEE ± a goal-direction
surplus/deficit and protein = bodyweight × g/kg (2.0 gain / 2.2 cut / 1.6 maintain),
surfaced as an accept/tweak card on Goals. The surplus is derived from the *same*
weekly-gain band the workout diagnosis uses, so the two never contradict. Mirrored
server-side (`_suggested_goals`) so coach/meal-planner agree.

---

## Noted — pre-existing, lower severity (recommend, not yet changed)

- **Offline goal fallbacks.** `Stats.tsx` / `Nutrition.tsx` use `goals?.calories ?? 2200`
  and `?? 140` / `?? 4` when the goals fetch fails. These are transparent
  degradation, but they draw a *specific* reference line as if it were the real
  goal. Recommend rendering `—` (no line) when goals are genuinely unavailable.
  Left as-is for now: it only triggers offline, and a null would risk NaN in the
  chart maths — worth a small, tested change rather than a rushed one.
- **TDEE height/age/sex still default** (180 cm / 25 y / male / moderate) until
  Brody fills the Body Profile editor — now that it *persists*, this is finally
  possible, and the card is labelled "Estimated". Recommend a "set your height &
  age for an accurate TDEE" nudge when those fields are missing, so the estimate
  isn't mistaken for a measurement.
- **Recovered workouts are from the retired Upper/Lower split** (March/May). Real
  history, preserved — but the engine is now Push/Pull/Legs, so they don't feed
  current progression. Not dishonest, just noted so nobody's surprised.

## Confirmed still honest (fixed in earlier audits)

- Protein MiniBar reads real 7-day `total_protein_g` (was `avgKcal × 15 %`).
- WeeklyReport TDEE is real `/tdee/adaptive` (was a hardcoded 2500).
- Metrics adaptive direction reads the user's chosen direction (was hardcoded).
- Machine weights self-correct to real stacks; food scans scale per-100 g → pack.

---

_Backups: `~/health-hub-backups/20260804-153116/` on lucky-vps (container + host
data, restorable). Deploy: image rebuilt, both volumes mounted, smoke-tested._
