# P0 — Flutter Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the native Flutter app shell for Health Hub — navigation, backend client, offline queue, Health import (steps/sleep first), camera/push/location permissions, onboarding + Settings shell — wired to the existing FastAPI backend, so later phases (Pantry, capture, avatar, brain) have a foundation.

**Architecture:** Clean-rewrite Flutter app in `app/` (the existing `api/` FastAPI backend stays; the React/PWA front-end is retired). State via **Riverpod**. All pure logic is (re)written **test-first** in Dart. The app is offline-first: mutations go through a Dart port of the existing `outbox` queue. Honesty rule holds — missing signals render `—`/`~`, never fabricated.

**Tech Stack:** Flutter (Dart), Riverpod (state), `dio` (HTTP), `health` (HealthKit + Health Connect), `permission_handler`, `geolocator` (location), `firebase_messaging` or `flutter_local_notifications` (push), `flutter_secure_storage` (health key), `rive` (later, P4). Tests: `flutter_test` + `mocktail`.

---

## Prerequisites (do these FIRST — some are environment/decision gates)

**P-1. Toolchain (not yet installed on this machine).**
- Install Flutter SDK + Dart; run `flutter doctor` until Android toolchain is green.
- Android: Android Studio + SDK + an emulator/device. Buildable on Windows. ✅
- **iOS: requires macOS + Xcode — NOT possible on this Windows box.** Decision needed:
  - (a) **Cloud-Mac CI** (Codemagic / GitHub Actions `macos` runner) builds + ships iOS while you dev on Windows/Android — *recommended*; or
  - (b) a physical Mac. Pick one before iOS work; **Android-first** is fine to start.

**P-2. Decisions to confirm (assumed in this plan):**
- Repo layout = **`app/` folder in this repo** (backend `api/` stays). Alt: separate `health-hub-app` repo.
- State mgmt = **Riverpod**.
- App id = `uk.co.healthhub.app` (confirm).
- Backend base URL + `X-Health-Key` auth reused from today's API (value from the SOPS vault).

**P-3. Backend contract:** the Flutter client targets the current FastAPI endpoints (`api/main.py`). No backend changes in P0 beyond confirming CORS/host allows the app.

---

## Task 1: Scaffold the Flutter app

**Files:** Create `app/` (via `flutter create`), commit the generated tree.

**Step 1:** Run `flutter create --org uk.co.healthhub --project-name health_hub app`
**Step 2:** `cd app && flutter run` on an Android emulator → verify the counter app launches.
**Step 3:** Add `.gitignore` entries for Flutter (`app/build/`, `.dart_tool/`, etc.).
**Step 4:** Add deps: `flutter pub add flutter_riverpod dio flutter_secure_storage` and dev deps `flutter pub add --dev mocktail`.
**Step 5: Commit** — `git add app && git commit -m "chore(app): scaffold Flutter app + core deps"`

---

## Task 2: App shell — navigation skeleton (Today / Food / Gym / Nutrition / Settings)

**Files:** Create `app/lib/app.dart`, `app/lib/main.dart`, `app/lib/nav/root_scaffold.dart`; Test `app/test/nav/root_scaffold_test.dart`.

**Step 1: Write the failing widget test** — pump `RootScaffold`, assert 5 bottom-nav destinations exist and tapping "Gym" shows the Gym placeholder.
```dart
testWidgets('root nav switches tabs', (tester) async {
  await tester.pumpWidget(const ProviderScope(child: HealthHubApp()));
  expect(find.text('Today'), findsWidgets);
  await tester.tap(find.text('Gym'));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('gym-page')), findsOneWidget);
});
```
**Step 2:** Run `flutter test test/nav/root_scaffold_test.dart` → FAIL (widgets missing).
**Step 3:** Implement `RootScaffold` (a `NavigationBar` + `IndexedStack` of 5 placeholder pages, each with a `Key`).
**Step 4:** Run the test → PASS.
**Step 5: Commit** — `feat(app): root navigation shell`

---

## Task 3: Config + secure storage for the health key

**Files:** Create `app/lib/core/config.dart`, `app/lib/core/secrets.dart`; Test `app/test/core/secrets_test.dart`.

**Step 1: Failing test** — a fake secure store round-trips the health key; `Secrets.headerKey()` returns `X-Health-Key`.
**Step 2:** Run → FAIL.
**Step 3:** Implement `Config` (base URL from `--dart-define`) + `Secrets` wrapper over `flutter_secure_storage` (inject the store for testing).
**Step 4:** Run → PASS.
**Step 5: Commit** — `feat(core): config + secure health-key storage`

---

## Task 4: API client (TDD, honesty-preserving)

**Files:** Create `app/lib/api/client.dart`, `app/lib/api/models.dart`; Test `app/test/api/client_test.dart`.

**Step 1: Failing tests** (mock `dio`):
- `getToday()` parses a `/today` JSON into a `Today` model.
- Auth: every request carries the `X-Health-Key` header.
- A 5xx surfaces as `Degraded`, **not** a fake success (honesty).
- A missing numeric field maps to `null`, not `0`.
```dart
test('5xx -> degraded, not fabricated', () async {
  when(() => dio.get(any())).thenThrow(DioException(response: Response(statusCode: 500, requestOptions: RequestOptions())));
  final r = await client.getToday();
  expect(r.status, ProbeStatus.degraded);
});
```
**Step 2:** Run → FAIL.
**Step 3:** Implement `ApiClient` (dio + interceptor injecting the header; typed models with nullable numerics).
**Step 4:** Run → PASS.
**Step 5: Commit** — `feat(api): typed client with auth + honest error mapping`

---

