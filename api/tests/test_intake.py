"""Pure-logic tests for daily calorie totalling. No server needed.

Guards the bug where TDEE/timeline used a paren-bound regex
(`~(\\d+) kcal\\)`) that silently missed meal-plan lines written as
`- ~N kcal | ~P g protein` (no paren), so those endpoints disagreed with
/today (which uses parse_entries)."""
import os
os.environ.setdefault("HEALTH_API_KEY", "test")
import main


def test_counts_a_standard_logged_meal_block():
    content = "### 12:30 — Lunch\n- Chicken salad (~450 kcal)\n"
    assert main._day_intake_kcal(content) == 450


def test_counts_meal_plan_lines_without_the_closing_paren():
    # The exact format /ai/meal-plan/use writes — the old regex missed these.
    content = "### 08:00 — Oats\n- Oats, milk, banana\n- ~300 kcal | ~20 g protein\n"
    assert main._day_intake_kcal(content) == 300


def test_sums_across_multiple_meal_blocks():
    content = (
        "### 08:00 — Breakfast\n- Toast (~200 kcal)\n\n"
        "### 12:30 — Lunch\n- Wrap\n- ~500 kcal | ~30 g protein\n"
    )
    assert main._day_intake_kcal(content) == 700


def test_empty_or_unparseable_content_is_zero():
    assert main._day_intake_kcal("") == 0
    assert main._day_intake_kcal("no blocks here") == 0


def test_planned_meals_are_excluded_from_intake():
    # /ai/meal-plan/use writes confidence=planned blocks. Planned != eaten, so
    # they must NOT inflate the day's intake (was counted as eaten before).
    content = (
        "### 08:00 — Breakfast\n- Oats\n- ~300 kcal | ~20 g protein\n<!-- confidence=planned -->\n\n"
        "### 12:30 — Lunch\n- Wrap (~500 kcal)\n"
    )
    assert main._day_intake_kcal(content) == 500  # only the actually-eaten lunch
