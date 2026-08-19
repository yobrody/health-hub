# P3 (Gym) — Live workout tracking + honest progression

> subagent-driven; per-task model/effort per `feedback-model-effort-per-task-protocol` (Opus for progression/data/honesty, Sonnet UI). Ports the honest gym logic from `src/lib/*.ts` (workout-progression, strength-targets, gym-decision, gym-equipment, workout-flow, progression-feedback) — READ those for parity.

**Goal:** A real gym section — start a workout, log sets (weight/reps/effort), get an **honest progression verdict** (when to go up / hold / deload), a **tailored rest timer with effort emojis**, and machine weights that **snap to real stacks**. Offline-queued; sessions never lost.

**Honesty invariants (from the old app's hard-won fixes):** machine weights snap to actual stack increments (no impossible weights); the "next notch" is derived from the weight ACTUALLY lifted (not a stale session-start value); a rep shortfall is a miss, not a pass; no fabricated/placeholder data. Program layer + gym-location personalization = a LATER gym phase (not this one).

**Tech:** Flutter + Riverpod, P0/P1 modules, offline `Outbox`. Tests: `flutter_test` + `mocktail`.

---

### P3-T1: Workout data model + repo (Opus)
- `app/lib/gym/exercise.dart`: `Exercise { id, name, primaryMuscle?, equipment }`, `enum EquipmentType { machine, freeWeight, bodyweight, cardio }`.
- `app/lib/gym/workout_session.dart`: `SetEntry { double? weightKg; int? reps; SetEffort? effort; bool done }`, `enum SetEffort { easy, contempt, angry }`, `ExerciseLog { exerciseId; List<SetEntry> sets }`, `WorkoutSession { id; DateTime at; List<ExerciseLog> exercises; bool finished }`. All nullable-where-unknown; `toJson` omit nulls.
- `app/lib/gym/workout_repo.dart`: `WorkoutRepo` (injectable store + shared `Outbox`), CRUD + `activeSession()` + `saveSet(...)` — **persist eagerly so a session survives app restart** (the old "lost sessions" bug). Mutations outbox-queued.
- Add `workoutRepoProvider`.
- Tests: nullable/no-0-fill; session round-trips + survives a reload (via the store); a set save persists + queues; effort persists.

### P3-T2: Progression logic (Opus) — port the honest core
- `app/lib/gym/progression.dart` — PURE, port from `src/lib/workout-progression.ts` + `strength-targets.ts` + `progression-feedback.ts`:
  - `predictNextWeight(...)` / `evaluateProgressionFeedback(...)` — from the sets actually done + the rep range, a verdict `{ bump | hold | deload | recalibrating }`, using the weight ACTUALLY lifted (not a seeded stale value); a rep shortfall = miss.
  - `snapToStack(weightKg, EquipmentType)` — machine → nearest real stack increment; free-weight → nearest plate step; bodyweight → as-is. Match the legacy increments.
  - effort→progression: `easy` → suggest heavier next; `angry` (failed/max) → hold/deload; `contempt` (grind) → hold.
- Tests (parity with the legacy tests): bump only when the top of rep range is hit on all sets at the real weight; shortfall→miss (no bump); stack snapping per equipment; effort verdicts.

### P3-T3: Live workout UI (Sonnet)
- Replace the `gym-page` placeholder (keep `Key('gym-page')`): start a session, add exercises (from a small seed list), log sets (weight/reps), mark set done, finish session. Reads/writes `workoutRepoProvider`. Machine weights snap via `snapToStack`. Honest render (`—` for unset).
- Widget tests (fakes): start→log a set→it persists; a machine weight snaps; finishing marks the session finished.

### P3-T4: Rest timer + effort emojis (Sonnet, progression-aware)
- Between sets, a **tailored rest timer**; three optional emojis **angry / contempt / easy**, each a little animation, recording `SetEffort` on the set → feeds `progression` (easy→heavier next, angry→hold/deload, contempt→hold). **Confetti only on a genuine earned bump** (a real weight increase verdict), never a topped-but-soft set (the old confetti-honesty fix).
- Tests: tapping an emoji records the effort + yields the right next-weight suggestion; confetti fires only on a real `bump` verdict.

### P3-T5: Verify + finish (Sonnet)
- Full `flutter test` + `analyze` green; update north-star; push + PR + merge on green CI.

## Definition of done
Start a workout, log sets with effort, get an honest progression verdict + tailored rest, machine weights snapped, sessions persistent + offline-queued. Program layer + gym-location personalization deferred to a later gym phase.
