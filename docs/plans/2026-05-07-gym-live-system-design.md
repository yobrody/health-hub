# Gym Live System — Design

Date: 2026-05-07 · Branch: `gym-live-system`

## Goal
Make the Workout page tracked and *alive*: weight/reps/rest fluctuate together based on diet, fatigue, position, and last-set RIR. Equipment-aware: snap to The Gym Group Paddington's actual stack increments. Skip & come back. Per-muscle weekly volume dashboard. Post-workout analysis. In-gym chat to add machines and decide where they fit.

## Modules

### `src/lib/gym-equipment.ts`
- `Equipment` shape: `{ id, name, type: 'stack'|'plate-loaded'|'dumbbell'|'barbell'|'bodyweight'|'cable', stack?: { min, max, increments[] }, source: 'seed'|'learned'|'manual' }`
- `SEED_PADDINGTON` — pre-seeded standard kit (Life Fitness, Hammer Strength, dumbbells 2.5–50, Olympic plates 1.25/2.5/5/10/15/20/25)
- `nextUpWeight(eq, kg)` / `nextDownWeight(eq, kg)` — return next valid stack value
- `snapToStack(eq, kg)` — nearest stack value to a target
- `learnFromLogs(workouts)` — infer per-exercise increment from observed weights, write to `localStorage.gym_catalog_learned`
- `getEquipment(name)` — merge seed + learned + manual

### `src/lib/gym-muscles.ts`
- Exercise-name → `{ primary, secondary }` muscle-group map
- `MUSCLE_TARGETS` — MEV/MAV/MRV per group
- `weeklyVolumeByMuscle(workouts, weeks=1)` — count effective sets per muscle (primary=1.0, secondary=0.5)
- `volumeStatus(count, target)` → `'undertrained'|'low'|'on-target'|'overreaching'|'mrv'`

### `src/lib/gym-decision.ts`
The exact science. Pure function, fully tested.
```
decideNextSet({
  exercise, prevBest, prevSets, repRange, properlyEating,
  positionInSession, totalExercises, sessionVolumeSoFar, avgSessionVolume,
  lastSetRIR, sleepHours, equipment
}) => { weight_kg, repsTarget, restSeconds, rationale }
```
Internals:
- `dietModifier(dietState)` 0.92–1.00
- `fatigueModifier(positionPct, volumeRatio)` 0.95–1.00
- `sleepModifier(hours)` 0.95–1.00
- `loadModifier(loadPct)` 0.85–1.20 (rest)
- `rirRestModifier(rir)` 0.85–1.15
- `positionRestModifier(positionPct)` 0.85–1.10

### `src/lib/gym-analysis.ts`
- `analyzeWorkout(workout, prevWorkout?, prs)` → `{ totalVolume, volumeDelta, setsAtTop, setsShort, prHits[], workingTimeMins, restEfficiency, perMuscle, score }`
- `score` 0–100 (weighted: completion × volumeDelta × top-of-range hits × consistency)

### `functions/api/ai/gym-coach.js`
POST. Two modes via `kind`:
- `kind: 'machine-question'` — body `{ question, knownEquipment[] }` → `{ answer, suggestedEquipment?, suggestedSchedule? }`
- `kind: 'workout-summary'` — body `{ analysis, weeklyVolume, recent }` → `{ narrative }`
Uses existing Gemini helper.

### UI changes (`src/pages/Workout.tsx` + new components)
1. **`ActiveSetCard`** — replace flat ±2.5 with stack-aware: `[ −prev ] [16kg] [ +next ]`. Reps target shown as ghost placeholder. Suggested rest displayed below "Logged · rest now".
2. **Skip & come back** — exercise state machine `pending|active|done|skipped`. New "Skip" action in Manage sheet and on the active card. "Coming back to" tray at top.
3. **MuscleVolumeCard** (idle view) — 8-row mini bar chart, weekly sets per muscle vs MAV.
4. **PostWorkoutSheet** — opens automatically after `Save`. Shows analysis + "Generate insights" button.
5. **GymChatSheet** — floating "Ask coach" button on idle and live views.

## Tests
- `gym-equipment.test.ts` — nextUp/nextDown across all equipment types incl. learned
- `gym-muscles.test.ts` — volume math, status thresholds
- `gym-decision.test.ts` — modifiers, snapping, RIR-driven progression
- `gym-analysis.test.ts` — score, deltas, PR detection

## Out of scope (explicit)
- Editing the catalog from a settings page (catalog updates happen in chat only for v1)
- Deload week auto-trigger (we display the warning, user decides)
- Sleep auto-import (uses `localStorage.health_sleep_hours` if present, else neutral 1.00)
