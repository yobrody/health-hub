# Health Hub × Apple HealthKit (iOS Shortcut)

PWAs can't read HealthKit directly. The bridge is a tiny **Apple Shortcut**
that runs on your iPhone, reads from Apple Health, and POSTs to Health Hub's
`/api/healthkit/sync` endpoint.

This doc describes how to build it once.

## What gets synced

The endpoint accepts any combination of:

| Field | Type | Purpose |
|---|---|---|
| `weight_kg` + `weight_at` | number + ISO datetime | Body Mass sample, latest |
| `active_calories_today` | number | Today's Active Energy total |
| `resting_calories_today` | number | Today's Basal Energy total |
| `steps_today` | integer | Today's step count |
| `workouts` | array of `{type, start, duration_min, active_calories?, distance_km?}` | All workouts since last sync |

Workouts are deduped server-side by (`start`, `type`), so re-syncing the same
window is safe.

## Building the Shortcut

In the **Shortcuts** app on iPhone, create a new Shortcut. Add these actions
in order:

### 1. Get latest Body Mass

- **Find Health Samples**: Body Mass, sort by Start Date (newest first), Limit 1
- **Get Details of Health Samples** → `Quantity` → set variable `weight_kg`
- **Get Details of Health Samples** → `Start Date` → set variable `weight_at`
  (formatted as ISO 8601 — use **Format Date** with format `yyyy-MM-dd'T'HH:mm:ss'Z'`)

### 2. Get today's totals

- **Find Health Samples**: Active Energy, Today, sum → variable `active_today`
- **Find Health Samples**: Basal Energy, Today, sum → variable `resting_today`
- **Find Health Samples**: Step Count, Today, sum → variable `steps_today`

### 3. Get recent workouts

- **Find Workouts**: from "1 day ago" to now, limit 20
- **Repeat with Each** workout → build a dictionary per workout:
  ```
  { "type": Workout Type, "start": Workout Start (formatted ISO),
    "duration_min": Workout Duration (in minutes),
    "active_calories": Active Energy Burned }
  ```
- Collect into a list `workouts_list`

### 4. POST to Health Hub

- **Dictionary** with all fields:
  ```
  {
    "weight_kg": <weight_kg>,
    "weight_at": <weight_at>,
    "active_calories_today": <active_today>,
    "resting_calories_today": <resting_today>,
    "steps_today": <steps_today>,
    "workouts": <workouts_list>
  }
  ```
- **Get Contents of URL**:
  - URL: `https://YOUR_HEALTH_HUB_DOMAIN/api/healthkit/sync`
  - Method: POST
  - Headers:
    - `Content-Type: application/json`
    - `X-Health-Key: <your VPS key>` — **required** as of 2026-08: the
      Cloudflare layer now rejects requests that carry neither a browser
      same-origin signal nor this key (the /api surface used to be an open
      proxy). If your existing Shortcut has no header, add this one.
  - Request Body: JSON, value = the dictionary above
- **Show Notification** with the response so you can see "added X workouts"
  the first few runs

### 5. Automate

In Shortcuts → Automation → Personal Automation:

- **Trigger**: Time of Day, daily at 23:00 (after the last possible workout)
- **Action**: Run Shortcut → your new shortcut
- **Run Immediately**: yes (no confirmation prompt)

You can also add an automation that fires **after every Workout** so gym
sessions land in Health Hub within minutes of finishing.

## Verification

After running the shortcut once, hit `GET /api/healthkit/latest` (or visit the
endpoint in a browser with the key). You should see:

```json
{
  "last_weight": { "kg": 82.5, "at": "2026-05-02T07:00:00Z" },
  "last_daily": { "date": "2026-05-02", "active_calories": 380, ... },
  "last_workout": { "type": "Functional Strength Training", ... },
  "weight_count": 1,
  "workout_count": 1
}
```

## Why a Shortcut, not a native app

Health Hub is a PWA. Web pages can't access HealthKit — that's an iOS-side
restriction. A Shortcut runs on-device with the user's HealthKit permissions
and pushes the data out. No App Store, no native app to maintain.

This same pipeline subsumes the originally planned **Gym Group scraper** —
Apple Health already captures gym workouts via Apple Watch / location, and
those flow into Health Hub via the workouts array. No need for a separate
member-portal scraper.
