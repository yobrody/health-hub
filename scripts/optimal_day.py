"""End-to-end 'optimal day' driver for Health Hub.

Simulates a model day of a lean-bulk user (Brody: 62.5kg → 72kg goal, 4 gym
days) against a running backend, asserting correctness + honesty at every step.
Collects ALL failures rather than stopping at the first. Not a prod tool — points
at a local isolated instance.

Usage: HH_BASE=http://127.0.0.1:8099 HH_KEY=... python scripts/optimal_day.py
"""
import os, json, urllib.request, urllib.error, datetime

BASE = os.getenv("HH_BASE", "http://127.0.0.1:8099")
KEY = os.getenv("HH_KEY", "e2e-optimal-day-key")
TODAY = datetime.date.today().isoformat()

fails, checks = [], 0


def call(method, path, body=None, expect=200):
    global checks
    checks += 1
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"X-Health-Key": KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            code, txt = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        code, txt = e.code, e.read().decode()
    except Exception as e:
        fails.append(f"[{method} {path}] EXCEPTION {e}")
        return None
    if code != expect:
        fails.append(f"[{method} {path}] expected {expect}, got {code}: {txt[:200]}")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = None
    # Always hand back a dict/list so assertions can't crash the run on an error
    # body — the failure is already recorded above.
    return parsed if isinstance(parsed, (dict, list)) else {}


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        fails.append("ASSERT: " + msg)


print(f"-- Optimal day @ {TODAY} against {BASE} —")

# ── MORNING: profile, goals, weigh-in, sleep, readiness ──────────────────────
call("PUT", f"/tdee/profile?height_cm=178&age=25&sex=male&activity_level=moderate&goal_direction=gain&target_weight_kg=72")
prof = call("GET", "/users/profile")
call("PUT", "/goals", {"calories": 2850, "protein": 140, "gym_days": 4})
g = call("GET", "/goals")
check(g.get("parsed", {}).get("calories") == 2850, f"goals persisted: {g}")

call("POST", "/weight", {"kg": 62.5})
w = call("GET", "/weight")

sl = call("POST", "/sleep", {"bedtime": "23:00", "wake_time": "07:00", "quality": 4, "hrv_ms": 65})
check(isinstance(sl, dict), f"sleep logged: {sl}")
rd = call("GET", "/readiness")
check(rd.get("readiness", {}).get("score") is not None, f"readiness has a score after a fresh sleep log: {rd}")

td = call("GET", "/tdee")
check(isinstance(td, dict), f"tdee returns: {td}")
check(td.get("weight_source") == "logged", f"tdee uses the logged weigh-in, not a default: {td.get('weight_source')}")
check(abs((td.get("weight_kg") or 0) - 62.5) < 0.01, f"tdee weight is the real 62.5: {td.get('weight_kg')}")

# ── MEALS + WATER + WORKOUT through the day ──────────────────────────────────
call("POST", "/food", {"meal": "Breakfast", "description": "Oats, whey, banana", "kcal": 520, "protein_g": 38, "carbs_g": 70, "fat_g": 9})
call("POST", "/water", {"ml": 500})

workout = {
    "title": "Push A", "start_time": f"{TODAY}T08:30:00", "end_time": f"{TODAY}T09:20:00",
    "exercises": [
        {"name": "Barbell Bench Press", "sets": [
            {"weight_kg": 60, "reps": 8}, {"weight_kg": 60, "reps": 8}, {"weight_kg": 60, "reps": 8}]},
        {"name": "Seated Shoulder Press (machine)", "sets": [
            {"weight_kg": 27, "reps": 10}, {"weight_kg": 27, "reps": 10}, {"weight_kg": 27, "reps": 9}]},
        {"name": "Triceps Pushdown", "sets": [
            {"weight_kg": 17, "reps": 15}, {"weight_kg": 17, "reps": 15}, {"weight_kg": 17, "reps": 15}]},
    ],
}
wo = call("POST", "/workouts", workout)
check(isinstance(wo, dict) and wo.get("ok"), f"workout saved: {wo}")
prs = call("GET", "/workouts/prs")
check(isinstance(prs, dict) and "Barbell Bench Press" in prs, f"PRs computed from the workout: {list(prs) if isinstance(prs,dict) else prs}")

call("POST", "/food", {"meal": "Lunch", "description": "Chicken rice + veg", "kcal": 780, "protein_g": 55, "carbs_g": 90, "fat_g": 18})
call("POST", "/water", {"ml": 750})

# Monthly tape measurements on the Body page
mt = call("POST", "/metrics", {"weight_kg": 62.5, "waist_cm": 79, "chest_cm": 98, "arm_cm": 35, "shoulders_cm": 118})
check(isinstance(mt, dict), f"metrics logged: {mt}")

call("POST", "/food", {"meal": "Dinner", "description": "Salmon, potatoes, salad", "kcal": 820, "protein_g": 52, "carbs_g": 70, "fat_g": 30})
call("POST", "/food", {"meal": "Snack", "description": "Greek yogurt + honey", "kcal": 400, "protein_g": 30, "carbs_g": 40, "fat_g": 10})
call("POST", "/water", {"ml": 800})

# ── HealthKit sync (Apple Watch) — steps drive activity, weight into TDEE ─────
hk = call("POST", "/healthkit/sync", {"weight_kg": 62.4, "weight_at": f"{TODAY}T07:05:00",
                                       "steps_today": 11000, "active_calories_today": 520, "resting_calories_today": 1650})
check(isinstance(hk, dict) and hk.get("ok"), f"healthkit sync ok: {hk}")

# ── EVENING REVIEW ───────────────────────────────────────────────────────────
today = call("GET", "/today")
expected_kcal = 520 + 780 + 820 + 400
check(isinstance(today, dict) and today.get("total_kcal") == expected_kcal,
      f"/today total_kcal == {expected_kcal}: got {today.get('total_kcal') if isinstance(today,dict) else today}")
check(len(today.get("entries", [])) == 4, f"/today shows 4 meals: {len(today.get('entries', [])) if isinstance(today,dict) else '?'}")

adaptive = call("GET", "/tdee/adaptive")
check(isinstance(adaptive, dict), f"adaptive tdee returns: {adaptive}")

tl = call("GET", "/timeline")
tl_types = {e.get("type") for e in (tl.get("events", []) if isinstance(tl, dict) else [])}
check({"food", "workout"}.issubset(tl_types), f"timeline has food+workout events today: {tl_types}")

sw = call("GET", "/stats/week")
check(isinstance(sw, dict), f"stats/week returns: {sw}")
wr = call("GET", "/report/weekly")
check(isinstance(wr, dict) or isinstance(wr, list), f"weekly report returns: {type(wr)}")
ins = call("GET", "/insights")
check(ins is not None, f"insights returns: {ins}")
ss = call("GET", "/sleep/stats")
check(isinstance(ss, dict), f"sleep stats returns: {ss}")
call("GET", "/food/history")
call("GET", "/food/recent")

# ── HONESTY / VALIDATION GUARDS (my recent fixes) ────────────────────────────
call("POST", "/sleep", {"bedtime": "2300", "wake_time": "07:00", "quality": 4}, expect=400)  # malformed → 400 not 500
call("GET", "/barcode/not-a-code", expect=400)  # non-numeric barcode → 400

# ── SUMMARY ──────────────────────────────────────────────────────────────────
print(f"\nchecks: {checks}   failures: {len(fails)}")
for f in fails:
    print("  [FAIL] " + f)
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} ISSUE(S)")
