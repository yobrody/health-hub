"""Pure-function parity tests for the server-side readiness + weekly ports.

These mirror src/lib/readiness.ts and src/lib/calorie-target.ts. They're kept
in lockstep so a scheduled push never disagrees with what the app shows, and so
the honesty invariants (no fabricated score, HRV only with a real baseline) hold
server-side too. Unlike test_api.py these need no running server — import the
functions directly. Run: pytest tests/test_readiness.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _compute_readiness, _weekly_trend, _weekly_suggestion  # noqa: E402


# ── Readiness ────────────────────────────────────────────────────────────────

def test_no_sleep_returns_none():
    # Honesty: never invent a score from nothing.
    assert _compute_readiness([]) is None
    assert _compute_readiness(None) is None


def test_full_sleep_is_ready_100_and_sleep_only():
    r = _compute_readiness([{"date": "2026-08-04", "duration_hrs": 8.0, "quality": 5}])
    assert r is not None
    assert r["score"] == 100          # dur 1.0*0.6 + qual 1.0*0.4
    assert r["level"] == "ready"
    assert r["usedHrv"] is False      # no baseline → sleep-only


def test_short_bad_sleep_is_low_zero():
    r = _compute_readiness([{"date": "2026-08-04", "duration_hrs": 4.0, "quality": 1}])
    assert r["score"] == 0
    assert r["level"] == "low"


def test_hrv_ignored_without_three_prior_nights():
    entries = [
        {"date": "2026-08-01", "duration_hrs": 8, "quality": 4, "hrv_ms": 60},
        {"date": "2026-08-02", "duration_hrs": 8, "quality": 4, "hrv_ms": 60},
        {"date": "2026-08-03", "duration_hrs": 8, "quality": 4, "hrv_ms": 30},  # only 2 prior
    ]
    r = _compute_readiness(entries)
    assert r["usedHrv"] is False


def test_hrv_used_and_suppresses_score_with_baseline():
    base = [{"date": f"2026-08-0{i}", "duration_hrs": 8, "quality": 4, "hrv_ms": 60} for i in range(1, 4)]
    suppressed = base + [{"date": "2026-08-04", "duration_hrs": 8, "quality": 4, "hrv_ms": 30}]
    healthy = base + [{"date": "2026-08-04", "duration_hrs": 8, "quality": 4, "hrv_ms": 60}]
    r_sup = _compute_readiness(suppressed)
    r_ok = _compute_readiness(healthy)
    assert r_sup["usedHrv"] is True and r_ok["usedHrv"] is True
    assert r_sup["score"] < r_ok["score"]  # low HRV drags readiness down


# ── Weekly trend / suggestion ────────────────────────────────────────────────

def test_weekly_trend_needs_two_points():
    assert _weekly_trend([{"date": "2026-08-04", "kg": 62}]) is None
    assert _weekly_trend([]) is None


def test_weekly_trend_slope_positive():
    # 15 consecutive days, +0.03 kg/day → ~+0.21 kg/wk, reliable (≥14 days).
    weights = [{"date": f"2026-08-{d:02d}", "kg": 60 + d * 0.03} for d in range(1, 16)]
    t = _weekly_trend(weights)
    assert t is not None
    assert t["reliable"] is True
    assert round(t["weekly_change_kg"], 2) == 0.21


def test_weekly_suggestion_not_actionable_when_unreliable():
    trend = {"days": 5, "reliable": False, "weekly_change_kg": 0.9, "current": 62}
    assert _weekly_suggestion(2500, trend, "gain")["actionable"] is False


def test_weekly_suggestion_gain_not_gaining_bumps_up():
    # Reliable, flat trend on a gain goal → eat more (rounded to 50).
    trend = {"days": 14, "reliable": True, "weekly_change_kg": 0.0, "current": 62}
    s = _weekly_suggestion(2500, trend, "gain")
    assert s["actionable"] is True
    assert s["delta"] == 200
    assert s["suggested"] == 2700


def test_weekly_suggestion_in_band_is_silent():
    trend = {"days": 14, "reliable": True, "weekly_change_kg": 0.25, "current": 62}
    assert _weekly_suggestion(2500, trend, "gain")["actionable"] is False