## Task 5: Offline queue — Dart port of `outbox` (TDD)

**Files:** Create `app/lib/offline/outbox.dart`; Test `app/test/offline/outbox_test.dart`. Reference the old logic in `src/lib/outbox.ts` for behavior parity (dedupe, retry, ordering).

**Step 1: Failing tests** — enqueue a mutation offline → it persists; on reconnect it flushes in order; a queued write reports `queued`, not `failed`; duplicate enqueues dedupe.
**Step 2:** Run → FAIL.
**Step 3:** Implement `Outbox` (persistent list via secure/local storage; `enqueue`, `flush(client)`, status labels). Pure list ops separated for unit testing.
**Step 4:** Run → PASS.
**Step 5: Commit** — `feat(offline): outbox queue (parity with legacy outbox.ts)`

---

## Task 6: Health import — steps + sleep (then energy/RHR/HRV/weight/BF/workouts)

**Files:** Create `app/lib/health/health_service.dart`, `app/lib/health/health_types.dart`; Test `app/test/health/health_service_test.dart`. Platform config: `app/ios/Runner/Info.plist` (HealthKit usage strings + entitlement), `app/android/app/src/main/AndroidManifest.xml` (Health Connect permissions + intent).

**Step 1:** `flutter pub add health permission_handler`.
**Step 2: Failing test** — inject a fake `HealthDataSource`; `HealthService.dailySteps(date)` sums samples; missing data → `null` (not `0`).
**Step 3:** Run → FAIL.
**Step 4:** Implement `HealthService` behind an interface (real impl uses `health`; tests use a fake). Request permissions for: **steps, sleep** first; leave scaffolding for active energy, resting HR, HRV, weight, body-fat, workouts.
**Step 5:** Platform config: add HealthKit entitlement + `NSHealthShareUsageDescription`; Android Health Connect permission declarations + the rationale activity.
**Step 6:** Run unit test → PASS. Manual: on a real device, permission prompt appears and steps/sleep read back.
**Step 7: Commit** — `feat(health): steps + sleep import (HealthKit + Health Connect), honest nulls`

---

## Task 7: Permissions + camera + location + push (foundation only)

**Files:** Create `app/lib/core/permissions.dart`, `app/lib/capture/camera_stub.dart`, `app/lib/core/location.dart`, `app/lib/push/push_service.dart`; Tests for the pure permission-state logic.

**Step 1:** `flutter pub add image_picker geolocator flutter_local_notifications` (push transport TBD — local notifications first; server push wires to the existing `/push/*` backend in a later phase).
**Step 2: Failing test** — `PermissionCoordinator` maps granted/denied/permanentlyDenied to app states (drives honest UI, e.g. "enable in Settings").
**Step 3:** Implement the coordinator + thin wrappers (camera capture returns a file; location returns a coarse region for reorder/gym; push registers a token and re-subscribes to the existing backend later).
**Step 4:** Run pure tests → PASS. Manual: each permission prompt fires once.
**Step 5: Commit** — `feat(core): permissions + camera/location/push foundations`

---

## Task 8: Onboarding flow + honest empty states

**Files:** Create `app/lib/onboarding/onboarding_flow.dart`, `app/lib/profile/profile_model.dart`, `app/lib/profile/profile_repo.dart`; Test `app/test/onboarding/onboarding_test.dart`.

**Step 1: Failing tests** — onboarding collects {height, age, sex, weight, goal, goal weight, primary gym}; skipped fields persist as `null` and downstream reads degrade to `—` (never a default like 2200/140/72/80). Completing onboarding PUTs the profile to the backend (or queues offline).
**Step 2:** Run → FAIL.
**Step 3:** Implement the stepper + `ProfileRepo` (writes via `ApiClient`/`Outbox`). Empty states: pages show "let's set this up," not fake data.
**Step 4:** Run → PASS.
**Step 5: Commit** — `feat(onboarding): first-run profile + honest empty states`

---

## Task 9: Settings shell

**Files:** Create `app/lib/settings/settings_page.dart` (+ subsections stubbed); Test a smoke widget test.

**Step 1: Failing test** — Settings lists sections: Health connections, Budget, Units, Gyms, Goal reset, Notifications + quiet hours, Privacy. Goal-reset action calls a `resetGoal()` provider (which will re-reveal the avatar prize in P4).
**Step 2:** Run → FAIL.
**Step 3:** Implement the Settings scaffold + wire Health connections (Task 6) and the health-key entry.
**Step 4:** Run → PASS.
**Step 5: Commit** — `feat(settings): settings hub shell`

---

## Task 10: Wire-up smoke + CI

**Files:** Create `.github/workflows/app-ci.yml` (analyze + test; add a `macos` iOS build job once P-1(a) is chosen); a `flutter analyze` clean pass.

**Step 1:** `flutter analyze` → 0 issues; `flutter test` → all green.
**Step 2:** CI: on push, run `flutter analyze` + `flutter test` (Android build on `ubuntu`, iOS build on `macos` runner if enabled).
**Step 3: Commit** — `ci(app): analyze + test workflow`

---

## Definition of done (P0)
- App launches on Android; iOS path decided (P-1) and building via CI if enabled.
- Nav shell, config + secure key, API client, offline queue, Health steps/sleep, permissions, onboarding, Settings shell — all with green tests, `flutter analyze` clean.
- Backend untouched (still serving today's data).

## Next (separate plan): P1 — Pantry keystone + ingredient graph
`Pantry` inventory model + `MealComposition` graph (read=suggest / write=deduct), test-first, with social-seam owner fields + full log CRUD. Gets its own `docs/plans/YYYY-MM-DD-p1-pantry-ingredient-graph.md`.
