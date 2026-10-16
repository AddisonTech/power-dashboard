import os
import sys
import tempfile

# Settings must be in place before config.py is imported
_tmp = tempfile.mkdtemp(prefix="power-dashboard-tests-")
os.environ.setdefault("DB_PATH", os.path.join(_tmp, "test.db"))
os.environ.setdefault("BACKFILL_HOURS", "1")
os.environ.setdefault("POLL_INTERVAL", "0.2")
os.environ.setdefault("HISTORY_INTERVAL", "0.2")
os.environ.setdefault("SIM_SEED", "7")
os.environ.setdefault("SIM_FIRST_EVENT", "100000")
os.environ["DATA_SOURCE"] = "simulator"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
