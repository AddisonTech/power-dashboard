"""Rebuild the Triage tab's test fixtures from the real simulator and the pinned agent.

    cd backend && python scripts/make_triage_fixtures.py

Writes frontend/src/test/triage-outage.json (America/New_York) and
triage-outage-utc.json: a simulated utility outage on the same fixed clock
the backend tests use, triaged by the installed agent with the template
writer. Also writes triage-grading.json, the agent's grading as
GET /api/triage/grading returns it. Run it after the agent pin changes.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
OUT = BACKEND.parent / "frontend" / "src" / "test"

# The same settings the backend tests run with, set before config.py is imported
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(prefix="triage-fixtures-"), "fixtures.db")
os.environ.setdefault("BACKFILL_HOURS", "1")
os.environ.setdefault("SIM_SEED", "7")
os.environ.setdefault("SIM_FIRST_EVENT", "100000")
os.environ["DATA_SOURCE"] = "simulator"
os.environ.pop("TRIAGE_ANTHROPIC_KEY", None)
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

import triage  # noqa: E402
from test_triage_export import drive  # noqa: E402


def write(name: str, data) -> None:
    path = OUT / name
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=True)
        handle.write("\n")
    print("wrote %s" % path.relative_to(BACKEND.parent))


def main() -> int:
    _collector, now = drive("utility_outage", duration=110)
    for zone, name in (("America/New_York", "triage-outage.json"), ("UTC", "triage-outage-utc.json")):
        triage.clear_cache()
        write(name, triage.run(now, time_zone=zone))
    write("triage-grading.json", triage.grading())
    return 0


if __name__ == "__main__":
    sys.exit(main())
