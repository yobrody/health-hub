"""Isolate the whole test session to throwaway temp dirs BEFORE main.py is
imported (its DATA_DIR / WORKSPACE are read from env at import time). Guarantees
tests never touch real data and gives the TestClient integration test a clean
store."""
import os
import tempfile
import pathlib

_tmp = pathlib.Path(tempfile.mkdtemp(prefix="hh-test-"))
os.environ["HEALTH_API_KEY"] = "test-key"
os.environ["HEALTH_DATA_DIR"] = str(_tmp / "data")
os.environ["HEALTH_WORKSPACE"] = str(_tmp / "ws")
