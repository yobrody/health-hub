"""
Health Hub API — integration test suite.
Hits the live API at localhost:8080. Run with: pytest tests/test_api.py -v
"""
import os
import httpx
import pytest
from datetime import date

BASE = "http://localhost:8080"
KEY = os.getenv("HEALTH_API_KEY", "")  # export before running; no committed literal (audit B-9)
HEADERS = {"X-Health-Key": KEY}


@pytest.fixture
def client():
    return httpx.Client(base_url=BASE, headers=HEADERS, timeout=10)


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_auth_rejects_bad_key():
    r = httpx.get(f"{BASE}/today", headers={"X-Health-Key": "wrong"})
    assert r.status_code == 401


def test_auth_rejects_missing_key():
    r = httpx.get(f"{BASE}/today")
    assert r.status_code == 401


# ── Today overview ───────────────────────────────────────────────────────────

def test_today(client):
    r = client.get("/today")
    assert r.status_code == 200
    d = r.json()
    assert "date" in d
    assert "goals" in d
    assert d["date"] == date.today().isoformat()


# ── Food ─────────────────────────────────────────────────────────────────────

def test_food_log_and_history(client):
    r = client.post("/food", json={
        "meal": "Test Meal",
        "description": "1 apple",
        "kcal": 80,
        "protein_g": 0,
    })
    assert r.status_code == 200
    d = r.json()
    assert d.get("ok") is True

    r = client.get("/food/history")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Fridge ───────────────────────────────────────────────────────────────────

def test_fridge_crud(client):
    r = client.get("/fridge")
    assert r.status_code == 200

    r = client.post("/fridge/item", json={
        "name": "test_milk_pytest",
        "section": "fridge",
    })
    assert r.status_code == 200

    r = client.delete("/fridge/item/test_milk_pytest")
    assert r.status_code == 200


# ── Workouts ─────────────────────────────────────────────────────────────────

def test_workouts_list(client):
    r = client.get("/workouts")
    assert r.status_code == 200


def test_workouts_log(client):
    r = client.post("/workouts", json={
        "title": "Pytest Workout",
        "start_time": "09:00",
        "end_time": "10:00",
        "exercises": [{"name": "Bench Press", "sets": [{"reps": 10, "weight_kg": 60}]}],
    })
    assert r.status_code == 200


def test_workout_prs(client):
    r = client.get("/workouts/prs")
    assert r.status_code == 200


# ── Goals ────────────────────────────────────────────────────────────────────

def test_goals_get(client):
    r = client.get("/goals")
    assert r.status_code == 200
    d = r.json()
    # Goals may be nested under "parsed" key
    goals = d.get("parsed", d)
    assert "calories" in goals
    assert "protein" in goals


def test_goals_update(client):
    r = client.put("/goals", json={"calories": 2800, "protein": 140, "gym_days": 4})
    assert r.status_code == 200


# ── Lists ────────────────────────────────────────────────────────────────────

def test_list_crud(client):
    # Add item
    r = client.post("/lists/test-pytest/items", json={"text": "pytest item"})
    assert r.status_code == 200
    item = r.json()
    item_id = item.get("id", "")

    # Get list
    r = client.get("/lists/test-pytest")
    assert r.status_code == 200
    data = r.json()
    items = data.get("items", data) if isinstance(data, dict) else data
    assert any("pytest" in str(i) for i in items)

    # Toggle
    if item_id:
        r = client.patch(f"/lists/test-pytest/items/{item_id}")
        assert r.status_code == 200

    # Delete item
    if item_id:
        r = client.delete(f"/lists/test-pytest/items/{item_id}")
        assert r.status_code == 200

    # Clear list
    r = client.delete("/lists/test-pytest")
    assert r.status_code == 200


# ── Routines ─────────────────────────────────────────────────────────────────

def test_routine_get(client):
    r = client.get("/routines/morning-skincare")
    assert r.status_code == 200


def test_routine_log(client):
    r = client.post("/routines/test-routine-pytest/log")
    assert r.status_code == 200


def test_routine_streak(client):
    r = client.get("/routines/test-routine-pytest/streak")
    assert r.status_code == 200


# ── Agenda ───────────────────────────────────────────────────────────────────

