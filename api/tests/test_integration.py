"""CI-runnable end-to-end integration test — the offline TestClient version of
scripts/optimal_day.py. Drives a model lean-bulk day against the real app (no
live server, no network, no Gemini) so a whole class of wiring/encoding/contract
bugs is caught in CI. conftest.py points DATA_DIR/WORKSPACE at temp dirs."""
import datetime
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
H = {"X-Health-Key": "test-key"}
TODAY = datetime.date.today().isoformat()


def _ok(r, code=200):
    assert r.status_code == code, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:200]}"
    return r.json()


def test_optimal_day_end_to_end():
    # ── Morning: profile, goals, weigh-in, sleep, readiness, TDEE ────────────
    _ok(client.put("/tdee/profile", params={"height_cm": 178, "age": 25, "sex": "male",
                                             "activity_level": "moderate", "goal_direction": "gain",
                                             "target_weight_kg": 72}, headers=H))
    _ok(client.put("/goals", json={"calories": 2850, "protein": 140, "gym_days": 4}, headers=H))
    assert _ok(client.get("/goals", headers=H))["parsed"]["calories"] == 2850

    _ok(client.post("/weight", json={"kg": 62.5}, headers=H))
    _ok(client.post("/sleep", json={"bedtime": "23:00", "wake_time": "07:00", "quality": 4, "hrv_ms": 65}, headers=H))
    assert _ok(client.get("/readiness", headers=H))["readiness"]["score"] is not None

    tdee = _ok(client.get("/tdee", headers=H))
    assert tdee["weight_source"] == "logged"
    assert abs(tdee["weight_kg"] - 62.5) < 0.01, tdee["weight_kg"]

    # ── Meals actually eaten + water + workout ───────────────────────────────
    _ok(client.post("/food", json={"meal": "Breakfast", "description": "Oats, whey, banana",
                                    "kcal": 520, "protein_g": 38, "carbs_g": 70, "fat_g": 9}, headers=H))
    _ok(client.post("/food", json={"meal": "Lunch", "description": "Chicken rice + veg",
                                    "kcal": 780, "protein_g": 55, "carbs_g": 90, "fat_g": 18}, headers=H))
    _ok(client.post("/water", json={"ml": 500}, headers=H))
    _ok(client.post("/workouts", json={
        "title": "Push A", "start_time": f"{TODAY}T08:30:00", "end_time": f"{TODAY}T09:20:00",
        "exercises": [{"name": "Barbell Bench Press",
                       "sets": [{"weight_kg": 60, "reps": 8}, {"weight_kg": 60, "reps": 8}]}]}, headers=H))
    assert "Barbell Bench Press" in _ok(client.get("/workouts/prs", headers=H))

    # ── Planned meal (pre-fill) must NOT count as eaten (issue #1) ────────────
    _ok(client.post("/ai/meal-plan/use", json={"date": TODAY, "meals": [
        {"slot": "dinner", "name": "Planned salmon", "kcal": 800, "protein_g": 50,
         "ingredients": ["salmon", "potatoes"], "carbs_g": 60, "fat_g": 25}]}, headers=H))

    today = _ok(client.get("/today", headers=H))
    # eaten = breakfast + lunch only; the 800 kcal planned dinner is excluded
    assert today["total_kcal"] == 520 + 780, today["total_kcal"]
    planned = [e for e in today["entries"] if e.get("confidence") == "planned"]
    assert len(planned) == 1, "planned meal is present but flagged, not counted"

    # ── Evening review ───────────────────────────────────────────────────────
    _ok(client.get("/tdee/adaptive", headers=H))
    tl = _ok(client.get("/timeline", headers=H))
    assert {"food", "workout"}.issubset({e.get("type") for e in tl.get("events", [])})
    _ok(client.get("/stats/week", headers=H))
    _ok(client.get("/report/weekly", headers=H))
    _ok(client.get("/sleep/stats", headers=H))

    # ── Honesty / validation guards ──────────────────────────────────────────
    _ok(client.post("/sleep", json={"bedtime": "2300", "wake_time": "07:00", "quality": 4}, headers=H), code=400)
    _ok(client.get("/barcode/not-a-code", headers=H), code=400)
