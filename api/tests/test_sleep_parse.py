"""/sleep must reject malformed times with a 400, not 500. Previously
`map(int, entry.bedtime.split(':'))` raised an unhandled ValueError on
input like '2330' or '11:30 PM'."""
import os
os.environ.setdefault("HEALTH_API_KEY", "test")
import pytest
import main
from fastapi import HTTPException


def test_parses_valid_hhmm():
    assert main._parse_hhmm("23:30") == (23, 30)
    assert main._parse_hhmm("07:05") == (7, 5)
    assert main._parse_hhmm("00:00") == (0, 0)


@pytest.mark.parametrize("bad", ["2330", "11:30 PM", "25:00", "12:60", "", "abc", "1:30", "23:5"])
def test_rejects_malformed_time_with_400(bad):
    with pytest.raises(HTTPException) as exc:
        main._parse_hhmm(bad)
    assert exc.value.status_code == 400