def test_agenda_crud(client):
    # Add task
    r = client.post("/agenda", json={"title": "Pytest task", "notes": "normal"})
    assert r.status_code == 200
    task = r.json()
    task_id = task.get("id", "")

    # Get today
    r = client.get("/agenda/today")
    assert r.status_code == 200

    # Toggle done
    if task_id:
        r = client.patch(f"/agenda/{task_id}")
        assert r.status_code == 200

    # Delete
    if task_id:
        r = client.delete(f"/agenda/{task_id}")
        assert r.status_code == 200


# ── Metrics (body weight etc) ────────────────────────────────────────────────

def test_metrics_log(client):
    r = client.post("/metrics", json={"weight_kg": 75.5})
    assert r.status_code == 200


def test_metrics_get(client):
    r = client.get("/metrics")
    assert r.status_code == 200


def test_metrics_latest(client):
    r = client.get("/metrics/latest")
    assert r.status_code == 200


# ── TDEE ─────────────────────────────────────────────────────────────────────

def test_tdee(client):
    r = client.get("/tdee")
    assert r.status_code == 200
    d = r.json()
    # Activity multiplier now carries honest provenance (steps > profile > default).
    assert d.get("activity_source") in ("steps", "profile", "default")


def test_tdee_activity_from_steps(client):
    """Syncing real steps feeds the activity derivation. The sync endpoint keys
    every push to the server's *current* day, so ≥3 calendar days of real syncs
    are needed before activity_source flips to 'steps' (can't be forced from a
    black-box client in one run). This asserts the sync is accepted and, when
    the steps path IS active from prior days, that the exposed multiplier is the
    one actually applied to BMR (bmr*multiplier == tdee)."""
    r = client.post("/healthkit/sync", json={"steps_today": 11000})
    assert r.status_code == 200
    d = client.get("/tdee").json()
    assert d.get("activity_source") in ("steps", "profile", "default")
    sa = d.get("steps_activity")
    if d.get("activity_source") == "steps":
        assert sa and sa["avg_steps"] > 0 and sa["days"] >= 3
        assert round(d["bmr"] * sa["multiplier"]) == d["tdee"]
    else:
        assert sa is None


def test_tdee_recommendation_respects_gain_direction(client):
    """A bulker must never be told to cut. With goal_direction='gain', the TDEE
    recommendation should not tell the user to reduce/trim intake."""
    client.put("/tdee/profile", params={"goal_direction": "gain"})
    d = client.get("/tdee").json()
    assert d.get("goal_direction") == "gain"
    rec = (d.get("recommendation") or "").lower()
    # Only meaningful once there are ≥3 logged food days; otherwise it's the
    # "log more" prompt, which is fine either way.
    if "log food" not in rec:
        assert "reduc" not in rec and "cut" not in rec and "trim" not in rec


def test_adaptive_tdee_has_activity_source(client):
    r = client.get("/tdee/adaptive")
    assert r.status_code == 200
    assert r.json().get("activity_source") in ("steps", "profile", "default")


# ── Sleep ────────────────────────────────────────────────────────────────────

def test_sleep_log(client):
    r = client.post("/sleep", json={
        "bedtime": "23:00",
        "wake_time": "07:00",
        "quality": 4,
    })
    assert r.status_code == 200


def test_sleep_get(client):
    r = client.get("/sleep")
    assert r.status_code == 200


def test_sleep_stats(client):
    r = client.get("/sleep/stats")
    assert r.status_code == 200


# ── Timeline ─────────────────────────────────────────────────────────────────

def test_timeline(client):
    r = client.get("/timeline")
    assert r.status_code == 200


# ── Barcode ──────────────────────────────────────────────────────────────────

def test_barcode_lookup(client):
    # Real barcode: Heinz Baked Beans
    r = client.get("/barcode/5000157024671")
    assert r.status_code in (200, 404)  # 404 if Open Food Facts doesn't have it


# ── Stats ────────────────────────────────────────────────────────────────────

def test_week_stats(client):
    r = client.get("/stats/week")
    assert r.status_code == 200


# ── Profile ──────────────────────────────────────────────────────────────────

def test_profile_get(client):
    r = client.get("/users/profile")
    assert r.status_code == 200
