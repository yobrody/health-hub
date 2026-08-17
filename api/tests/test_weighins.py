"""_all_weighins must unify ALL three weight stores, including HealthKit —
Apple-Health-synced bodyweight was previously invisible to TDEE and the
roadmap because _all_weighins only read body_metrics + weight_log."""
import os
os.environ.setdefault("HEALTH_API_KEY", "test")
import main


def test_includes_healthkit_synced_weight(monkeypatch):
    monkeypatch.setattr(main, "load_metrics", lambda: [])
    monkeypatch.setattr(main, "load_weights", lambda: [])
    monkeypatch.setattr(main, "_read_healthkit",
                        lambda: {"weight_log": [{"kg": 70.5, "at": "2026-05-01T07:30:00"}]})
    assert ("2026-05-01", 70.5) in main._all_weighins()


def test_manual_weight_log_wins_over_healthkit_on_same_date(monkeypatch):
    monkeypatch.setattr(main, "load_metrics", lambda: [])
    monkeypatch.setattr(main, "load_weights", lambda: [{"date": "2026-05-01", "kg": 71.0}])
    monkeypatch.setattr(main, "_read_healthkit",
                        lambda: {"weight_log": [{"kg": 70.5, "at": "2026-05-01T07:30:00"}]})
    assert dict(main._all_weighins())["2026-05-01"] == 71.0


def test_healthkit_wins_over_body_metrics_on_same_date(monkeypatch):
    monkeypatch.setattr(main, "load_metrics", lambda: [{"date": "2026-05-01", "weight_kg": 69.0}])
    monkeypatch.setattr(main, "load_weights", lambda: [])
    monkeypatch.setattr(main, "_read_healthkit",
                        lambda: {"weight_log": [{"kg": 70.5, "at": "2026-05-01T07:30:00"}]})
    assert dict(main._all_weighins())["2026-05-01"] == 70.5
